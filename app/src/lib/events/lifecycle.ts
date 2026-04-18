/**
 * Pure helpers for event lifecycle decisions — the logic factored out
 * of the JVB scaler route and the events PUT handler so each branch
 * can be unit-tested without mocking Prisma/next/request.
 *
 * These functions are stateless and take the minimum inputs needed;
 * prod code wires them to DB rows + `new Date()`.
 */

export interface GraceCheckInput {
  /** Event's configured endsAt. */
  endsAt: Date;
  /** Per-event override; null = inherit site default. */
  gracePeriodMinutes: number | null;
  /** Site default grace from SiteSetting.eventGracePeriodMinutes. */
  siteGraceMinutes: number;
  /** Reference "now" used for comparison. */
  now: Date;
}

/**
 * Decide whether a LIVE event past its `endsAt` should be auto-closed
 * to ENDED now, given the grace window.
 *
 *   - grace < 0 (e.g. -1) → never auto-close (moderator opt-out).
 *   - grace = 0          → close the instant endsAt is crossed.
 *   - grace > 0          → close when now >= endsAt + grace minutes.
 *
 * A `null` override inherits the site-level default.
 */
export function shouldEndLiveEvent(input: GraceCheckInput): boolean {
  const grace = input.gracePeriodMinutes ?? input.siteGraceMinutes;
  if (grace < 0) return false;
  const closeAt = new Date(input.endsAt.getTime() + grace * 60_000);
  return input.now.getTime() >= closeAt.getTime();
}

export interface RevivalInput {
  currentStatus: string;
  /** Existing event startsAt (DB row). */
  currentStartsAt: Date;
  /** New endsAt from PUT payload — undefined means caller didn't pass one. */
  newEndsAt: Date | undefined;
  /** New startsAt from PUT payload — undefined means caller kept the old one. */
  newStartsAt: Date | undefined;
  /** Whether the caller explicitly set a status (we only revive if they didn't). */
  statusExplicitlySet: boolean;
  now: Date;
}

/**
 * Decide whether a PUT on an event should "revive" it — i.e. flip
 * ENDED back to LIVE or PUBLISHED because the moderator extended
 * endsAt into the future.
 *
 * Returns the revived status, or null when no revival applies.
 *
 * Rule:
 *   - Only applies to ENDED events (others keep their current status).
 *   - newEndsAt must be defined AND > now.
 *   - Caller must NOT have set status explicitly (we don't override
 *     an intentional DRAFT/PUBLISHED/etc.).
 *   - effectiveStart = newStartsAt ?? currentStartsAt.
 *   - If effectiveStart <= now → LIVE (the event should already be in
 *     progress), otherwise PUBLISHED (scheduled but not yet started).
 */
export function reviveStatus(input: RevivalInput): 'LIVE' | 'PUBLISHED' | null {
  if (input.currentStatus !== 'ENDED') return null;
  if (input.newEndsAt === undefined) return null;
  if (input.newEndsAt.getTime() <= input.now.getTime()) return null;
  if (input.statusExplicitlySet) return null;

  const effectiveStart = input.newStartsAt ?? input.currentStartsAt;
  return effectiveStart.getTime() <= input.now.getTime() ? 'LIVE' : 'PUBLISHED';
}
