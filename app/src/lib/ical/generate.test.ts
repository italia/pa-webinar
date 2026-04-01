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

  it('sets timezone', () => {
    const ics = generateEventICal(baseInput());
    expect(ics).toContain('Europe/Rome');
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
