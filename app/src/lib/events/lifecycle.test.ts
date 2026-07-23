import { describe, it, expect } from 'vitest';

import {
  shouldEndLiveEvent,
  shouldReclaimEmptyOvertime,
  reviveStatus,
  emptyCloseCutoff,
  shouldDemoteLiveToIdle,
  canWakeNow,
  wakeWindowOpensAt,
} from './lifecycle';

// Frozen reference time for deterministic comparisons.
const NOW = new Date('2026-04-18T12:00:00Z');
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

describe('shouldEndLiveEvent — grace period', () => {
  it('does NOT close when endsAt is in the future', () => {
    // Not even in overtime yet; scaler shouldn't end it.
    expect(shouldEndLiveEvent({
      endsAt: minutes(5),
      gracePeriodMinutes: 15,
      siteGraceMinutes: 15,
      now: NOW,
    })).toBe(false);
  });

  it('does NOT close within the grace window', () => {
    // Event ended 5 minutes ago, grace is 15 → still overtime, not closed.
    expect(shouldEndLiveEvent({
      endsAt: minutes(-5),
      gracePeriodMinutes: 15,
      siteGraceMinutes: 15,
      now: NOW,
    })).toBe(false);
  });

  it('closes exactly when endsAt + grace == now', () => {
    // Boundary: scaler at t=0 with endsAt=t-15 and grace=15 → close now.
    expect(shouldEndLiveEvent({
      endsAt: minutes(-15),
      gracePeriodMinutes: 15,
      siteGraceMinutes: 15,
      now: NOW,
    })).toBe(true);
  });

  it('closes past the grace window', () => {
    expect(shouldEndLiveEvent({
      endsAt: minutes(-30),
      gracePeriodMinutes: 15,
      siteGraceMinutes: 15,
      now: NOW,
    })).toBe(true);
  });

  it('grace=0 closes the instant endsAt is crossed', () => {
    // Hard close mode: no overtime.
    expect(shouldEndLiveEvent({
      endsAt: minutes(-1),
      gracePeriodMinutes: 0,
      siteGraceMinutes: 15,
      now: NOW,
    })).toBe(true);
  });

  it('grace=-1 never closes (opt-out)', () => {
    // Open-ended events: even hours past endsAt the scaler stays out.
    expect(shouldEndLiveEvent({
      endsAt: minutes(-600),
      gracePeriodMinutes: -1,
      siteGraceMinutes: 15,
      now: NOW,
    })).toBe(false);
  });

  it('null override inherits site default', () => {
    // Per-event override absent → falls back to siteGraceMinutes.
    expect(shouldEndLiveEvent({
      endsAt: minutes(-10),
      gracePeriodMinutes: null,
      siteGraceMinutes: 5,
      now: NOW,
    })).toBe(true);
  });

  it('null override with site default=-1 never closes', () => {
    // Operator can globally opt out by setting the SiteSetting to -1.
    expect(shouldEndLiveEvent({
      endsAt: minutes(-999),
      gracePeriodMinutes: null,
      siteGraceMinutes: -1,
      now: NOW,
    })).toBe(false);
  });
});

