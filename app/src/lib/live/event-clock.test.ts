import { describe, expect, it } from 'vitest';

import { formatDurata, minutiInteri, orologioEvento } from './event-clock';

const MIN = 60_000;
const inizio = Date.UTC(2026, 9, 9, 9, 0);
const fine = inizio + 90 * MIN;

describe('orologioEvento', () => {
  it('in orario: trascorso, mancante e avanzamento', () => {
    const o = orologioEvento({ now: inizio + 30 * MIN, inizio, fine, graceMinutes: 60 });
    expect(o.fase).toBe('in-orario');
    expect(o.trascorsoMs).toBe(30 * MIN);
    expect(o.mancanoMs).toBe(60 * MIN);
    expect(o.avanzamento).toBeCloseTo(1 / 3);
    expect(o.minutiAllaChiusura).toBeNull();
  });

  it('negli ultimi dieci minuti avvisa', () => {
    expect(orologioEvento({ now: fine - 9 * MIN, inizio, fine, graceMinutes: 60 }).fase).toBe('quasi-fine');
  });

  it('oltre la fine: fuori orario, poi in chiusura negli ultimi minuti del tetto', () => {
    const fuori = orologioEvento({ now: fine + 12 * MIN, inizio, fine, graceMinutes: 60 });
    expect(fuori.fase).toBe('fuori-orario');
    expect(fuori.minutiAllaChiusura).toBe(48);
    expect(fuori.avanzamento).toBe(1);
    expect(orologioEvento({ now: fine + 55 * MIN, inizio, fine, graceMinutes: 60 }).fase).toBe('in-chiusura');
  });

  it('senza tetto il fuori orario non chiude mai', () => {
    const o = orologioEvento({ now: fine + 200 * MIN, inizio, fine, graceMinutes: -1 });
    expect(o.fase).toBe('fuori-orario');
    expect(o.minutiAllaChiusura).toBeNull();
  });

  it('prima dell’inizio non conta tempo negativo', () => {
    const o = orologioEvento({ now: inizio - 5 * MIN, inizio, fine, graceMinutes: 60 });
    expect(o.trascorsoMs).toBe(0);
    expect(o.avanzamento).toBe(0);
  });
});

describe('formatDurata e minutiInteri', () => {
  it('formatta sotto e sopra l’ora', () => {
    expect(formatDurata(5 * MIN + 7000)).toBe('05:07');
    expect(formatDurata(72 * MIN)).toBe('1:12:00');
    expect(minutiInteri(48 * MIN + 59_000)).toBe(48);
  });
});
