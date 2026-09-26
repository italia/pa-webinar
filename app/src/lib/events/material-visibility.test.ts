import { describe, it, expect } from 'vitest';

import {
  isMaterialVisibleInPhase,
  materialPhase,
  materialVisibilityWhere,
  type MaterialPhase,
} from './material-visibility';

const STARTS = new Date('2026-10-01T10:00:00.000Z');
const ENDS = new Date('2026-10-01T12:00:00.000Z');
const PRIMA = new Date('2026-10-01T09:00:00.000Z');
const DURANTE = new Date('2026-10-01T11:00:00.000Z');
const DOPO = new Date('2026-10-01T13:00:00.000Z');

function evento(status: string) {
  return { status, startsAt: STARTS, endsAt: ENDS };
}

describe('materialPhase', () => {
  it('LIVE è sempre «durante», anche aperto in anticipo o oltre l’orario', () => {
    expect(materialPhase(evento('LIVE'), PRIMA)).toBe('DURING');
    expect(materialPhase(evento('LIVE'), DURANTE)).toBe('DURING');
    expect(materialPhase(evento('LIVE'), DOPO)).toBe('DURING');
  });

  it('ENDED e ARCHIVED sono sempre «dopo», anche chiusi prima dell’orario', () => {
    for (const status of ['ENDED', 'ARCHIVED']) {
      expect(materialPhase(evento(status), PRIMA)).toBe('AFTER');
      expect(materialPhase(evento(status), DURANTE)).toBe('AFTER');
    }
  });

  it('negli altri stati decide l’orario', () => {
    for (const status of ['DRAFT', 'PUBLISHED', 'PROVISIONING', 'IDLE']) {
      expect(materialPhase(evento(status), PRIMA)).toBe('BEFORE');
      expect(materialPhase(evento(status), DURANTE)).toBe('DURING');
      expect(materialPhase(evento(status), DOPO)).toBe('AFTER');
    }
  });

  it('i confini: l’inizio è già «durante», la fine è già «dopo»', () => {
    expect(materialPhase(evento('PUBLISHED'), STARTS)).toBe('DURING');
    expect(materialPhase(evento('IDLE'), ENDS)).toBe('AFTER');
  });

  it('accetta le date serializzate come stringhe', () => {
    expect(
      materialPhase(
        { status: 'PUBLISHED', startsAt: STARTS.toISOString(), endsAt: ENDS.toISOString() },
        PRIMA,
      ),
    ).toBe('BEFORE');
  });
});

describe('isMaterialVisibleInPhase', () => {
  const FASI: MaterialPhase[] = ['BEFORE', 'DURING', 'AFTER'];

  it('ALWAYS vuol dire in sala e dopo: mai sulla scheda pubblica prima dell’inizio', () => {
    // Il predefinito di ogni materiale nuovo. Se valesse anche prima, le slide
    // caricate in anticipo finirebbero sulla scheda pubblica senza che nessuno
    // l'abbia deciso.
    expect(isMaterialVisibleInPhase('ALWAYS', 'BEFORE')).toBe(false);
    expect(isMaterialVisibleInPhase('ALWAYS', 'DURING')).toBe(true);
    expect(isMaterialVisibleInPhase('ALWAYS', 'AFTER')).toBe(true);
  });

  it('prima dell’inizio il pubblico vede solo ciò che è marcato BEFORE', () => {
    const visibili = ['ALWAYS', 'BEFORE', 'DURING', 'AFTER'].filter((v) =>
      isMaterialVisibleInPhase(v, 'BEFORE'),
    );
    expect(visibili).toEqual(['BEFORE']);
  });

  it('un materiale limitato si vede solo nella sua fase', () => {
    for (const vis of FASI) {
      for (const fase of FASI) {
        expect(isMaterialVisibleInPhase(vis, fase)).toBe(vis === fase);
      }
    }
  });

  it('un valore sconosciuto resta nascosto', () => {
    for (const fase of FASI) {
      expect(isMaterialVisibleInPhase('', fase)).toBe(false);
      expect(isMaterialVisibleInPhase('always', fase)).toBe(false);
    }
  });
});

describe('materialVisibilityWhere', () => {
  it('seleziona nel DB gli stessi materiali della regola in memoria', () => {
    expect(materialVisibilityWhere('BEFORE')).toEqual({ visibility: { in: ['BEFORE'] } });
    expect(materialVisibilityWhere('DURING')).toEqual({ visibility: { in: ['ALWAYS', 'DURING'] } });
    expect(materialVisibilityWhere('AFTER')).toEqual({ visibility: { in: ['ALWAYS', 'AFTER'] } });
  });

  it('coincide con la regola in memoria per ogni valore e ogni fase', () => {
    const FASI: MaterialPhase[] = ['BEFORE', 'DURING', 'AFTER'];
    for (const fase of FASI) {
      const nelDb = materialVisibilityWhere(fase).visibility.in;
      for (const v of ['ALWAYS', 'BEFORE', 'DURING', 'AFTER', '']) {
        expect(nelDb.includes(v), `${v} in ${fase}`).toBe(isMaterialVisibleInPhase(v, fase));
      }
    }
  });
});