describe('shouldReclaimEmptyOvertime — reclaim JVB from an emptied OPEN-ENDED overtime call', () => {
  // inactiveCutoff = now - 45min. "alive until" older than the cutoff ⇒ empty
  // for the whole grace ⇒ reclaim (if open-ended AND the count is reliable).
  // endsAt is always in the past for an overtime call.
  const cutoff = minutes(-45);
  const pastEnd = minutes(-90);
  // Open-ended defaults reused across the "reclaim applies" cases.
  const openEnded = { gracePeriodMinutes: -1, siteGraceMinutes: 15 };

  it('reclaims when the room has been empty past the inactivity grace', () => {
    // grace=-1 overtime call, last traffic 60min ago → free the bridge.
    expect(shouldReclaimEmptyOvertime({
      ...openEnded,
      lastActiveAt: minutes(-60),
      provisioningStartedAt: minutes(-120),
      endsAt: pastEnd,
      inactiveCutoff: cutoff,
      canReclaimEmpty: true,
    })).toBe(true);
  });

  it('does NOT reclaim while the room still had recent traffic', () => {
    // Active overtime call (someone present 10min ago) → never kicked.
    expect(shouldReclaimEmptyOvertime({
      ...openEnded,
      lastActiveAt: minutes(-10),
      provisioningStartedAt: minutes(-120),
      endsAt: pastEnd,
      inactiveCutoff: cutoff,
      canReclaimEmpty: true,
    })).toBe(false);
  });

  it('does NOT reclaim at the exact cutoff boundary (needs to be strictly older)', () => {
    expect(shouldReclaimEmptyOvertime({
      ...openEnded,
      lastActiveAt: minutes(-45),
      provisioningStartedAt: null,
      endsAt: pastEnd,
      inactiveCutoff: cutoff,
      canReclaimEmpty: true,
    })).toBe(false);
  });

  it('falls back to provisioningStartedAt when nobody ever joined', () => {
    // lastActiveAt null (no join) but LIVE since 90min ago → reclaim.
    expect(shouldReclaimEmptyOvertime({
      ...openEnded,
      lastActiveAt: null,
      provisioningStartedAt: minutes(-90),
      endsAt: pastEnd,
      inactiveCutoff: cutoff,
      canReclaimEmpty: true,
    })).toBe(true);
  });

  it('uses the MOST RECENT signal — a fresh reprovision protects a room whose lastActiveAt is stale (/wake race)', () => {
    // Event was active at -60 (lastActiveAt=-60, stale) but was just
    // reprovisioned via /wake at -5 (provisioningStartedAt=-5). Preferring the
    // stale lastActiveAt would terminally close the room people just rejoined;
    // the fresh provision wins the max → NOT reclaimed.
    expect(shouldReclaimEmptyOvertime({
      ...openEnded,
      lastActiveAt: minutes(-60),
      provisioningStartedAt: minutes(-5),
      endsAt: pastEnd,
      inactiveCutoff: cutoff,
      canReclaimEmpty: true,
    })).toBe(false);
  });

  it('falls back to endsAt when BOTH timestamps are null (phantom LIVE row), reclaiming an abandoned forced-LIVE room', () => {
    // A "Start now" room forced to LIVE (no provisioningStartedAt) that nobody
    // joined (lastActiveAt null), now 90min past endsAt → reclaim via endsAt.
    expect(shouldReclaimEmptyOvertime({
      ...openEnded,
      lastActiveAt: null,
      provisioningStartedAt: null,
      endsAt: pastEnd,
      inactiveCutoff: cutoff,
      canReclaimEmpty: true,
    })).toBe(true);
  });

  it('does NOT reclaim a both-null room that only just passed endsAt', () => {
    // endsAt only 10min ago → within the inactivity grace → keep alive.
    expect(shouldReclaimEmptyOvertime({
      ...openEnded,
      lastActiveAt: null,
      provisioningStartedAt: null,
      endsAt: minutes(-10),
      inactiveCutoff: cutoff,
      canReclaimEmpty: true,
    })).toBe(false);
  });

  it('NEVER reclaims when the count is unreliable (bridge blip / multi-replica)', () => {
    // Even a long-stale lastActiveAt must not eject the room when we cannot
    // trust the reading — the emptiness might be a probe artefact, not real.
    expect(shouldReclaimEmptyOvertime({
      ...openEnded,
      lastActiveAt: minutes(-600),
      provisioningStartedAt: minutes(-600),
      endsAt: pastEnd,
      inactiveCutoff: cutoff,
      canReclaimEmpty: false,
    })).toBe(false);
  });

  it('does NOT reclaim a FINITE-grace room, even long-empty — that would shorten the promised window', () => {
    // grace=90 workshop, empty for 60min past endsAt. shouldEndLiveEvent (grace
    // path) still keeps it open until endsAt+90; reclaim must NOT close it early.
    expect(shouldReclaimEmptyOvertime({
      gracePeriodMinutes: 90,
      siteGraceMinutes: 15,
      lastActiveAt: minutes(-60),
      provisioningStartedAt: minutes(-120),
      endsAt: pastEnd,
      inactiveCutoff: cutoff,
      canReclaimEmpty: true,
    })).toBe(false);
  });

  it('does NOT reclaim a grace=0 room (hard close is the grace path\'s job)', () => {
    expect(shouldReclaimEmptyOvertime({
      gracePeriodMinutes: 0,
      siteGraceMinutes: 15,
      lastActiveAt: minutes(-600),
      provisioningStartedAt: minutes(-600),
      endsAt: pastEnd,
      inactiveCutoff: cutoff,
      canReclaimEmpty: true,
    })).toBe(false);
  });

  it('inherits site default grace: null override + site=-1 → reclaims; null + site=15 → does not', () => {
    const base = {
      lastActiveAt: minutes(-60),
      provisioningStartedAt: minutes(-120),
      endsAt: pastEnd,
      inactiveCutoff: cutoff,
      canReclaimEmpty: true,
    };
    // Site globally open-ended → an empty overtime room is reclaimed.
    expect(shouldReclaimEmptyOvertime({
      ...base, gracePeriodMinutes: null, siteGraceMinutes: -1,
    })).toBe(true);
    // Site finite → the room is time-bounded by the grace path, not reclaimed.
    expect(shouldReclaimEmptyOvertime({
      ...base, gracePeriodMinutes: null, siteGraceMinutes: 15,
    })).toBe(false);
  });
});

