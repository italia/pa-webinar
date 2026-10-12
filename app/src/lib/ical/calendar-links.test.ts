import { describe, it, expect } from 'vitest';
import {
  generateGoogleCalendarUrl,
  generateOutlookCalendarUrl,
  generateYahooCalendarUrl,
  generateIcsDownloadUrl,
  type CalendarLinkInput,
} from './calendar-links';

const baseInput: CalendarLinkInput = {
  title: 'PA Digitale 2026',
  description: 'Evento sulla digitalizzazione.',
  startsAt: new Date('2026-06-15T10:00:00Z'),
  endsAt: new Date('2026-06-15T12:00:00Z'),
  joinUrl: 'https://eventi.dominio.gov.it/it/eventi/pa-digitale-2026/live',
};

// ── Google Calendar ─────────────────────────────────────────

describe('generateGoogleCalendarUrl', () => {
  it('returns a valid URL', () => {
    const url = generateGoogleCalendarUrl(baseInput);
    expect(() => new URL(url)).not.toThrow();
  });

  it('uses Google Calendar domain', () => {
    const url = generateGoogleCalendarUrl(baseInput);
    expect(url).toContain('calendar.google.com');
  });

  it('contains encoded title', () => {
    const url = generateGoogleCalendarUrl(baseInput);
    expect(url).toContain('PA+Digitale+2026');
  });

  it('dates are in YYYYMMDDTHHmmssZ format', () => {
    const url = generateGoogleCalendarUrl(baseInput);
    // 2026-06-15T10:00:00.000Z → 20260615T100000Z
    expect(url).toContain('20260615T100000Z');
    expect(url).toContain('20260615T120000Z');
  });

  it('includes join URL in details', () => {
    const url = generateGoogleCalendarUrl(baseInput);
    expect(url).toContain(encodeURIComponent(baseInput.joinUrl));
  });

  it('handles special characters in title', () => {
    const url = generateGoogleCalendarUrl({
      ...baseInput,
      title: 'Q&A: Domande!',
    });
    expect(() => new URL(url)).not.toThrow();
    expect(url).toContain('Q%26A');
  });
});

// ── Outlook Calendar ────────────────────────────────────────

describe('generateOutlookCalendarUrl', () => {
  it('returns a valid URL', () => {
    const url = generateOutlookCalendarUrl(baseInput);
    expect(() => new URL(url)).not.toThrow();
  });

  it('uses Outlook domain', () => {
    const url = generateOutlookCalendarUrl(baseInput);
    expect(url).toContain('outlook.live.com');
  });

  it('contains subject parameter', () => {
    const url = generateOutlookCalendarUrl(baseInput);
    expect(url).toContain('subject=');
  });

  it('contains ISO date format', () => {
    const url = generateOutlookCalendarUrl(baseInput);
    // Should contain the ISO string (URL-encoded)
    expect(url).toContain('2026-06-15');
  });
});

// ── Yahoo Calendar ──────────────────────────────────────────

describe('generateYahooCalendarUrl', () => {
  it('returns a valid URL', () => {
    const url = generateYahooCalendarUrl(baseInput);
    expect(() => new URL(url)).not.toThrow();
  });

  it('uses Yahoo domain', () => {
    const url = generateYahooCalendarUrl(baseInput);
    expect(url).toContain('calendar.yahoo.com');
  });

  it('contains title parameter', () => {
    const url = generateYahooCalendarUrl(baseInput);
    expect(url).toContain('title=');
  });

  it('contains dates in Google format', () => {
    const url = generateYahooCalendarUrl(baseInput);
    expect(url).toContain('20260615T100000Z');
  });
});

// ── ICS download ────────────────────────────────────────────

describe('generateIcsDownloadUrl', () => {
  it('returns correct path', () => {
    const url = generateIcsDownloadUrl('pa-digitale-2026', 'https://eventi.dominio.gov.it');
    expect(url).toBe('https://eventi.dominio.gov.it/api/events/pa-digitale-2026/calendar.ics');
  });

  it('works with different base URLs', () => {
    const url = generateIcsDownloadUrl('test-event', 'http://localhost:3000');
    expect(url).toBe('http://localhost:3000/api/events/test-event/calendar.ics');
  });
});

describe('descrizione nei link del calendario', () => {
  it('il Markdown della descrizione non arriva al calendario', () => {
    const url = new URL(
      generateGoogleCalendarUrl({ ...baseInput, description: 'Con **Relatore 1**.' }),
    );
    expect(url.searchParams.get('details')).toBe(`Con Relatore 1.\n\n${baseInput.joinUrl}`);
  });

  it('senza descrizione resta il link per entrare', () => {
    const url = new URL(generateOutlookCalendarUrl({ ...baseInput, description: '' }));
    expect(url.searchParams.get('body')).toBe(baseInput.joinUrl);
  });
});

describe('descrizione lunga nei link del calendario', () => {
  it('si taglia dopo aver tolto il Markdown, su una parola', () => {
    const lunga = `Vedi [le slide](https://example.org/${'percorso/'.repeat(40)}) e ${'parola '.repeat(80)}`;
    const url = new URL(
      generateGoogleCalendarUrl({ ...baseInput, description: lunga, descriptionMax: 120 }),
    );
    const dettagli = url.searchParams.get('details') ?? '';
    const testo = dettagli.split('\n\n')[0] ?? '';
    expect(testo.startsWith('Vedi le slide e parola')).toBe(true);
    expect(testo.endsWith('parola…')).toBe(true);
    expect(testo.length).toBeLessThanOrEqual(121);
    expect(dettagli).not.toContain('example.org');
  });
});
