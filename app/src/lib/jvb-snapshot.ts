/**
 * Authoritative JVB snapshot written by the scaler CronJob.
 *
 * The scaler CronJob has K8s RBAC to read `spec.replicas` / `status.readyReplicas`
 * from the JVB deployment AND to exec `/colibri/stats` on each JVB pod individually.
 * The app pod has neither capability: its only view of JVB is a single
 * LoadBalancer hit, which routes to exactly one pod per request. With N>1
 * pods serving a single conference, N-1 of them report zeros — so replicas
 * collapsed to "1" and traffic/participants/bitrate appeared empty even
 * during active calls.
 *
 * To avoid that, the scaler enumerates pods each tick, aggregates stats
 * across them, and forwards both the replica counts and the aggregated
 * traffic figures to `/api/internal/jvb-desired-replicas`, which persists
 * them here. Both `/api/status` and `/api/status/infrastructure` read this
 * snapshot as the source of truth.
 *
 * Traffic fields are optional on the type so a snapshot written by an older
 * scaler image (before aggregation was added) still parses — consumers must
 * treat them as nullable and fall back to the single-pod `/colibri/stats`
 * call, which is still correct for single-replica deployments.
 *
 * The TTL is comfortably longer than the scaler schedule (2 min) so a
 * single missed tick doesn't blank the status page.
 */

export const JVB_SNAPSHOT_KEY = 'jvb:replicas:snapshot';
export const JVB_SNAPSHOT_TTL_SECONDS = 300;

export interface JvbSnapshot {
  /** spec.replicas — what the scaler asked the Deployment for. */
  current: number;
  /** status.readyReplicas — how many pods are actually Ready (1/1). */
  ready: number;
  /** What the API computed as desired on this tick. */
  desired: number;
  /** ISO timestamp of when the snapshot was written. */
  checkedAt: string;
  /** How many pods contributed stats this tick (≤ ready, >0 only when aggregation ran). */
  pollSuccesses?: number;
  /** How many pods the scaler tried but failed to probe (stats considered incomplete if >0). */
  pollFailures?: number;
  /** Sum of `participants` across reachable JVB pods. */
  participants?: number;
  /** Sum of `conferences` across reachable JVB pods. */
  conferences?: number;
  /** Max `stress_level` across reachable JVB pods — the worst bridge drives capacity decisions. */
  stressLevel?: number;
  /** Max `largest_conference` across reachable JVB pods. */
  largestConference?: number;
  /** Sum of `endpoints_sending_audio` across reachable JVB pods. */
  endpointsSendingAudio?: number;
  /** Sum of `endpoints_sending_video` across reachable JVB pods. */
  endpointsSendingVideo?: number;
  /** Sum of `bit_rate_download` (kbps) across reachable JVB pods — inbound media to the bridges. */
  bitRateDownKbps?: number;
  /** Sum of `bit_rate_upload` (kbps) across reachable JVB pods — outbound media from the bridges. */
  bitRateUpKbps?: number;
  /** Sum of `octo_conferences` across reachable pods (non-zero when cascading is active). */
  octoConferences?: number;
  /** Sum of `octo_endpoints` across reachable pods. */
  octoEndpoints?: number;
  /** Sum of `octo_send_bitrate` (bps) across reachable pods. */
  octoSendBitrateBps?: number;
  /** Sum of `octo_receive_bitrate` (bps) across reachable pods. */
  octoReceiveBitrateBps?: number;
}

function numOrUndef(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export function parseJvbSnapshot(raw: string | null): JvbSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof parsed.current !== 'number' ||
      typeof parsed.ready !== 'number' ||
      typeof parsed.desired !== 'number' ||
      typeof parsed.checkedAt !== 'string'
    ) {
      return null;
    }
    return {
      current: parsed.current,
      ready: parsed.ready,
      desired: parsed.desired,
      checkedAt: parsed.checkedAt,
      pollSuccesses: numOrUndef(parsed.pollSuccesses),
      pollFailures: numOrUndef(parsed.pollFailures),
      participants: numOrUndef(parsed.participants),
      conferences: numOrUndef(parsed.conferences),
      stressLevel: numOrUndef(parsed.stressLevel),
      largestConference: numOrUndef(parsed.largestConference),
      endpointsSendingAudio: numOrUndef(parsed.endpointsSendingAudio),
      endpointsSendingVideo: numOrUndef(parsed.endpointsSendingVideo),
      bitRateDownKbps: numOrUndef(parsed.bitRateDownKbps),
      bitRateUpKbps: numOrUndef(parsed.bitRateUpKbps),
      octoConferences: numOrUndef(parsed.octoConferences),
      octoEndpoints: numOrUndef(parsed.octoEndpoints),
      octoSendBitrateBps: numOrUndef(parsed.octoSendBitrateBps),
      octoReceiveBitrateBps: numOrUndef(parsed.octoReceiveBitrateBps),
    };
  } catch {
    return null;
  }
}