describe('reviveStatus — event revival on endsAt extension', () => {
  it('does not revive a non-ENDED event', () => {
    // PUBLISHED / LIVE / DRAFT stay as they are when the caller edits.
    for (const status of ['PUBLISHED', 'LIVE', 'DRAFT', 'PROVISIONING', 'IDLE']) {
      expect(reviveStatus({
        currentStatus: status,
        currentStartsAt: minutes(-60),
        newEndsAt: minutes(60),
        newStartsAt: undefined,
        statusExplicitlySet: false,
        now: NOW,
      })).toBeNull();
    }
  });

  it('does not revive when endsAt is still in the past', () => {
    // Moderator bumped endsAt but not enough to bring it into the future.
    expect(reviveStatus({
      currentStatus: 'ENDED',
      currentStartsAt: minutes(-120),
      newEndsAt: minutes(-1),
      newStartsAt: undefined,
      statusExplicitlySet: false,
      now: NOW,
    })).toBeNull();
  });

  it('does not revive when caller explicitly set a status', () => {
    // If the admin explicitly chose e.g. DRAFT, we respect that.
    expect(reviveStatus({
      currentStatus: 'ENDED',
      currentStartsAt: minutes(-60),
      newEndsAt: minutes(60),
      newStartsAt: undefined,
      statusExplicitlySet: true,
      now: NOW,
    })).toBeNull();
  });

  it('revives to LIVE when effectiveStart is in the past', () => {
    // Event should already be running (startsAt passed) and endsAt is
    // now extended → moderator realised it should still be live.
    expect(reviveStatus({
      currentStatus: 'ENDED',
      currentStartsAt: minutes(-60),
      newEndsAt: minutes(60),
      newStartsAt: undefined,
      statusExplicitlySet: false,
      now: NOW,
    })).toBe('LIVE');
  });

  it('revives to PUBLISHED when effectiveStart is in the future', () => {
    // Moderator rescheduled entirely: startsAt moved forward too.
    // Should go back to scheduled (PUBLISHED), not LIVE.
    expect(reviveStatus({
      currentStatus: 'ENDED',
      currentStartsAt: minutes(-60),
      newEndsAt: minutes(120),
      newStartsAt: minutes(30),
      statusExplicitlySet: false,
      now: NOW,
    })).toBe('PUBLISHED');
  });

  it('uses currentStartsAt when newStartsAt is undefined', () => {
    // Only endsAt moved; startsAt from DB is used to decide LIVE vs PUBLISHED.
    expect(reviveStatus({
      currentStatus: 'ENDED',
      currentStartsAt: minutes(30), // scheduled in the future
      newEndsAt: minutes(120),
      newStartsAt: undefined,
      statusExplicitlySet: false,
      now: NOW,
    })).toBe('PUBLISHED');
  });

  it('does not revive when newEndsAt is undefined (caller only changed other fields)', () => {
    // Editing title/description of an ENDED event must not resurrect it.
    expect(reviveStatus({
      currentStatus: 'ENDED',
      currentStartsAt: minutes(-60),
      newEndsAt: undefined,
      newStartsAt: undefined,
      statusExplicitlySet: false,
      now: NOW,
    })).toBeNull();
  });
});

