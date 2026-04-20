/**
 * Authoritative JVB replica-count snapshot.
 *
 * The scaler CronJob has K8s RBAC to read `spec.replicas` and
 * `status.readyReplicas` from the JVB deployment; the app pod does not.
 * The scaler forwards those counts to `/api/internal/jvb-desired-replicas`,
 * which writes a snapshot here for the public `/api/status` endpoint to
 * read. Without this, status falls back to a single `/colibri/stats` hit
 * that only ever tells us "1 pod answered" — producing the 1/4 reporting
 * bug observed in production.
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
}

export function parseJvbSnapshot(raw: string | null): JvbSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof parsed.current === 'number' &&
      typeof parsed.ready === 'number' &&
      typeof parsed.desired === 'number' &&
      typeof parsed.checkedAt === 'string'
    ) {
      return parsed as unknown as JvbSnapshot;
    }
    return null;
  } catch {
    return null;
  }
}
