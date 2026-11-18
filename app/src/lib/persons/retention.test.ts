// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

import { MESI_RUBRICA_PREDEFINITI, scadenzaRubrica } from './retention';

const scadenza = (optedInAt: string, retentionMonths: number) =>
  scadenzaRubrica({ optedInAt: new Date(optedInAt), retentionMonths })?.toISOString();

describe('MESI_RUBRICA_PREDEFINITI', () => {
  it('coincide con il default di Person.retentionMonths', () => {
    // I testi per chi si iscrive dichiarano la costante, le voci nascono col
    // default di colonna: se divergono, si promette una durata e se ne applica
    // un'altra.
    const person = Prisma.dmmf.datamodel.models.find((m) => m.name === 'Person');
    const campo = person?.fields.find((f) => f.name === 'retentionMonths');
    expect(campo?.default).toBe(MESI_RUBRICA_PREDEFINITI);
  });
});

describe('scadenzaRubrica', () => {
  it('conta i mesi dal consenso e conserva giorno e ora', () => {
    expect(scadenza('2026-04-15T10:30:15.250Z', 24)).toBe('2028-04-15T10:30:15.250Z');
  });

  it('usa i mesi della voce, non quelli predefiniti', () => {
    expect(scadenza('2026-04-15T10:30:00.000Z', 6)).toBe('2026-10-15T10:30:00.000Z');
    expect(scadenza('2026-04-15T10:30:00.000Z', 36)).toBe('2029-04-15T10:30:00.000Z');
  });

  it("passa da un anno all'altro", () => {
    expect(scadenza('2026-11-15T10:30:00.000Z', 3)).toBe('2027-02-15T10:30:00.000Z');
  });

  it('senza data di consenso non ha una scadenza, e mai il 1970', () => {
    expect(scadenzaRubrica({ optedInAt: null, retentionMonths: 24 })).toBeNull();
  });

  it.each([
    ['31 gennaio, mese corto', '2026-01-31T10:30:00.000Z', 1, '2026-02-28T10:30:00.000Z'],
    [
      "31 agosto, mese corto l'anno dopo",
      '2026-08-31T10:30:00.000Z',
      6,
      '2027-02-28T10:30:00.000Z',
    ],
    [
      '31 marzo, mese di 30 giorni',
      '2026-03-31T10:30:00.000Z',
      1,
      '2026-04-30T10:30:00.000Z',
    ],
    [
      '29 febbraio, anno non bisestile',
      '2028-02-29T10:30:00.000Z',
      24,
      '2030-02-28T10:30:00.000Z',
    ],
    [
      '31 dicembre, febbraio bisestile',
      '2027-12-31T10:30:00.000Z',
      2,
      '2028-02-29T10:30:00.000Z',
    ],
  ])(
    "si ferma all'ultimo giorno del mese di arrivo: %s",
    (_caso, inizio, mesi, attesa) => {
      expect(scadenza(inizio, mesi)).toBe(attesa);
    }
  );

  it('non tocca la data che riceve', () => {
    const optedInAt = new Date('2026-01-31T10:30:00.000Z');
    scadenzaRubrica({ optedInAt, retentionMonths: 1 });
    expect(optedInAt.toISOString()).toBe('2026-01-31T10:30:00.000Z');
  });

  describe('non dipende dal fuso del processo', () => {
    beforeEach(() => {
      vi.stubEnv('TZ', 'Europe/Rome');
      // Se il cambio di fuso non avesse effetto, questi casi non proverebbero niente.
      expect(new Date('2026-03-15T00:30:00.000Z').getHours()).toBe(1);
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it.each([
      [
        "l'ora legale non sposta l'istante",
        '2026-03-15T00:30:00.000Z',
        1,
        '2026-04-15T00:30:00.000Z',
      ],
      // Il 15 alle 23:30 a Roma diventa il 16 alle 00:30: e' cambiato solo il
      // giorno locale, e il fermo di fine mese non deve scattare.
      [
        "l'ora legale cambia il giorno locale",
        '2026-03-15T22:30:00.000Z',
        1,
        '2026-04-15T22:30:00.000Z',
      ],
      // 31 gennaio in UTC, gia' 1 febbraio a Roma.
      [
        'il fine mese si misura sul giorno UTC',
        '2026-01-31T23:30:00.000Z',
        1,
        '2026-02-28T23:30:00.000Z',
      ],
    ])('%s', (_caso, inizio, mesi, attesa) => {
      expect(scadenza(inizio, mesi)).toBe(attesa);
    });
  });
});