describe('emptyCloseCutoff — authoritative empty-close (#12)', () => {
  it('returns null when disabled (minutes < 0)', () => {
    expect(emptyCloseCutoff(NOW, -1)).toBeNull();
  });
  it('returns now when minutes == 0 (close on first empty poll)', () => {
    expect(emptyCloseCutoff(NOW, 0)?.getTime()).toBe(NOW.getTime());
  });
  it('returns now - N minutes when minutes > 0', () => {
    expect(emptyCloseCutoff(NOW, 10)?.getTime()).toBe(minutes(-10).getTime());
  });
});

// ── shouldDemoteLiveToIdle ──────────────────────────────────

describe('shouldDemoteLiveToIdle', () => {
  const GRACE_MIN = 45;
  const at = (iso: string) => new Date(iso);
  const cutoffFor = (nowIso: string) =>
    new Date(at(nowIso).getTime() - GRACE_MIN * 60_000);

  it('does NOT demote an event that has only just started', () => {
    // The production incident: a registrant opened the event page an hour early,
    // /wake warmed the room, nobody had joined yet when the event went LIVE —
    // and three minutes in the scaler demoted it and killed the bridge.
    expect(
      shouldDemoteLiveToIdle({
        lastActiveAt: null,
        provisioningStartedAt: at('2026-07-22T08:12:00Z'),
        startsAt: at('2026-07-22T09:15:00Z'),
        inactiveCutoff: cutoffFor('2026-07-22T09:18:00Z'),
        now: at('2026-07-22T09:18:00Z'),
      }),
    ).toBe(false);
  });

  it('demotes a room nobody ever joined, once the grace has passed since the start', () => {
    expect(
      shouldDemoteLiveToIdle({
        lastActiveAt: null,
        provisioningStartedAt: at('2026-07-22T08:12:00Z'),
        startsAt: at('2026-07-22T09:15:00Z'),
        inactiveCutoff: cutoffFor('2026-07-22T10:05:00Z'), // start + 50 min
        now: at('2026-07-22T10:05:00Z'),
      }),
    ).toBe(true);
  });

  it('measures from the last activity when the room did have traffic', () => {
    const startsAt = at('2026-07-22T09:15:00Z');
    // Emptied 50 minutes ago → stale.
    expect(
      shouldDemoteLiveToIdle({
        lastActiveAt: at('2026-07-22T10:00:00Z'),
        provisioningStartedAt: at('2026-07-22T09:00:00Z'),
        startsAt,
        inactiveCutoff: cutoffFor('2026-07-22T10:50:00Z'),
        now: at('2026-07-22T10:50:00Z'),
      }),
    ).toBe(true);
    // Someone was there 5 minutes ago → not stale.
    expect(
      shouldDemoteLiveToIdle({
        lastActiveAt: at('2026-07-22T10:45:00Z'),
        provisioningStartedAt: at('2026-07-22T09:00:00Z'),
        startsAt,
        inactiveCutoff: cutoffFor('2026-07-22T10:50:00Z'),
        now: at('2026-07-22T10:50:00Z'),
      }),
    ).toBe(false);
  });

  it('a fresh warm-up protects a long-past start (an event revived by /wake)', () => {
    expect(
      shouldDemoteLiveToIdle({
        lastActiveAt: null,
        provisioningStartedAt: at('2026-07-22T10:48:00Z'),
        startsAt: at('2026-07-22T08:00:00Z'),
        inactiveCutoff: cutoffFor('2026-07-22T10:50:00Z'),
        now: at('2026-07-22T10:50:00Z'),
      }),
    ).toBe(false);
  });

  it('leaves a room alone when there is NO activity signal at all', () => {
    // A revived event (endsAt pushed forward) that never entered PROVISIONING
    // and that nobody has rejoined yet: both timestamps are null, so there is
    // no evidence of inactivity. The SQL this replaced matched neither branch
    // here; demoting on startsAt alone would kill the room on the first tick —
    // the same outage, reintroduced from the other side.
    expect(
      shouldDemoteLiveToIdle({
        lastActiveAt: null,
        provisioningStartedAt: null,
        startsAt: at('2026-07-22T06:00:00Z'),
        inactiveCutoff: cutoffFor('2026-07-22T10:50:00Z'),
        now: at('2026-07-22T10:50:00Z'),
      }),
    ).toBe(false);
  });

  it('still demotes when the start is in the FUTURE (a postponed LIVE row)', () => {
    // An admin moves an already-LIVE event to tomorrow. Counting a future
    // startsAt as "activity" would make the row undemotable for the whole
    // postponement and pin a JVB node (and Jibri) against scale-to-zero.
    expect(
      shouldDemoteLiveToIdle({
        lastActiveAt: at('2026-07-22T08:00:00Z'),
        provisioningStartedAt: at('2026-07-22T08:00:00Z'),
        startsAt: at('2026-07-23T09:00:00Z'),
        inactiveCutoff: cutoffFor('2026-07-22T10:50:00Z'),
        now: at('2026-07-22T10:50:00Z'),
      }),
    ).toBe(true);
  });

  it('takes the LATEST signal, never the earliest', () => {
    // Old activity + old warm-up + recent start → not stale.
    expect(
      shouldDemoteLiveToIdle({
        lastActiveAt: at('2026-07-22T06:00:00Z'),
        provisioningStartedAt: at('2026-07-22T06:00:00Z'),
        startsAt: at('2026-07-22T10:45:00Z'),
        inactiveCutoff: cutoffFor('2026-07-22T10:50:00Z'),
        now: at('2026-07-22T10:50:00Z'),
      }),
    ).toBe(false);
  });
});

