import { describe, it, expect } from 'vitest';

import {
  absoluteEventImage,
  baseConfirmationCopy,
  confirmationHtml,
  confirmationText,
  reminderHtml,
} from './templates';

/**
 * Regressions from the live report: "the email body — check the subject too —
 * has no event name, nor the banner if the event has one".
 *
 * The missing name was a locale-fallback bug (see lib/utils/locale), but these
 * guards pin the other half: the title must be visible in the body, not only in
 * a table row, and the event image must actually reach the message.
 */
const base = () => ({
  locale: 'it' as const,
  eventTitle: 'Incontro di rete + domande',
  eventDate: 'mercoledì 22 luglio 2026',
  eventTime: '11:15',
  eventDuration: '45 min',
  joinUrl: 'https://example.gov.it/it/events/x/live?token=abc',
  eventPageUrl: 'https://example.gov.it/it/events/x',
  siteName: 'PA Webinar',
});

describe('confirmation email', () => {
  it('puts the event name in the subject', () => {
    expect(baseConfirmationCopy(base()).subject).toContain('Incontro di rete + domande');
    expect(baseConfirmationCopy({ ...base(), locale: 'en' }).subject).toContain('Incontro di rete + domande');
  });

  it('shows the event name prominently in the body, not just in the table', () => {
    const html = confirmationHtml(base());
    // Once as the headline under the heading, once in the details table.
    const occurrences = html.split('Incontro di rete + domande').length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it('keeps the event name in the plain-text part', () => {
    expect(confirmationText(base())).toContain('Incontro di rete + domande');
  });

  it('renders the event banner when the event has an image', () => {
    const html = confirmationHtml({
      ...base(),
      eventImageUrl: 'https://example.gov.it/api/assets/image/2026/07/banner.png',
    });
    expect(html).toContain('<img src="https://example.gov.it/api/assets/image/2026/07/banner.png"');
    expect(html).toContain('alt="Incontro di rete + domande"');
  });

  it('renders no banner when the event has no image', () => {
    expect(confirmationHtml(base())).not.toContain('<img');
  });

  it('reminders carry the banner too', () => {
    const html = reminderHtml({
      ...base(),
      offsetMinutes: 60,
      eventImageUrl: 'https://example.gov.it/banner.png',
    });
    expect(html).toContain('<img src="https://example.gov.it/banner.png"');
  });

  it('refuses a banner URL that is not http(s)', () => {
    // The value lands in an `src=` inside HTML sent to a mailbox.
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd']) {
      expect(confirmationHtml({ ...base(), eventImageUrl: url }), url).not.toContain('<img');
    }
  });

  it('escapes a title with HTML in it, in both the headline and the alt text', () => {
    const html = confirmationHtml({
      ...base(),
      eventTitle: '<script>x</script> & "co"',
      eventImageUrl: 'https://example.gov.it/b.png',
    });
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('absoluteEventImage', () => {
  const BASE = 'https://pa-webinar.example.gov.it';

  it('prefers the curated cover over the generic image', () => {
    // Cover-first ovunque: card in-app, anteprime social ed email mostrano la
    // STESSA immagine per lo stesso evento.
    expect(
      absoluteEventImage({ imageUrl: 'https://x/a.png', coverImageUrl: 'https://x/b.png' }, BASE),
    ).toBe('https://x/b.png');
  });

  it('falls back to the generic image when there is no cover', () => {
    expect(absoluteEventImage({ imageUrl: 'https://x/a.png', coverImageUrl: null }, BASE)).toBe(
      'https://x/a.png',
    );
  });

  it('resolves a relative path against the public base URL', () => {
    // A relative src would never load in a mail client.
    expect(absoluteEventImage({ imageUrl: '/api/assets/image/a.png' }, BASE)).toBe(
      `${BASE}/api/assets/image/a.png`,
    );
  });

  it('returns null when the event has no image', () => {
    expect(absoluteEventImage({}, BASE)).toBeNull();
    expect(absoluteEventImage({ imageUrl: null, coverImageUrl: null }, BASE)).toBeNull();
  });
});

describe('email di accesso dello staff', () => {
  it('il nome non diventa markup', async () => {
    const { staffLoginEmail } = await import('./templates');
    const m = staffLoginEmail({
      locale: 'it',
      name: '<img src=x onerror=alert(1)>',
      url: 'https://esempio.it/it/admin/accesso?t=abc',
      minutes: 20,
    });
    expect(m.html).not.toContain('<img src=x');
    expect(m.html).toContain('&lt;img');
    expect(m.text).toContain('https://esempio.it/it/admin/accesso?t=abc');
  });
});

describe('uscita dalla rubrica nelle email', () => {
  const OPT_OUT = 'https://example.gov.it/it/rubrica/opt-out?token=abc.def';

  it('senza rubrica resta la nota di sempre, senza link', async () => {
    const { baseReminderCopy, reminderText } = await import('./templates');
    expect(baseConfirmationCopy(base()).footerNote).toContain('Nessuna azione ulteriore');
    expect(confirmationHtml(base())).not.toContain('rubrica/opt-out');
    expect(reminderText(base(), baseReminderCopy(base()))).not.toContain('rubrica/opt-out');
  });

  it('per chi e in rubrica sostituisce «nessuna azione» e porta il link firmato', async () => {
    const { baseReminderCopy, reminderHtml: html, reminderText } = await import('./templates');
    const input = { ...base(), addressBookOptOutUrl: OPT_OUT };
    for (const copy of [baseConfirmationCopy(input), baseReminderCopy(input)]) {
      expect(copy.footerNote).not.toContain('Nessuna azione ulteriore');
      expect(copy.footerNote).toContain('rubrica');
    }
    expect(confirmationHtml(input)).toContain(`href="${OPT_OUT}"`);
    expect(confirmationHtml(input)).toContain('Rimuovi i miei dati dalla rubrica');
    expect(confirmationText(input)).toContain(`Rimuovi i miei dati dalla rubrica: ${OPT_OUT}`);
    expect(html(input)).toContain(`href="${OPT_OUT}"`);
    expect(reminderText(input)).toContain(OPT_OUT);
  });

  it('il link resta anche quando la nota e personalizzata dall amministrazione', () => {
    const input = { ...base(), addressBookOptOutUrl: OPT_OUT };
    const resolved = { ...baseConfirmationCopy(input), footerNote: 'Testo dell ente' };
    const out = confirmationHtml(input, resolved);
    expect(out).toContain('Testo dell ente');
    expect(out).toContain(`href="${OPT_OUT}"`);
  });

  it('ha un testo in ogni lingua delle email', async () => {
    const { EMAIL_LOCALES } = await import('./lingua');
    for (const locale of EMAIL_LOCALES) {
      const input = { ...base(), locale, addressBookOptOutUrl: OPT_OUT };
      const note = baseConfirmationCopy(input).footerNote;
      expect(note).not.toBe(baseConfirmationCopy({ ...base(), locale }).footerNote);
      expect(confirmationText(input)).toContain(OPT_OUT);
    }
  });

  it('arriva anche nell email di ringraziamento dopo l evento', async () => {
    const { postEventParticipantEmail } = await import('./templates');
    const mail = postEventParticipantEmail({
      locale: 'en',
      eventTitle: 'Evento',
      eventPageUrl: 'https://example.gov.it/en/events/x',
      addressBookOptOutUrl: OPT_OUT,
    });
    expect(mail.html).toContain(`href="${OPT_OUT}"`);
    expect(mail.text).toContain(`Remove me from the address book: ${OPT_OUT}`);
    const without = postEventParticipantEmail({
      locale: 'en',
      eventTitle: 'Evento',
      eventPageUrl: 'https://example.gov.it/en/events/x',
    });
    expect(without.html).not.toContain('opt-out');
  });
});
