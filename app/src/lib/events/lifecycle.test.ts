import { describe, it, expect } from 'vitest';

import {
  shouldEndLiveEvent,
  shouldReclaimEmptyOvertime,
  reviveStatus,
  emptyCloseCutoff,
  shouldDemoteLiveToIdle,
  canWakeNow,
  wakeWindowOpensAt,
  shouldCloseAbandonedInstantCall,
  canStartManually,
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

describe('shouldReclaimEmptyOvertime — sala vuota oltre la fine', () => {
  // emptyCutoff = now - 20min: «viva fino a» più vecchio del limite ⇒ vuota da
  // tutta la finestra ⇒ si chiude (se il conteggio è affidabile). endsAt è
  // sempre nel passato per una sala fuori orario.
  const cutoff = minutes(-20);
  const pastEnd = minutes(-90);

  it('chiude una sala vuota da più della finestra', () => {
    expect(shouldReclaimEmptyOvertime({
      lastActiveAt: minutes(-30),
      provisioningStartedAt: minutes(-120),
      endsAt: pastEnd,
      emptyCutoff: cutoff,
      canReclaimEmpty: true,
    })).toBe(true);
  });

  it('non chiude una sala con traffico recente', () => {
    expect(shouldReclaimEmptyOvertime({
      lastActiveAt: minutes(-5),
      provisioningStartedAt: minutes(-120),
      endsAt: pastEnd,
      emptyCutoff: cutoff,
      canReclaimEmpty: true,
    })).toBe(false);
  });

  it('non chiude esattamente sul limite (serve essere strettamente più vecchi)', () => {
    expect(shouldReclaimEmptyOvertime({
      lastActiveAt: minutes(-20),
      provisioningStartedAt: null,
      endsAt: pastEnd,
      emptyCutoff: cutoff,
      canReclaimEmpty: true,
    })).toBe(false);
  });

  it('ripiega su provisioningStartedAt quando nessuno è mai entrato', () => {
    expect(shouldReclaimEmptyOvertime({
      lastActiveAt: null,
      provisioningStartedAt: minutes(-90),
      endsAt: pastEnd,
      emptyCutoff: cutoff,
      canReclaimEmpty: true,
    })).toBe(true);
  });

  it('usa il segno di vita PIÙ RECENTE: una riapertura fresca protegge una sala con lastActiveAt vecchio', () => {
    // Dopo un /wake lastActiveAt resta al valore di prima della pausa: se
    // vincesse, la sala in cui le persone sono appena rientrate si chiuderebbe.
    expect(shouldReclaimEmptyOvertime({
      lastActiveAt: minutes(-60),
      provisioningStartedAt: minutes(-5),
      endsAt: pastEnd,
      emptyCutoff: cutoff,
      canReclaimEmpty: true,
    })).toBe(false);
  });

  it('senza nessun segno di vita ripiega su endsAt (riga LIVE fantasma)', () => {
    expect(shouldReclaimEmptyOvertime({
      lastActiveAt: null,
      provisioningStartedAt: null,
      endsAt: pastEnd,
      emptyCutoff: cutoff,
      canReclaimEmpty: true,
    })).toBe(true);
  });

  it('una pausa cominciata prima della fine ha comunque la sua finestra dopo la fine', () => {
    // Vuota da 25 minuti, ma la fine è passata da 10: il conto parte da endsAt.
    expect(shouldReclaimEmptyOvertime({
      lastActiveAt: minutes(-25),
      provisioningStartedAt: null,
      endsAt: minutes(-10),
      emptyCutoff: cutoff,
      canReclaimEmpty: true,
    })).toBe(false);
    expect(shouldReclaimEmptyOvertime({
      lastActiveAt: minutes(-45),
      provisioningStartedAt: null,
      endsAt: minutes(-21),
      emptyCutoff: cutoff,
      canReclaimEmpty: true,
    })).toBe(true);
  });

  it('senza segni di vita non chiude una sala appena oltre la fine', () => {
    expect(shouldReclaimEmptyOvertime({
      lastActiveAt: null,
      provisioningStartedAt: null,
      endsAt: minutes(-10),
      emptyCutoff: cutoff,
      canReclaimEmpty: true,
    })).toBe(false);
  });

  it('MAI con un conteggio inaffidabile (bridge che non risponde, più repliche)', () => {
    expect(shouldReclaimEmptyOvertime({
      lastActiveAt: minutes(-600),
      provisioningStartedAt: minutes(-600),
      endsAt: pastEnd,
      emptyCutoff: cutoff,
      canReclaimEmpty: false,
    })).toBe(false);
  });
});

describe('fuori orario — le due regole insieme', () => {
  // La sala occupata si chiude al tetto (60 di sito), quella vuota dopo 20
  // minuti senza nessuno: vince la prima che scatta.
  const endsAt = minutes(-30);
  const closes = (o: {
    now?: Date;
    lastActiveAt: Date | null;
    grace: number | null;
    site?: number;
    reliable?: boolean;
  }) => {
    const now = o.now ?? NOW;
    return (
      shouldEndLiveEvent({
        endsAt,
        gracePeriodMinutes: o.grace,
        siteGraceMinutes: o.site ?? 60,
        now,
      }) ||
      shouldReclaimEmptyOvertime({
        lastActiveAt: o.lastActiveAt,
        provisioningStartedAt: minutes(-120),
        endsAt,
        emptyCutoff: new Date(now.getTime() - 20 * 60_000),
        canReclaimEmpty: o.reliable ?? true,
      })
    );
  };

  it('una sala occupata 30 minuti oltre la fine resta aperta', () => {
    expect(closes({ lastActiveAt: minutes(-1), grace: null })).toBe(false);
  });

  it('una sala occupata si chiude al tetto di sito (60 minuti)', () => {
    expect(closes({ now: minutes(30), lastActiveAt: minutes(29), grace: null })).toBe(true);
  });

  it('una sala vuota da 25 minuti si chiude anche prima del tetto', () => {
    expect(closes({ lastActiveAt: minutes(-25), grace: null })).toBe(true);
  });

  it('con tetto -1 una sala occupata non si chiude mai per orario', () => {
    expect(closes({ now: minutes(600), lastActiveAt: minutes(599), grace: -1 })).toBe(false);
  });

  it('con tetto -1 una sala vuota si chiude dopo 20 minuti', () => {
    expect(closes({ lastActiveAt: minutes(-21), grace: -1 })).toBe(true);
  });

  it('con un conteggio inaffidabile vale solo il tetto', () => {
    expect(closes({ lastActiveAt: minutes(-25), grace: null, reliable: false })).toBe(false);
    expect(closes({ now: minutes(31), lastActiveAt: minutes(-25), grace: null, reliable: false })).toBe(true);
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

describe('emptyCloseCutoff — authoritative empty-close', () => {
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

describe('shouldCloseAbandonedInstantCall — giro a bridge fisso', () => {
  const base = {
    eventType: 'INSTANT',
    lastActiveAt: null,
    provisioningStartedAt: null,
    startsAt: minutes(-120),
    inactiveCutoff: minutes(-45),
  };

  it('chiude una chiamata istantanea senza segni di vita per tutta la finestra', () => {
    expect(shouldCloseAbandonedInstantCall({ ...base, lastActiveAt: minutes(-46) })).toBe(true);
    // Nessuno è mai entrato: conta la creazione.
    expect(shouldCloseAbandonedInstantCall(base)).toBe(true);
  });

  it('non chiude una chiamata con attività recente', () => {
    expect(shouldCloseAbandonedInstantCall({ ...base, lastActiveAt: minutes(-44) })).toBe(false);
  });

  it('una chiamata appena creata o riaperta è viva', () => {
    expect(shouldCloseAbandonedInstantCall({ ...base, startsAt: minutes(-10) })).toBe(false);
    expect(
      shouldCloseAbandonedInstantCall({ ...base, provisioningStartedAt: minutes(-5) }),
    ).toBe(false);
  });

  it('mai un evento a calendario: prima della fine una sala vuota è una pausa', () => {
    expect(
      shouldCloseAbandonedInstantCall({ ...base, eventType: 'SCHEDULED', lastActiveAt: minutes(-100) }),
    ).toBe(false);
  });
});

describe('canStartManually — «Avvia evento»', () => {
  it('anche in preparazione o in pausa: nessuno deve restare chiuso fuori', () => {
    for (const status of ['PUBLISHED', 'PROVISIONING', 'IDLE']) {
      expect(canStartManually(status), status).toBe(true);
    }
  });

  it('mai da LIVE, da concluso, da archiviato o da bozza', () => {
    for (const status of ['LIVE', 'ENDED', 'ARCHIVED', 'DRAFT']) {
      expect(canStartManually(status), status).toBe(false);
    }
  });
});
