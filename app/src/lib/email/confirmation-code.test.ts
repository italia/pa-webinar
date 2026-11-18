// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { beforeEach, describe, expect, it, vi } from 'vitest';

import de from '@/i18n/messages/de.json';
import en from '@/i18n/messages/en.json';
import italiano from '@/i18n/messages/it.json';

const mocks = vi.hoisted(() => ({ enqueueEmail: vi.fn(async () => 'riga') }));
vi.mock('@/lib/email/outbox', () => ({ enqueueEmail: mocks.enqueueEmail }));
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const cataloghi = { it: italiano, en, de } as Record<string, typeof italiano>;
  return {
    getTranslations: async ({
      locale,
      namespace,
    }: {
      locale: string;
      namespace: string;
    }) =>
      createTranslator({
        locale,
        messages: cataloghi[locale] ?? en,
        namespace: namespace as never,
      }),
  };
});

import { inviaCodiceDiConferma } from './confirmation-code';

const base = {
  to: 'anna@example.org',
  locale: 'it',
  azione: 'edit' as const,
  eventTitle: 'Riunione <b>del mese</b>',
  codice: '042917',
  minuti: 15,
  registrationId: 'r1',
  siteName: 'PA Webinar',
};
const inviata = () =>
  (mocks.enqueueEmail.mock.calls.at(-1) as unknown as [Record<string, unknown>])[0] as {
    to: string;
    subject: string;
    html: string;
    text: string;
    metadata: Record<string, unknown>;
  };

beforeEach(() => vi.clearAllMocks());

describe('l’email del codice di conferma', () => {
  it('porta il codice solo nel corpo, mai nell’oggetto che resta in chiaro', async () => {
    await inviaCodiceDiConferma(base);
    const mail = inviata();
    expect(mail.to).toBe('anna@example.org');
    expect(mail.subject).toBe('PA Webinar: codice di conferma');
    expect(mail.subject).not.toContain('042917');
    expect(mail.text).toContain('042917');
    expect(mail.html).toContain('042917');
    expect(mail.text).toContain('15 minuti');
    expect(mail.text).not.toMatch(/https?:\/\//);
  });

  it('dice cosa si conferma, con il titolo scappato nell’HTML', async () => {
    await inviaCodiceDiConferma(base);
    expect(inviata().html).toContain('Riunione &lt;b&gt;del mese&lt;/b&gt;');
    await inviaCodiceDiConferma({ ...base, tutte: true });
    expect(inviata().text).toContain(italiano.email.confirmationCode.introEditAll);
    await inviaCodiceDiConferma({ ...base, azione: 'cancel' });
    expect(inviata().text).toContain('Hai chiesto di cancellare la tua iscrizione');
  });

  it('nella lingua email della pagina, con l’inglese per le altre', async () => {
    await inviaCodiceDiConferma({ ...base, locale: 'de' });
    expect(inviata().text).toContain(de.email.confirmationCode.heading);
    await inviaCodiceDiConferma({ ...base, locale: 'fi' });
    expect(inviata().text).toContain(en.email.confirmationCode.heading);
  });

  it('i metadati legano l’email all’iscrizione, senza il codice', async () => {
    await inviaCodiceDiConferma(base);
    expect(inviata().metadata).toEqual({
      kind: 'gdpr-confirmation-code',
      action: 'edit',
      registrationId: 'r1',
    });
  });
});
