import { describe, it, expect } from 'vitest';

import {
  isEventPubliclyVisible,
  isEventOpenForRegistration,
  publicEventStatusWhere,
  REGISTRABLE_STATUSES,
} from './visibility';

const FUTURE = new Date(Date.now() + 3_600_000);
const PAST = new Date(Date.now() - 3_600_000);

describe('isEventPubliclyVisible', () => {
  it('PUBLISHED/LIVE/ENDED visibili per qualunque tipo (anche a evento finito)', () => {
    for (const status of ['PUBLISHED', 'LIVE', 'ENDED']) {
      expect(
        isEventPubliclyVisible({ status, eventType: 'SCHEDULED', endsAt: PAST }),
      ).toBe(true);
      expect(
        isEventPubliclyVisible({ status, eventType: 'INSTANT', endsAt: FUTURE }),
      ).toBe(true);
    }
  });

  it('PROVISIONING/IDLE visibili per gli schedulati non finiti (pre-warm ≠ 404)', () => {
    for (const status of ['PROVISIONING', 'IDLE']) {
      expect(
        isEventPubliclyVisible({ status, eventType: 'SCHEDULED', endsAt: FUTURE }),
      ).toBe(true);
    }
  });

  it('un evento FINITO ma incagliato in IDLE/PROVISIONING (scaler giù) resta invisibile', () => {
    for (const status of ['PROVISIONING', 'IDLE']) {
      expect(
        isEventPubliclyVisible({ status, eventType: 'SCHEDULED', endsAt: PAST }),
      ).toBe(false);
    }
  });

  it('le instant call parcheggiate in PROVISIONING/IDLE restano nascoste', () => {
    for (const status of ['PROVISIONING', 'IDLE']) {
      expect(
        isEventPubliclyVisible({ status, eventType: 'INSTANT', endsAt: FUTURE }),
      ).toBe(false);
    }
  });

  it('DRAFT e ARCHIVED mai visibili', () => {
    for (const status of ['DRAFT', 'ARCHIVED']) {
      expect(
        isEventPubliclyVisible({ status, eventType: 'SCHEDULED', endsAt: FUTURE }),
      ).toBe(false);
    }
  });
});

describe('isEventOpenForRegistration', () => {
  it('aperta per PUBLISHED/LIVE e per PROVISIONING/IDLE schedulati non finiti', () => {
    for (const status of ['PUBLISHED', 'LIVE']) {
      expect(
        isEventOpenForRegistration({ status, eventType: 'SCHEDULED', endsAt: FUTURE }),
      ).toBe(true);
    }
    for (const status of ['PROVISIONING', 'IDLE']) {
      expect(
        isEventOpenForRegistration({ status, eventType: 'SCHEDULED', endsAt: FUTURE }),
      ).toBe(true);
    }
  });

  it('chiusa per ENDED/DRAFT/ARCHIVED, per le instant in warm-up e per gli IDLE incagliati post-fine', () => {
    for (const status of ['ENDED', 'DRAFT', 'ARCHIVED']) {
      expect(
        isEventOpenForRegistration({ status, eventType: 'SCHEDULED', endsAt: PAST }),
      ).toBe(false);
    }
    for (const status of ['PROVISIONING', 'IDLE']) {
      expect(
        isEventOpenForRegistration({ status, eventType: 'INSTANT', endsAt: FUTURE }),
      ).toBe(false);
      expect(
        isEventOpenForRegistration({ status, eventType: 'SCHEDULED', endsAt: PAST }),
      ).toBe(false);
    }
  });

  it('REGISTRABLE_STATUSES (per il client) coincide con gli stati aperti lato server', () => {
    expect(REGISTRABLE_STATUSES).toEqual(['PUBLISHED', 'PROVISIONING', 'IDLE', 'LIVE']);
  });
});

describe('publicEventStatusWhere', () => {
  it('esclude gli INSTANT e gli eventi finiti dai soli stati di warm-up', () => {
    const where = publicEventStatusWhere();
    expect(where.OR).toHaveLength(2);
    expect(where.OR?.[0]).toEqual({ status: { in: ['PUBLISHED', 'LIVE', 'ENDED'] } });
    const warmup = where.OR?.[1] as {
      status: { in: string[] };
      eventType: { not: string };
      endsAt: { gt: Date };
    };
    expect(warmup.status).toEqual({ in: ['PROVISIONING', 'IDLE'] });
    expect(warmup.eventType).toEqual({ not: 'INSTANT' });
    expect(warmup.endsAt.gt).toBeInstanceOf(Date);
  });

  it('includeEnded: false toglie ENDED dalla parte sempre-pubblica', () => {
    const where = publicEventStatusWhere({ includeEnded: false });
    expect(where.OR?.[0]).toEqual({ status: { in: ['PUBLISHED', 'LIVE'] } });
  });
});
