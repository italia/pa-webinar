import { describe, expect, it } from 'vitest';

import {
  agendaStatusData,
  minutesBetween,
  minutesSince,
  splitAgendaLines,
  statusFromCompleted,
} from './status';

const now = new Date('2026-10-08T10:00:00Z');

describe('agendaStatusData', () => {
  it('in corso: parte l’orologio, non e’ concluso', () => {
    expect(agendaStatusData('CURRENT', now)).toEqual({
      status: 'CURRENT', completed: false, completedAt: null, startedAt: now,
    });
  });

  it('discusso: concluso adesso, l’ora d’inizio resta', () => {
    const d = agendaStatusData('DONE', now);
    expect(d).toEqual({ status: 'DONE', completed: true, completedAt: now });
    expect('startedAt' in d).toBe(false);
  });

  it('saltato: non concluso', () => {
    expect(agendaStatusData('SKIPPED', now)).toEqual({
      status: 'SKIPPED', completed: false, completedAt: null,
    });
  });

  it('riaperto: torna da discutere, senza orologio', () => {
    expect(agendaStatusData('PENDING', now)).toEqual({
      status: 'PENDING', completed: false, completedAt: null, startedAt: null,
    });
  });
});

describe('statusFromCompleted', () => {
  it('la spunta dei client precedenti diventa discusso o da discutere', () => {
    expect(statusFromCompleted(true)).toBe('DONE');
    expect(statusFromCompleted(false)).toBe('PENDING');
  });
});

describe('minutesSince', () => {
  it('minuti interi, mai negativi, niente senza un inizio', () => {
    expect(minutesSince('2026-10-08T09:47:30Z', now)).toBe(12);
    expect(minutesSince('2026-10-08T10:05:00Z', now)).toBe(0);
    expect(minutesSince(null, now)).toBeNull();
  });
});

describe('minutesBetween', () => {
  it('quanto e’ durato un argomento, mai meno di un minuto', () => {
    expect(minutesBetween('2026-10-08T10:00:00Z', '2026-10-08T10:12:20Z')).toBe(12);
    expect(minutesBetween('2026-10-08T10:00:00Z', '2026-10-08T10:00:20Z')).toBe(1);
  });

  it('senza inizio o fine, o con la fine prima dell’inizio: niente', () => {
    expect(minutesBetween(null, '2026-10-08T10:00:00Z')).toBeNull();
    expect(minutesBetween('2026-10-08T10:00:00Z', null)).toBeNull();
    expect(minutesBetween('2026-10-08T10:05:00Z', '2026-10-08T10:00:00Z')).toBeNull();
  });
});

describe('splitAgendaLines', () => {
  it('una riga, un argomento', () => {
    expect(splitAgendaLines('  Apertura e saluti ')).toEqual(['Apertura e saluti']);
  });

  it('un elenco incollato perde punti e numeri, e le righe vuote', () => {
    const incollato = '1. Apertura\n\n2) Stato dei lavori\r\n- Domande\n• Chiusura\n  — Saluti';
    expect(splitAgendaLines(incollato)).toEqual([
      'Apertura',
      'Stato dei lavori',
      'Domande',
      'Chiusura',
      'Saluti',
    ]);
  });

  it('non tocca trattini e numeri dentro il titolo', () => {
    expect(splitAgendaLines('PNRR 2026 - misura 1.4.4')).toEqual(['PNRR 2026 - misura 1.4.4']);
    expect(splitAgendaLines('2026: bilancio')).toEqual(['2026: bilancio']);
  });
});
