import { describe, expect, it } from 'vitest';

import { unsentReminderState } from './reminder-status';

/**
 * Il pannello dell'evento dice di un promemoria non spedito la stessa cosa che
 * fara' il cron: parte solo il promemoria corrente, a chi era iscritto quando
 * e' scattato.
 */

const START = new Date('2030-01-10T10:00:00.000Z');
const CREATO = new Date('2030-01-01T00:00:00.000Z');
const GIORNO = { id: 'r-1440', offsetMinutes: 1440, createdAt: CREATO };
const ORA = { id: 'r-60', offsetMinutes: 60, createdAt: CREATO };
const TUTTI = [GIORNO, ORA];
const ISCRITTO_PRESTO = [new Date('2030-01-02T00:00:00.000Z')];

const minutiPrima = (m: number) => new Date(START.getTime() - m * 60_000);

describe('unsentReminderState', () => {
  it('prima del suo momento: in programma', () => {
    expect(unsentReminderState(ORA, TUTTI, START, minutiPrima(120), ISCRITTO_PRESTO)).toBe(
      'scheduled',
    );
  });

  it('scattato, corrente e con qualcuno che lo aspetta: a momenti', () => {
    expect(unsentReminderState(GIORNO, TUTTI, START, minutiPrima(600), ISCRITTO_PRESTO)).toBe(
      'soon',
    );
  });

  it('superato da un promemoria piu vicino all inizio: non partira piu', () => {
    const adesso = minutiPrima(30);
    expect(unsentReminderState(GIORNO, TUTTI, START, adesso, ISCRITTO_PRESTO)).toBe('missed');
    expect(unsentReminderState(ORA, TUTTI, START, adesso, ISCRITTO_PRESTO)).toBe('soon');
  });

  it('creato quando il suo momento era gia passato: non partira', () => {
    const tardivo = { ...ORA, createdAt: minutiPrima(30) };
    expect(
      unsentReminderState(tardivo, [GIORNO, tardivo], START, minutiPrima(20), ISCRITTO_PRESTO),
    ).toBe('missed');
  });

  it('nessuno iscritto quando e scattato: chi arriva dopo non lo riceve', () => {
    const iscrittoTardi = [minutiPrima(40)];
    expect(unsentReminderState(ORA, TUTTI, START, minutiPrima(30), iscrittoTardi)).toBe('missed');
    expect(unsentReminderState(ORA, TUTTI, START, minutiPrima(30), [])).toBe('missed');
  });

  it('evento iniziato: non partira piu', () => {
    expect(unsentReminderState(ORA, TUTTI, START, START, ISCRITTO_PRESTO)).toBe('missed');
  });
});