// ── canWakeNow / wakeWindowOpensAt ──────────────────────────

describe('wake window', () => {
  const at = (iso: string) => new Date(iso);
  const base = {
    startsAt: at('2026-07-22T09:15:00Z'),
    eventType: 'SCHEDULED',
    preScaleMinutes: 15,
  };

  it('refuses to warm the bridge before the pre-scale window', () => {
    // The 22 July incident: a visitor opened the event page an hour early and
    // /wake started a bridge that then sat idle — and made the event look stale
    // before it had begun.
    expect(canWakeNow({ ...base, now: at('2026-07-22T08:12:00Z') })).toBe(false);
    expect(canWakeNow({ ...base, now: at('2026-07-21T09:15:00Z') })).toBe(false);
  });

  it('allows it from the moment the scaler would pre-scale anyway', () => {
    expect(canWakeNow({ ...base, now: at('2026-07-22T09:00:00Z') })).toBe(true);
    expect(canWakeNow({ ...base, now: at('2026-07-22T09:01:00Z') })).toBe(true);
  });

  it('allows it during and after the event', () => {
    expect(canWakeNow({ ...base, now: at('2026-07-22T09:30:00Z') })).toBe(true);
  });

  it('never gates an INSTANT call — it exists to be opened on demand', () => {
    const instant = { ...base, eventType: 'INSTANT' };
    expect(canWakeNow({ ...instant, now: at('2026-07-20T00:00:00Z') })).toBe(true);
    expect(wakeWindowOpensAt({ ...instant, now: at('2026-07-20T00:00:00Z') })).toBeNull();
  });

  it('reports when the window opens, so the caller can say so', () => {
    expect(
      wakeWindowOpensAt({ ...base, now: at('2026-07-22T08:00:00Z') })?.toISOString(),
    ).toBe('2026-07-22T09:00:00.000Z');
  });

  it('the guard is scoped to PUBLISHED by the caller, so IDLE revival is unaffected', () => {
    // Documented here because the predicate itself is status-agnostic: the wake
    // route applies it ONLY to PUBLISHED. `/wake` is the sole IDLE→PROVISIONING
    // path (the scaler pre-scales PUBLISHED only), so gating an IDLE room would
    // leave a room that emptied during a break dark for good.
    const beforeWindow = { ...base, now: at('2026-07-22T08:12:00Z') };
    expect(canWakeNow(beforeWindow)).toBe(false);
    // …which is why the route must not consult it for IDLE. See wake/route.ts.
  });

  it('follows the configured pre-scale minutes', () => {
    const early = { ...base, preScaleMinutes: 45, now: at('2026-07-22T08:40:00Z') };
    expect(canWakeNow(early)).toBe(true);
    expect(canWakeNow({ ...early, preScaleMinutes: 5 })).toBe(false);
  });
});
