// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { describe, it, expect } from 'vitest';

import { postEventParticipantEmail, postEventModeratorEmail } from './templates';

describe('postEventParticipantEmail', () => {
  const base = {
    locale: 'it' as const,
    eventTitle: 'Caffè Digitale',
    eventPageUrl: 'https://x.gov.it/it/events/caffe',
  };

  it('include titolo, link pagina evento e CTA feedback', () => {
    const m = postEventParticipantEmail(base);
    expect(m.subject).toContain('Caffè Digitale');
    expect(m.html).toContain(base.eventPageUrl);
    expect(m.html).toContain('feedback');
    expect(m.text).toContain(base.eventPageUrl);
  });

  it('usa la copy inglese per locale en', () => {
    const m = postEventParticipantEmail({ ...base, locale: 'en' });
    expect(m.subject).toContain('Thanks for attending');
  });
});

describe('postEventModeratorEmail', () => {
  const base = {
    locale: 'it' as const,
    eventTitle: 'Caffè Digitale',
    eventPageUrl: 'https://x.gov.it/it/events/caffe',
    recapSummary: 'Partecipanti (picco): 42\nRegistrati: 100',
  };

  it('l’indirizzo del video non esce dall’attributo del link', () => {
    const m = postEventModeratorEmail({
      ...base,
      recordingUrl: 'https://video.example.com/v"onclick="x',
    });
    expect(m.html).not.toContain('"onclick="x');
    expect(m.html).toContain('https://video.example.com/v&quot;onclick=&quot;x');
  });

  it('include il riepilogo e il link alla pagina evento', () => {
    const m = postEventModeratorEmail(base);
    expect(m.subject).toContain('Caffè Digitale');
    expect(m.html).toContain('42');
    expect(m.text).toContain('Partecipanti (picco): 42');
    expect(m.html).toContain(base.eventPageUrl);
  });

  it('mostra il link registrazione solo se presente', () => {
    const withRec = postEventModeratorEmail({
      ...base,
      recordingUrl: 'https://x.gov.it/rec.mp4',
    });
    expect(withRec.html).toContain('https://x.gov.it/rec.mp4');
    expect(withRec.text).toContain('https://x.gov.it/rec.mp4');

    const withoutRec = postEventModeratorEmail({ ...base, recordingUrl: null });
    expect(withoutRec.html).not.toContain('rec.mp4');
  });

  it('omette il blocco riepilogo se vuoto', () => {
    const m = postEventModeratorEmail({ ...base, recapSummary: '' });
    expect(m.html).not.toContain('<pre');
  });
});
