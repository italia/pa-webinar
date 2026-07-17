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
 * to ENDED now, given the grace window. This is the TIME-based close only.
 *
 *   - grace < 0 (e.g. -1) → never TIME-close: an occupied overtime call is
 *                           never kicked off the clock. NOTE this no longer
 *                           means "never close ever" — an EMPTY overtime room
 *                           is still reclaimed by {@link shouldReclaimEmptyOvertime}
 *                           after the inactivity grace, to free its JVB.
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

export interface OvertimeReclaimInput {
  /** Per-event grace override; null = inherit site default. Reclaim applies
   *  ONLY to open-ended rooms (effective grace < 0). */
  gracePeriodMinutes: number | null;
  /** Site default grace from SiteSetting.eventGracePeriodMinutes. */
  siteGraceMinutes: number;
  /** Last tick the bridge reported traffic for this room (null = nobody ever
   *  joined). Advanced by the scaler only while the bridge is reachable. */
  lastActiveAt: Date | null;
  /** When the room was last (re)provisioned. Also an "alive" signal: a room
   *  brought up seconds ago is NOT stale even if lastActiveAt is old (e.g. a
   *  /wake→re-LIVE cycle doesn't reset lastActiveAt). */
  provisioningStartedAt: Date | null;
  /** The room's endsAt (always in the past for an overtime call). Last-resort
   *  "alive until" when we have NO activity signal at all (both timestamps
   *  null) — a phantom LIVE row is notionally done since its scheduled end, so
   *  it still gets reclaimed instead of leaking forever. */
  endsAt: Date;
  /** now - inactivityGrace: a room whose "alive until" is older than this has
   *  sat empty for the whole inactivity window. */
  inactiveCutoff: Date;
  /** Bridge reachable AND the participant count is reliable (single replica or
   *  cross-pod aggregated). MUST be true to reclaim: emptiness is inferred from
   *  lastActiveAt, which stalls when the bridge is unreachable, so a blip must
   *  never be read as "empty" and end a still-active overtime call. */
  canReclaimEmpty: boolean;
}

/**
 * Decide whether a LIVE room ALREADY PAST its `endsAt` has sat empty long
 * enough to be closed to reclaim its JVB. This ONLY applies to OPEN-ENDED
 * rooms (effective grace < 0). This is the companion to {@link shouldEndLiveEvent}:
 * grace protects an ACTIVE overtime call from being kicked off the clock, while
 * this reclaims the bridge once EVERYONE has left — so an open-ended (grace=-1)
 * event that people simply forget to end doesn't pin a JVB node forever.
 *
 * A FINITE grace (>= 0) is deliberately NOT reclaimed here: it is already
 * time-bounded by {@link shouldEndLiveEvent} (closes at endsAt+grace), and
 * reclaiming an empty finite-grace room after the inactivity window would
 * silently SHORTEN an explicit overtime window an admin promised — e.g. a
 * grace=90 workshop with a 45-min inactivity cutoff would wrongly close at
 * endsAt+45 and lock out participants returning within their promised 90 min.
 *
 * "Alive until" is the MOST RECENT moment we have evidence the room was up: the
 * later of `lastActiveAt` (last bridge traffic) and `provisioningStartedAt`
 * (last (re)provision). Taking the max — not `lastActiveAt ?? provisioning…` —
 * is what keeps a freshly reprovisioned room safe: after a /wake→re-LIVE cycle
 * `lastActiveAt` still holds its OLD pre-IDLE value (wake doesn't reset it), so
 * preferring it would let the first post-endsAt tick terminally close a room
 * people JUST rejoined; the fresh `provisioningStartedAt` wins the max and
 * protects it for the full grace. With no signal at all we fall back to
 * `endsAt` so a phantom LIVE row still gets reclaimed.
 *
 * `canReclaimEmpty` gates the whole check — when the bridge is unreachable or
 * the count is unreliable (multi-replica, no aggregation) we return false and
 * leave the call running, never risking ejecting live people. Callers OR this
 * with {@link shouldEndLiveEvent}: a time-based grace close still fires
 * regardless of reachability (it doesn't depend on the participant count),
 * while this empty-reclaim close is strictly gated on it.
 *
 * Granularity caveat: the scaler's participant count is bridge-wide, and it
 * refreshes lastActiveAt for EVERY live event whenever the bridge has any
 * traffic — so an emptied overtime room co-hosted with another ACTIVE event on
 * the same bridge won't be seen as empty until the WHOLE bridge drains. That is
 * acceptable: while another event holds the bridge up there is no JVB to
 * reclaim anyway; once the bridge truly empties this fires within one grace.
 */
export function shouldReclaimEmptyOvertime(input: OvertimeReclaimInput): boolean {
  if (!input.canReclaimEmpty) return false;
  // Open-ended rooms only. A finite grace (>= 0) is already bounded in time by
  // shouldEndLiveEvent; reclaiming it early would shorten the promised window.
  const grace = input.gracePeriodMinutes ?? input.siteGraceMinutes;
  if (grace >= 0) return false;
  const signals: number[] = [];
  if (input.lastActiveAt) signals.push(input.lastActiveAt.getTime());
  if (input.provisioningStartedAt) signals.push(input.provisioningStartedAt.getTime());
  const aliveUntil =
    signals.length > 0 ? Math.max(...signals) : input.endsAt.getTime();
  return aliveUntil < input.inactiveCutoff.getTime();
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

/**
 * Compute the "empty since" cutoff for the authoritative empty-conference
 * close (feedback #12). A LIVE room whose `lastActiveAt` is non-null AND
 * older than this cutoff is considered abandoned and flipped straight to
 * ENDED, separately from (and typically shorter than) the scale-to-zero
 * inactivity grace.
 *
 *   minutes < 0  → feature disabled, returns null (caller skips the close).
 *   minutes = 0  → cutoff == now (closes on the first poll with no traffic).
 *   minutes > 0  → cutoff == now - minutes.
 */
export function emptyCloseCutoff(now: Date, minutes: number): Date | null {
  if (minutes < 0) return null;
  return new Date(now.getTime() - minutes * 60_000);
}
