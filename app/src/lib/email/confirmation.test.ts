// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * La conferma d'iscrizione porta l'invito di calendario personale: chi si
 * iscrive vede in Gmail o Outlook la scheda «aggiungi / accetta», con il link
 * della sala (senza la firma del link dell'email, che resta nell'email).
 */
vi.mock('next-intl/server', () => ({ getTranslations: async () => (chiave: string) => chiave }));
vi.mock('@/lib/db', () => ({
  prisma: { registration: { findUnique: vi.fn(), update: vi.fn() } },
}));
vi.mock('@/lib/crypto/pii', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  decryptPII: (v: string) => v,
}));
vi.mock('@/lib/ical/organizer', () => ({
  nomeOrganizzatoreCalendario: vi.fn(async () => 'Ente di prova'),
}));
vi.mock('@/lib/email/resolve-template', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadEmailTemplateOverride: vi.fn(async () => null),
}));
vi.mock('@/lib/email/outbox', () => ({ enqueueEmail: vi.fn(async () => 'id') }));
vi.mock('@/lib/settings', () => ({ getSettings: vi.fn(async () => ({})) }));

import { prisma } from '@/lib/db';
import { enqueueEmail } from '@/lib/email/outbox';
import { getSettings } from '@/lib/settings';

import { sendConfirmationEmail } from './confirmation';

const db = prisma as unknown as {
  registration: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};
const enqueue = enqueueEmail as unknown as ReturnType<typeof vi.fn>;

const EVENT_ID = '0e5c3a9e-4b1d-4c7e-9f2a-6d8b1c3e5f70';
const SIGNED =
  'https://portale.example.test/api/events/incontro/registrations/enter?token=tok-1&proof=firma';
const ROOM = 'https://portale.example.test/it/eventi/incontro/live?token=tok-1';

const iscrizione = () => ({
  id: 'reg-1',
  email: 'anna@example.test',
  person: null,
  event: {
    id: EVENT_ID,
    slug: 'incontro',
    title: { it: 'Incontro' },
    description: { it: 'Descrizione' },
    startsAt: new Date('2026-10-21T09:00:00Z'),
    endsAt: new Date('2026-10-21T10:30:00Z'),
    timezone: 'Europe/Rome',
    updatedAt: new Date('2026-10-01T08:00:00Z'),
    imageUrl: null,
    coverImageUrl: null,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = 'https://portale.example.test';
  process.env.SMTP_FROM = 'eventi@portale.example.test';
  db.registration.findUnique.mockResolvedValue(iscrizione());
});

describe('sendConfirmationEmail', () => {
  it('accoda la conferma con l’invito personale al posto del file pubblico', async () => {
    await sendConfirmationEmail({
      registrationId: 'reg-1',
      locale: 'it',
      joinUrl: SIGNED,
      calendarJoinUrl: ROOM,
      eventPageUrl: 'https://portale.example.test/it/eventi/incontro',
    });
    expect(enqueue).toHaveBeenCalledTimes(1);
    const mail = enqueue.mock.calls[0]![0] as {
      to: string;
      text: string;
      attachments?: unknown;
      calendarInvite: { method: string; content: string };
    };
    expect(mail.to).toBe('anna@example.test');
    expect(mail.attachments).toBeUndefined();
    expect(mail.calendarInvite.method).toBe('REQUEST');
    const ics = mail.calendarInvite.content.replace(/\r\n /g, '');
    expect(ics).toMatch(/^ATTENDEE;[^\r\n]*:mailto:anna@example\.test\r?$/m);
    expect(ics).toContain(`URL:${ROOM}`);
    expect(ics).not.toContain('proof=');
    expect(ics).toContain('DTSTART;TZID=Europe/Rome:20261021T110000');
    expect(ics).toContain(
      'ORGANIZER;CN="Ente di prova":mailto:eventi@portale.example.test'
    );
    // Nell'email resta il link firmato.
    expect(mail.text).toContain(SIGNED);
    expect(db.registration.update).toHaveBeenCalled();
  });

  describe('con una spunta della rubrica in attesa di conferma', () => {
    const NOTA = 'addressBookPendingNote';
    const invia = async (campi: Record<string, unknown>, evento?: Record<string, unknown>) => {
      const base = iscrizione();
      db.registration.findUnique.mockResolvedValue({
        ...base,
        ...campi,
        event: { ...base.event, ...evento },
      });
      await sendConfirmationEmail({
        registrationId: 'reg-1',
        locale: 'it',
        joinUrl: SIGNED,
        eventPageUrl: 'https://portale.example.test/it/eventi/incontro',
      });
      return enqueue.mock.calls[0]![0] as { text: string; html: string };
    };

    it('lo dice, sopra il link alla pagina dei propri dati', async () => {
      const mail = await invia({ addressBookPending: true });
      expect(mail.html).toContain(NOTA);
      expect(mail.text.indexOf(NOTA)).toBeGreaterThan(-1);
      expect(mail.text.indexOf(NOTA)).toBeLessThan(mail.text.indexOf('myDataLink'));
    });

    it('senza spunta in attesa non dice niente', async () => {
      const mail = await invia({ addressBookPending: false });
      expect(mail.text).not.toContain(NOTA);
      expect(mail.html).not.toContain(NOTA);
    });

    it('tace dove la rubrica non si propone piu’: l’evento non la offre', async () => {
      const mail = await invia({ addressBookPending: true }, { offerAddressBook: false });
      expect(mail.text).not.toContain(NOTA);
    });

    it('tace dove la rubrica non si propone piu’: l’installazione l’ha spenta', async () => {
      vi.mocked(getSettings).mockResolvedValueOnce({ addressBookEnabled: false } as never);
      const mail = await invia({ addressBookPending: true });
      expect(mail.text).not.toContain(NOTA);
    });
  });
});
