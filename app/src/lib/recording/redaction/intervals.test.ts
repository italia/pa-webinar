// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { describe, expect, it } from 'vitest';

import {
  FINE_IGNOTA_S,
  intervalliDelleFrasi,
  intervalliDelleTracce,
  intervalliDiParola,
  intervalliDiPresenza,
  intervalliSchema,
  leggiIntervalli,
  leggiProposte,
  proposte,
  secondiCoperti,
  unisciIntervalli,
} from './intervals';

const T0 = new Date('2026-11-10T10:00:00Z');
const a = (s: number) => new Date(T0.getTime() + s * 1000);

describe('unione degli intervalli', () => {
  it('ordina, fonde quelli che si toccano e taglia sul video', () => {
    expect(
      unisciIntervalli(
        [
          { start: 30, end: 40 },
          { start: 5, end: 10 },
          { start: 10.3, end: 12 },
          { start: 590, end: 700 },
          { start: -4, end: 1 },
          { start: 20, end: 20 },
        ],
        600
      )
    ).toEqual([
      { start: 0, end: 1 },
      { start: 5, end: 12 },
      { start: 30, end: 40 },
      { start: 590, end: 600 },
    ]);
  });

  it('arrotonda verso l’esterno al decimo di secondo', () => {
    expect(unisciIntervalli([{ start: 1.234, end: 2.201 }])).toEqual([
      { start: 1.2, end: 2.3 },
    ]);
  });

  it('senza la durata del video non taglia oltre la fine ignota', () => {
    expect(unisciIntervalli([{ start: 1, end: FINE_IGNOTA_S + 50 }])).toEqual([
      { start: 1, end: FINE_IGNOTA_S },
    ]);
  });

  it('conta i secondi coperti', () => {
    expect(
      secondiCoperti([
        { start: 0, end: 1.5 },
        { start: 10, end: 12 },
      ])
    ).toBe(3.5);
  });
});

describe('proposte', () => {
  it('presenza: solo gli ingressi con la voce nel video, chi resta fino alla fine', () => {
    expect(
      intervalliDiPresenza(
        [
          { joinedAt: a(60), leftAt: a(120), voiceExcluded: false },
          { joinedAt: a(130), leftAt: a(200), voiceExcluded: true },
          { joinedAt: a(500), leftAt: null, voiceExcluded: false },
        ],
        T0,
        600
      )
    ).toEqual([
      { start: 60, end: 120, source: 'presence' },
      { start: 500, end: 600, source: 'presence' },
    ]);
  });

  it('chi parla: ogni voce fino alla successiva, con un secondo di margine, solo i propri endpoint', () => {
    const registro = {
      startedAt: a(10),
      log: [
        { atMs: 50_000, participantId: 'io' },
        { atMs: 70_000, participantId: 'altro' },
        { atMs: 200_000, participantId: 'io' },
      ],
    };
    expect(intervalliDiParola([registro], new Set(['io']), T0, 600)).toEqual([
      { start: 59, end: 81, source: 'speech' },
      // L'ultima voce dura al massimo un minuto.
      { start: 209, end: 271, source: 'speech' },
    ]);
  });

  it('chi parla: ignora le voci malformate', () => {
    const registro = {
      startedAt: T0,
      log: [{ atMs: Number.NaN, participantId: 'io' }],
    };
    expect(intervalliDiParola([registro], new Set(['io']), T0, 600)).toEqual([]);
  });

  it('frasi dei sottotitoli e sessioni delle tracce', () => {
    expect(
      intervalliDelleFrasi([{ startedAt: a(100), endedAt: a(104) }], T0, 600)
    ).toEqual([{ start: 99, end: 105, source: 'speech' }]);
    expect(
      intervalliDelleTracce(
        [
          { startOffsetMs: 60_000, durationMs: 30_000 },
          { startOffsetMs: 0, durationMs: null },
        ],
        600
      )
    ).toEqual([{ start: 60, end: 90, source: 'track' }]);
  });

  it('tutte le fonti insieme, in ordine di tempo', () => {
    expect(
      proposte(
        [{ start: 50, end: 60, source: 'presence' }],
        [{ start: 10, end: 20, source: 'speech' }]
      ).map((i) => i.start)
    ).toEqual([10, 50]);
  });
});

describe('lettura di quanto salvato', () => {
  it('scarta le proposte che non lo sono', () => {
    expect(
      leggiProposte([
        { start: 1, end: 2, source: 'presence' },
        { start: 3, end: 2, source: 'speech' },
        { start: 1, end: 2, source: 'altro' },
        null,
        'x',
      ])
    ).toEqual([{ start: 1, end: 2, source: 'presence' }]);
    expect(leggiProposte(null)).toEqual([]);
  });

  it('gli intervalli confermati', () => {
    expect(leggiIntervalli([{ start: 1, end: 2 }])).toEqual([{ start: 1, end: 2 }]);
    expect(leggiIntervalli([{ start: 2, end: 1 }])).toEqual([]);
    expect(leggiIntervalli(undefined)).toEqual([]);
    expect(intervalliSchema.safeParse([]).success).toBe(false);
  });
});
