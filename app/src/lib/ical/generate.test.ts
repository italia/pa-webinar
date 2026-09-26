import { afterEach, beforeEach, describe, it, expect } from 'vitest';

import { generateEventICal, icsSequence } from './generate';

const EVENT_ID = '5aa07b6c-1111-4111-8111-111111111111';

const baseInput = () => ({
  eventId: EVENT_ID,
  updatedAt: new Date('2026-06-01T08:00:00Z'),
  title: 'PA Digitale 2026',
  description: 'Evento sulla digitalizzazione della PA.',
  startsAt: new Date('2026-06-15T10:00:00Z'),
  endsAt: new Date('2026-06-15T12:00:00Z'),
  timezone: 'Europe/Rome',
  url: 'https://eventi.dominio.gov.it/it/eventi/pa-digitale-2026',
  organizerName: 'Mario Rossi',
});

const previousEnv = {
  url: process.env.NEXT_PUBLIC_APP_URL,
  from: process.env.SMTP_FROM,
};
beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://eventi.dominio.gov.it';
  process.env.SMTP_FROM = 'eventi@dominio.gov.it';
});
afterEach(() => {
  for (const [key, value] of [
    ['NEXT_PUBLIC_APP_URL', previousEnv.url],
    ['SMTP_FROM', previousEnv.from],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/** Il valore di una proprieta' del VEVENT (prima occorrenza). */
function prop(ics: string, name: string): string | undefined {
  return ics.match(new RegExp(`^${name}[:;]([^\\r\\n]*)`, 'm'))?.[1];
}

describe('generateEventICal', () => {
  it('starts with BEGIN:VCALENDAR', () => {
    const ics = generateEventICal(baseInput());
    expect(ics).toMatch(/^BEGIN:VCALENDAR/);
  });

  it('ends with END:VCALENDAR', () => {
    const ics = generateEventICal(baseInput());
    expect(ics.trim()).toMatch(/END:VCALENDAR$/);
  });

  it('contains VEVENT block', () => {
    const ics = generateEventICal(baseInput());
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('END:VEVENT');
  });

  it('contains correct summary', () => {
    const ics = generateEventICal(baseInput());
    expect(ics).toContain('SUMMARY:PA Digitale 2026');
  });

  it('contains DTSTART', () => {
    const ics = generateEventICal(baseInput());
    expect(ics).toContain('DTSTART');
  });

  it('contains DTEND', () => {
    const ics = generateEventICal(baseInput());
    expect(ics).toContain('DTEND');
  });

  it('names the organizer with the platform address, never a personal one', () => {
    // Il file arriva a ogni iscritto e si inoltra: l'email personale del
    // moderatore non deve finirci, e i client non devono mandarle risposte.
    const ics = generateEventICal(baseInput());
    expect(ics).toContain('Mario Rossi');
    expect(ics).toContain('eventi@dominio.gov.it');
  });

  it('falls back to a placeholder organizer when SMTP_FROM is empty', () => {
    process.env.SMTP_FROM = '';
    expect(generateEventICal(baseInput())).toContain('noreply@dominio.gov.it');
  });

  it('contains URL', () => {
    const ics = generateEventICal(baseInput());
    expect(ics).toContain('eventi.dominio.gov.it');
  });

  it('sets METHOD:PUBLISH: the file has no ATTENDEE, it is not an invitation to answer', () => {
    const ics = generateEventICal(baseInput());
    expect(ics).toContain('METHOD:PUBLISH');
    expect(ics).not.toContain('METHOD:REQUEST');
    expect(ics).not.toContain('ATTENDEE');
  });

  it('uses the same UID for the same event in every file', () => {
    // Con un UID casuale ogni allegato (conferma, promemoria, cambio data,
    // download) diventava una voce in piu' nel calendario.
    const first = generateEventICal(baseInput());
    const second = generateEventICal({ ...baseInput(), title: 'Titolo cambiato' });
    expect(prop(first, 'UID')).toBe(`${EVENT_ID}@eventi.dominio.gov.it`);
    expect(prop(second, 'UID')).toBe(prop(first, 'UID'));
    const other = generateEventICal({ ...baseInput(), eventId: 'un-altro-evento' });
    expect(prop(other, 'UID')).not.toBe(prop(first, 'UID'));
  });

  it('raises SEQUENCE when the event changes, so a later file updates the entry', () => {
    const before = generateEventICal(baseInput());
    const after = generateEventICal({
      ...baseInput(),
      startsAt: new Date('2026-06-16T10:00:00Z'),
      endsAt: new Date('2026-06-16T12:00:00Z'),
      updatedAt: new Date('2026-06-02T09:30:00Z'),
    });
    const seq = (ics: string) => Number(prop(ics, 'SEQUENCE'));
    expect(seq(before)).toBe(icsSequence(new Date('2026-06-01T08:00:00Z')));
    expect(seq(after)).toBeGreaterThan(seq(before));
    // Lo stesso stato dell'evento da' la stessa SEQUENCE: il download e
    // l'allegato di un promemoria non si scavalcano a vicenda.
    expect(seq(generateEventICal(baseInput()))).toBe(seq(before));
  });

  it('keeps SEQUENCE a small non-negative integer (RFC 5545 INTEGER)', () => {
    expect(icsSequence(new Date('2023-01-01T00:00:00Z'))).toBe(0);
    const inTheFuture = icsSequence(new Date('2080-01-01T00:00:00Z'));
    expect(Number.isInteger(inTheFuture)).toBe(true);
    expect(inTheFuture).toBeLessThan(2 ** 31);
  });

  // Regression guard for the mis-timed invitation bug: the .ics used to carry
  // `DTSTART;TZID=Europe/Rome:20260615T100000` — the UTC wall clock relabelled
  // as Rome time, with no VTIMEZONE to resolve the TZID against — so calendars
  // booked the event two hours early.
  it('emits the START instant in UTC, not a TZID-tagged local time', () => {
    const ics = generateEventICal(baseInput());
    expect(ics).toContain('DTSTART:20260615T100000Z');
    expect(ics).toContain('DTEND:20260615T120000Z');
    expect(ics).not.toMatch(/DTSTART;TZID=/);
    expect(ics).not.toMatch(/DTEND;TZID=/);
  });

  it('never labels a time with a TZID it does not define', () => {
    const ics = generateEventICal(baseInput());
    // Either both (TZID + its VTIMEZONE definition) or neither. We ship neither.
    if (ics.includes('TZID=')) {
      expect(ics).toContain('BEGIN:VTIMEZONE');
    }
  });

  it('keeps the same instant regardless of the event timezone field', () => {
    const rome = generateEventICal(baseInput());
    const utc = generateEventICal({ ...baseInput(), timezone: 'UTC' });
    const start = (s: string) => s.match(/DTSTART[^\r\n]*/)?.[0];
    expect(start(rome)).toBe(start(utc));
  });

  it('contains PRODID', () => {
    const ics = generateEventICal(baseInput());
    expect(ics).toContain('PRODID');
  });

  it('handles special characters in title', () => {
    const ics = generateEventICal({
      ...baseInput(),
      title: 'Q&A: Domande e Risposte!',
    });
    expect(ics).toContain('Domande e Risposte');
  });
});
