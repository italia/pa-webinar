/**
 * Single source of truth for "how many JVB replicas does an event need".
 *
 * Empirical sizing (validated 2026-04-15 on Standard_F16s_v2, 16 vCPU / 32 GiB):
 *   - Webinar (few senders, many passive viewers): ~300 parts per JVB
 *     measured at 78 parts / 18% stress (Test C), linear projection to
 *     300 parts ≈ 70% stress
 *   - Interactive all-senders (every participant sending video): ~50 parts
 *     per JVB, projected from 47 parts / 25 senders / 9.5% stress (Test D)
 *
 * Both APIs that compute desired JVB replicas (the internal scaler endpoint
 * and the public status dashboards) call this function so a sizing change
 * only needs to happen in one place.
 */

const DEFAULT_MAX_REPLICAS = 6;

/** JVB replicas needed for a single event, based on expected load. */
export function jvbsForEvent(
  maxParticipants: number,
  videoEnabled: boolean,
  maxReplicas: number = DEFAULT_MAX_REPLICAS,
): number {
  if (videoEnabled) {
    // Interactive all-senders: ~50 parts per F16s_v2 JVB.
    if (maxParticipants <= 50) return 1;
    if (maxParticipants <= 100) return 2;
    return Math.min(Math.ceil(maxParticipants / 50), maxReplicas);
  }
  // Webinar (few senders, many passive viewers): ~300 parts per F16s_v2 JVB.
  if (maxParticipants <= 300) return 1;
  if (maxParticipants <= 600) return 2;
  return Math.min(Math.ceil(maxParticipants / 300), maxReplicas);
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
