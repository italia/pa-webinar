// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { activeOrUpcomingWhere, activeStatusWhere, compareForStatusList } from './event-activity';

const now = new Date('2026-09-01T10:00:00Z');

describe('activeStatusWhere', () => {
  it('una diretta conta anche oltre l’orario di fine', () => {
    expect(activeStatusWhere('LIVE', now)).toEqual({ status: 'LIVE' });
  });

  it('gli altri stati contano solo finché l’evento non è finito', () => {
    for (const status of ['PROVISIONING', 'IDLE', 'PUBLISHED'] as const) {
      expect(activeStatusWhere(status, now)).toEqual({ status, endsAt: { gte: now } });
    }
  });
});

describe('activeOrUpcomingWhere', () => {
  it('le dirette sempre, il resto finché non è finito', () => {
    expect(activeOrUpcomingWhere(now)).toEqual({
      OR: [
        { status: 'LIVE' },
        { status: { in: ['PUBLISHED', 'PROVISIONING', 'IDLE'] }, endsAt: { gte: now } },
      ],
    });
  });
});

describe('compareForStatusList', () => {
  it('prima le dirette, poi gli allestimenti, poi per inizio', () => {
    const e = (status: string, h: number) => ({ status, startsAt: new Date(Date.UTC(2026, 8, 1, h)) });
    const lista = [e('PUBLISHED', 8), e('PROVISIONING', 9), e('LIVE', 11), e('LIVE', 7)];
    expect(lista.sort(compareForStatusList).map((x) => `${x.status}@${x.startsAt.getUTCHours()}`)).toEqual([
      'LIVE@7',
      'LIVE@11',
      'PROVISIONING@9',
      'PUBLISHED@8',
    ]);
  });
});
