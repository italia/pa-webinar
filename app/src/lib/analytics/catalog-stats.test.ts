// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { describe, expect, it } from 'vitest';

import {
  aggregaCatalogo,
  finestraDeiMesi,
  meseNelFuso,
  mesiDelCatalogo,
  mesiFinoA,
  type RigaCatalogo,
} from './catalog-stats';

const ROMA = 'Europe/Rome';

const riga = (campi: Partial<RigaCatalogo> = {}): RigaCatalogo => ({
  eventType: 'SCHEDULED',
  formatClass: null,
  templateId: null,
  templateName: null,
  templateCurrentName: null,
  startsAt: new Date('2026-10-15T10:00:00Z'),
  peakParticipants: 0,
  sessions: 0,
  durationSec: null,
  ...campi,
});

describe('I mesi del catalogo', () => {
  it('il periodo dall indirizzo: fuori elenco vale quello predefinito', () => {
    expect(mesiDelCatalogo('3')).toBe(3);
    expect(mesiDelCatalogo('24')).toBe(24);
    expect(mesiDelCatalogo('5')).toBe(12);
    expect(mesiDelCatalogo(null)).toBe(12);
    expect(mesiDelCatalogo('tutti')).toBe(12);
  });

  it('il mese si legge nel fuso dell istanza', () => {
    // Mezzanotte e mezza del primo novembre a Roma e' ancora ottobre in UTC.
    expect(meseNelFuso(new Date('2026-10-31T23:30:00Z'), ROMA)).toBe('2026-11');
    expect(meseNelFuso(new Date('2026-10-31T23:30:00Z'), 'UTC')).toBe('2026-10');
  });

  it('gli ultimi mesi fino a quello in corso, anche a cavallo d anno', () => {
    expect(mesiFinoA(new Date('2026-02-10T12:00:00Z'), 3, ROMA)).toEqual([
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
    expect(mesiFinoA(new Date('2026-11-18T12:00:00Z'), 12, ROMA)).toHaveLength(12);
  });

  it('la finestra da leggere copre i mesi con un giorno di margine', () => {
    const { since, until } = finestraDeiMesi(['2026-01', '2026-02', '2026-03']);
    expect(since.toISOString()).toBe('2025-12-31T00:00:00.000Z');
    expect(until.toISOString()).toBe('2026-04-02T00:00:00.000Z');
  });
});

describe('Le statistiche del catalogo', () => {
  const mesi = ['2026-09', '2026-10', '2026-11'];

  it('conta per tipo e per mese, con le medie sugli eventi tenuti', () => {
    const { byType } = aggregaCatalogo(
      [
        riga({
          formatClass: 'MEETING',
          sessions: 1,
          peakParticipants: 6,
          durationSec: 3600,
        }),
        riga({
          formatClass: 'MEETING',
          sessions: 2,
          peakParticipants: 9,
          durationSec: 1800,
        }),
        // In programma, non ancora tenuto: conta fra gli eventi, non nelle medie.
        riga({ formatClass: 'MEETING', startsAt: new Date('2026-11-20T10:00:00Z') }),
        riga({
          eventType: 'INSTANT',
          sessions: 1,
          peakParticipants: 3,
          durationSec: null,
        }),
      ],
      mesi,
      ROMA
    );
    const riunioni = byType.find((g) => g.type === 'MEETING');
    expect(riunioni).toMatchObject({
      events: 3,
      held: 2,
      avgParticipants: 7.5,
      avgDurationMinutes: 45,
    });
    expect(riunioni?.byMonth.map((c) => c.events)).toEqual([0, 2, 1]);
    expect(riunioni?.byMonth[2]).toEqual({
      events: 1,
      held: 0,
      avgParticipants: null,
      avgDurationMinutes: null,
    });
    // Tenuta senza una sessione chiusa: c'e' il picco, non la durata.
    expect(byType.find((g) => g.type === 'INSTANT')).toMatchObject({
      events: 1,
      held: 1,
      avgParticipants: 3,
      avgDurationMinutes: null,
    });
  });

  it('elenca tutti i tipi, dal piu ricorrente', () => {
    const { byType } = aggregaCatalogo(
      [
        riga({ formatClass: 'PUBLIC' }),
        riga({ formatClass: 'PUBLIC' }),
        riga({ eventType: 'LEGACY' }),
        riga(),
      ],
      mesi,
      ROMA
    );
    expect(byType).toHaveLength(6);
    expect(byType[0]).toMatchObject({ type: 'PUBLIC', events: 2 });
    expect(byType.find((g) => g.type === 'UNCATALOGED')?.events).toBe(1);
    expect(byType.find((g) => g.type === 'LEGACY')?.events).toBe(1);
    expect(byType.find((g) => g.type === 'PARTICIPATORY')?.events).toBe(0);
  });

  it('fuori dal periodo non conta', () => {
    const { byType, byTemplate } = aggregaCatalogo(
      [riga({ formatClass: 'MEETING', startsAt: new Date('2026-06-01T10:00:00Z') })],
      mesi,
      ROMA
    );
    expect(byType.every((g) => g.events === 0)).toBe(true);
    expect(byTemplate).toEqual([]);
  });

  it('i modelli: per riferimento col nome di oggi, i cancellati col nome di allora', () => {
    const id = '22222222-2222-4222-8222-222222222222';
    const { byTemplate } = aggregaCatalogo(
      [
        riga({
          templateId: id,
          templateName: 'Nome vecchio',
          templateCurrentName: 'Nome nuovo',
        }),
        riga({
          templateId: id,
          templateName: 'Nome nuovo',
          templateCurrentName: 'Nome nuovo',
        }),
        riga({ templateName: 'Modello cancellato' }),
        riga({ formatClass: 'MEETING' }),
        riga({ eventType: 'INSTANT' }),
        riga({ eventType: 'LEGACY' }),
      ],
      mesi,
      ROMA
    );
    expect(byTemplate[0]).toMatchObject({
      key: `t:${id}`,
      name: 'Nome nuovo',
      events: 2,
      deleted: false,
      special: null,
    });
    expect(byTemplate.find((g) => g.deleted)).toMatchObject({
      name: 'Modello cancellato',
      templateId: null,
      events: 1,
    });
    expect(byTemplate.find((g) => g.special === 'NONE')?.events).toBe(1);
    expect(byTemplate.find((g) => g.special === 'INSTANT')?.events).toBe(1);
    expect(byTemplate.find((g) => g.special === 'LEGACY')?.events).toBe(1);
  });
});
