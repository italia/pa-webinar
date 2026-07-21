import { describe, it, expect } from 'vitest';
import { generateEventICal } from './generate';

const baseInput = () => ({
  title: 'PA Digitale 2026',
  description: 'Evento sulla digitalizzazione della PA.',
  startsAt: new Date('2026-06-15T10:00:00Z'),
  endsAt: new Date('2026-06-15T12:00:00Z'),
  timezone: 'Europe/Rome',
  url: 'https://eventi.dominio.gov.it/it/eventi/pa-digitale-2026',
  organizerName: 'Mario Rossi',
  organizerEmail: 'mario@dominio.gov.it',
});

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

  it('contains organizer info', () => {
    const ics = generateEventICal(baseInput());
    expect(ics).toContain('Mario Rossi');
    expect(ics).toContain('mario@dominio.gov.it');
  });

  it('contains URL', () => {
    const ics = generateEventICal(baseInput());
    expect(ics).toContain('eventi.dominio.gov.it');
  });

  it('sets METHOD:REQUEST', () => {
    const ics = generateEventICal(baseInput());
    expect(ics).toContain('METHOD:REQUEST');
  });

  // Regression guard for the DevIt invitation bug: the .ics used to carry
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

  it('contains PRODID with DTD', () => {
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
