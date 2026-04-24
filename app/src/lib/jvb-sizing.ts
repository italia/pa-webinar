/**
 * Single source of truth for "how many JVB replicas does an event need".
 *
 * Historically this file had magic numbers (300 parts/JVB webinar,
 * 50 parts/JVB interactive) tied to Azure F16s_v2. The platform is
 * now reused by other PAs that run on different hardware (EKS m5,
 * GKE n2, on-prem), so the density constants live in SiteSetting and
 * the calculation is a linear combination of sender vs receiver cost.
 *
 * Formula:
 *   effectiveRatio = videoEnabled ? expectedSenderRatioPct/100 : 0
 *   senders   = ceil(maxParticipants * effectiveRatio)
 *   receivers = maxParticipants - senders
 *   cores     = senders / sendersPerCore + receivers / receiversPerCore
 *   replicas  = clamp(1, maxReplicas, ceil(cores / cpuCoresPerPod))
 *
 * Default constants (tuned on F16s_v2, 16 vCPU / 32 GiB):
 *   receiversPerCore = 18.75   # 300 passive viewers / 16 cores
 *   sendersPerCore   = 3.125   # 50 all-senders / 16 cores
 *   cpuCoresPerPod   = 16
 *
 * Validation runs (2026-04-15): webinar 78 parts @ 18% stress (Test C),
 * all-sender 47 parts / 25 senders @ 9.5% stress (Test D). Linear
 * extrapolation puts 300 webinar parts ≈ 70% stress, 50 all-senders ≈
 * same — ample headroom for 80th-percentile spikes.
 */

const DEFAULT_MAX_REPLICAS = 6;

export interface JvbSizingConfig {
  /** Effective CPU cores per JVB pod (not the node's). */
  cpuCoresPerPod: number;
  /** How many passive viewers (receive-only) fit on 1 core. */
  receiversPerCore: number;
  /** How many active senders (mic+webcam) fit on 1 core. */
  sendersPerCore: number;
  /** Ceiling on replica count (protects runaway scale-up). */
  maxReplicas: number;
}

export const DEFAULT_JVB_CONFIG: JvbSizingConfig = {
  cpuCoresPerPod: 16,
  receiversPerCore: 18.75,
  sendersPerCore: 3.125,
  maxReplicas: DEFAULT_MAX_REPLICAS,
};

/** JVB replicas needed for a single event. */
export function jvbsForEvent(
  maxParticipants: number,
  expectedSenderRatioPct: number,
  videoEnabled: boolean,
  config: JvbSizingConfig = DEFAULT_JVB_CONFIG,
): number {
  // When video is disabled at the event level, nobody can send video —
  // the ratio collapses to 0 regardless of what was configured.
  const ratio = videoEnabled ? Math.max(0, Math.min(100, expectedSenderRatioPct)) / 100 : 0;
  const senders = Math.ceil(maxParticipants * ratio);
  const receivers = Math.max(0, maxParticipants - senders);

  const senderCost = config.sendersPerCore > 0 ? senders / config.sendersPerCore : 0;
  const receiverCost = config.receiversPerCore > 0 ? receivers / config.receiversPerCore : 0;
  const cores = senderCost + receiverCost;
  const replicas = Math.ceil(cores / Math.max(1, config.cpuCoresPerPod));

  return Math.max(1, Math.min(replicas, Math.max(1, config.maxReplicas)));
}

export function jvbMaxReplicasFromEnv(): number {
  return parseInt(process.env.JVB_MAX_REPLICAS || String(DEFAULT_MAX_REPLICAS), 10);
}

/**
 * Event statuses that actively consume JVB capacity. LIVE events are
 * serving participants now; PROVISIONING events are booting the bridge
 * and will be LIVE imminently — both should count toward desired replicas.
 * IDLE and DRAFT do not consume capacity.
 */
export const JVB_BILLABLE_STATUSES = ['LIVE', 'PROVISIONING'] as const;
