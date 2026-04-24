import { describe, it, expect } from 'vitest';

import { shouldEndLiveEvent, reviveStatus } from './lifecycle';

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
