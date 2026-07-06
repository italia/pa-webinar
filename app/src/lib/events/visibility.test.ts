import { describe, it, expect } from 'vitest';

import {
  isEventPubliclyVisible,
  isEventOpenForRegistration,
  publicEventStatusWhere,
} from './visibility';

describe('isEventPubliclyVisible', () => {
  it('PUBLISHED/LIVE/ENDED visibili per qualunque tipo', () => {
    for (const status of ['PUBLISHED', 'LIVE', 'ENDED']) {
      expect(isEventPubliclyVisible({ status, eventType: 'SCHEDULED' })).toBe(true);
      expect(isEventPubliclyVisible({ status, eventType: 'INSTANT' })).toBe(true);
    }
  });

  it('PROVISIONING/IDLE visibili per gli schedulati (pre-warm/pausa ≠ 404)', () => {
    for (const status of ['PROVISIONING', 'IDLE']) {
      expect(isEventPubliclyVisible({ status, eventType: 'SCHEDULED' })).toBe(true);
    }
  });

  it('le instant call parcheggiate in PROVISIONING/IDLE restano nascoste', () => {
    for (const status of ['PROVISIONING', 'IDLE']) {
      expect(isEventPubliclyVisible({ status, eventType: 'INSTANT' })).toBe(false);
    }
  });

  it('DRAFT e ARCHIVED mai visibili', () => {
    for (const status of ['DRAFT', 'ARCHIVED']) {
      expect(isEventPubliclyVisible({ status, eventType: 'SCHEDULED' })).toBe(false);
    }
  });
});

describe('isEventOpenForRegistration', () => {
  it('aperta per PUBLISHED/LIVE e per PROVISIONING/IDLE schedulati', () => {
    for (const status of ['PUBLISHED', 'LIVE']) {
      expect(isEventOpenForRegistration({ status, eventType: 'SCHEDULED' })).toBe(true);
    }
    for (const status of ['PROVISIONING', 'IDLE']) {
      expect(isEventOpenForRegistration({ status, eventType: 'SCHEDULED' })).toBe(true);
    }
  });

  it('chiusa per ENDED/DRAFT/ARCHIVED e per le instant in pre-warm/pausa', () => {
    for (const status of ['ENDED', 'DRAFT', 'ARCHIVED']) {
      expect(isEventOpenForRegistration({ status, eventType: 'SCHEDULED' })).toBe(false);
    }
    for (const status of ['PROVISIONING', 'IDLE']) {
      expect(isEventOpenForRegistration({ status, eventType: 'INSTANT' })).toBe(false);
    }
  });
});

describe('publicEventStatusWhere', () => {
  it('esclude gli INSTANT dai soli stati di warm-up', () => {
    const where = publicEventStatusWhere();
    expect(where.OR).toHaveLength(2);
    expect(where.OR?.[0]).toEqual({ status: { in: ['PUBLISHED', 'LIVE', 'ENDED'] } });
    expect(where.OR?.[1]).toEqual({
      status: { in: ['PROVISIONING', 'IDLE'] },
      eventType: { not: 'INSTANT' },
    });
  });

  it('includeEnded: false toglie ENDED dalla parte sempre-pubblica', () => {
    const where = publicEventStatusWhere({ includeEnded: false });
    expect(where.OR?.[0]).toEqual({ status: { in: ['PUBLISHED', 'LIVE'] } });
  });
});
