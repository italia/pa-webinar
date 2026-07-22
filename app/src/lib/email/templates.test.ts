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
  eventTitle: 'Sync DesIt + DevIt',
  eventDate: 'mercoledì 22 luglio 2026',
  eventTime: '11:15',
  eventDuration: '45 min',
  joinUrl: 'https://example.gov.it/it/events/x/live?token=abc',
  eventPageUrl: 'https://example.gov.it/it/events/x',
  siteName: 'PA Webinar',
});

describe('confirmation email', () => {
  it('puts the event name in the subject', () => {
    expect(baseConfirmationCopy(base()).subject).toContain('Sync DesIt + DevIt');
    expect(baseConfirmationCopy({ ...base(), locale: 'en' }).subject).toContain('Sync DesIt + DevIt');
  });

  it('shows the event name prominently in the body, not just in the table', () => {
    const html = confirmationHtml(base());
    // Once as the headline under the heading, once in the details table.
    const occurrences = html.split('Sync DesIt + DevIt').length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it('keeps the event name in the plain-text part', () => {
    expect(confirmationText(base())).toContain('Sync DesIt + DevIt');
  });

  it('renders the event banner when the event has an image', () => {
    const html = confirmationHtml({
      ...base(),
      eventImageUrl: 'https://example.gov.it/api/assets/image/2026/07/banner.png',
    });
    expect(html).toContain('<img src="https://example.gov.it/api/assets/image/2026/07/banner.png"');
    expect(html).toContain('alt="Sync DesIt + DevIt"');
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

  it('prefers imageUrl over coverImageUrl', () => {
    expect(
      absoluteEventImage({ imageUrl: 'https://x/a.png', coverImageUrl: 'https://x/b.png' }, BASE),
    ).toBe('https://x/a.png');
  });

  it('falls back to the cover image', () => {
    expect(absoluteEventImage({ imageUrl: null, coverImageUrl: 'https://x/b.png' }, BASE)).toBe(
      'https://x/b.png',
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
