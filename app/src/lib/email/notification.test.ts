import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * L'avviso di cambio data sposta la voce di calendario: lo stesso UID
 * personale della conferma, una SEQUENCE piu' alta, la nuova ora.
 */
vi.mock('@/lib/db', () => ({ prisma: { event: { findUnique: vi.fn() } } }));
vi.mock('@/lib/crypto/pii', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  decryptPII: (v: string) => v,
}));
vi.mock('@/lib/ical/organizer', () => ({
  nomeOrganizzatoreCalendario: vi.fn(async () => 'Ente di prova'),
}));
vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(async () => ({ defaultLocale: 'it' })),
}));
vi.mock('@/lib/email/outbox', () => ({ enqueueEmail: vi.fn(async () => 'id') }));

import { prisma } from '@/lib/db';
import { enqueueEmail } from '@/lib/email/outbox';
import { invitationUid } from '@/lib/ical/invitation';

import { sendDateChangeNotifications } from './notification';

const db = prisma as unknown as { event: { findUnique: ReturnType<typeof vi.fn> } };
const enqueue = enqueueEmail as unknown as ReturnType<typeof vi.fn>;
const EVENT_ID = '0e5c3a9e-4b1d-4c7e-9f2a-6d8b1c3e5f70';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = 'https://portale.example.test';
  db.event.findUnique.mockResolvedValue({
    id: EVENT_ID,
    slug: 'incontro',
    title: { it: 'Incontro', en: 'Meeting' },
    description: { it: 'Descrizione' },
    startsAt: new Date('2026-11-05T14:00:00Z'),
    endsAt: new Date('2026-11-05T15:00:00Z'),
    timezone: 'Europe/Rome',
    updatedAt: new Date('2026-10-20T08:00:00Z'),
    registrations: [
      { id: 'reg-1', email: 'anna@example.test', accessToken: 'tok-anna', locale: 'it' },
      { id: 'reg-2', email: 'bob@example.test', accessToken: 'tok-bob', locale: 'en' },
    ],
  });
});

describe('sendDateChangeNotifications', () => {
  it('ogni iscritto riceve il suo invito aggiornato, con il suo UID e il suo link', async () => {
    sendDateChangeNotifications({ eventId: EVENT_ID });
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledTimes(2));
    const mails = enqueue.mock.calls.map(
      (c) =>
        c[0] as {
          to: string;
          subject: string;
          calendarInvite: { method: string; content: string };
        }
    );
    const anna = mails.find((m) => m.to === 'anna@example.test')!;
    const bob = mails.find((m) => m.to === 'bob@example.test')!;
    const ics = anna.calendarInvite.content.replace(/\r\n /g, '');
    expect(anna.calendarInvite.method).toBe('REQUEST');
    expect(ics).toContain(
      `UID:${invitationUid(EVENT_ID, 'registration', 'anna@example.test')}`
    );
    expect(ics).toContain('DTSTART;TZID=Europe/Rome:20261105T150000');
    expect(ics).toContain(
      'URL:https://portale.example.test/it/eventi/incontro/live?token=tok-anna'
    );
    expect(bob.subject).toContain('Meeting');
    expect(bob.calendarInvite.content.replace(/\r\n /g, '')).toContain(
      '/en/events/incontro/live?token=tok-bob'
    );
  });
});
