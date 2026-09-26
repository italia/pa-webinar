import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Il link di chi conduce arriva per email, una volta sola per concessione, in
 * ogni lingua delle email, con l'avviso che e' personale. E non finisce mai in
 * un log: e' una credenziale durevole.
 */
vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn() },
    eventModerator: { findUnique: vi.fn() },
    emailOutbox: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/email/outbox', () => ({ enqueueEmailOnce: vi.fn() }));
vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(async () => ({ siteName: 'Portale eventi', defaultLocale: 'it' })),
}));
vi.mock('@/lib/crypto/pii', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  tryDecryptPII: (v: string | null) => v,
}));

import { prisma } from '@/lib/db';
import { EMAIL_LOCALES } from '@/lib/email/lingua';
import { enqueueEmailOnce } from '@/lib/email/outbox';

import {
  adminRequestLocale,
  moderatorLinkEmail,
  sendGrantModeratorLink,
  sendPrimaryModeratorLink,
} from './moderator-link';

const db = prisma as unknown as {
  event: { findUnique: ReturnType<typeof vi.fn> };
  eventModerator: { findUnique: ReturnType<typeof vi.fn> };
  emailOutbox: { findUnique: ReturnType<typeof vi.fn> };
};
const mockedEnqueue = enqueueEmailOnce as unknown as ReturnType<typeof vi.fn>;

const EVENT_ID = '0e5c3a9e-4b1d-4c7e-9f2a-6d8b1c3e5f70';
const PRIMARY_TOKEN = '7b2f9c1e-3a4d-4e5f-8a6b-9c0d1e2f3a4b';
const GRANT_TOKEN = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';

const previousUrl = process.env.NEXT_PUBLIC_APP_URL;

function eventRow(over: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    slug: 'incontro-mensile',
    title: { it: 'Incontro mensile', en: 'Monthly meeting' },
    status: 'DRAFT',
    startsAt: new Date('2027-03-01T09:00:00Z'),
    timezone: 'Europe/Rome',
    moderatorToken: PRIMARY_TOKEN,
    moderatorName: 'Relatore 1',
    moderatorEmail: 'moderatore@example.test',
    ...over,
  };
}

function grantRow(over: Record<string, unknown> = {}) {
  return {
    id: 'grant-1',
    name: 'Relatrice 2',
    email: 'relatrice@example.test',
    role: 'SPEAKER',
    token: GRANT_TOKEN,
    revokedAt: null,
    event: eventRow(),
    ...over,
  };
}

function queued(): { to: string; subject: string; html: string; text: string; metadata: Record<string, unknown> } {
  expect(mockedEnqueue).toHaveBeenCalledTimes(1);
  return mockedEnqueue.mock.calls[0]![0];
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = 'https://portale.example.test';
  db.emailOutbox.findUnique.mockResolvedValue(null);
  db.event.findUnique.mockResolvedValue(eventRow());
  db.eventModerator.findUnique.mockResolvedValue(grantRow());
  mockedEnqueue.mockResolvedValue(true);
});

afterEach(() => {
  if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = previousUrl;
});

describe('sendPrimaryModeratorLink', () => {
  it('queues the management and room links, localized, with the personal-link warning', async () => {
    expect(await sendPrimaryModeratorLink(EVENT_ID, { locale: 'it' })).toBe(true);
    const mail = queued();
    expect(mail.to).toBe('moderatore@example.test');
    expect(mail.text).toContain(
      `https://portale.example.test/it/admin/eventi/${EVENT_ID}?token=${PRIMARY_TOKEN}`,
    );
    expect(mail.text).toContain(`/it/eventi/incontro-mensile/live?token=${PRIMARY_TOKEN}`);
    expect(mail.text).toContain('Questo link è personale');
    expect(mail.html).toContain('Questo link è personale');
    // L'oggetto resta in chiaro nella coda: niente token.
    expect(mail.subject).toContain('Incontro mensile');
    expect(mail.subject).not.toContain(PRIMARY_TOKEN);
    expect(mail.metadata).toMatchObject({ kind: 'moderator-link', role: 'PRIMARY', eventId: EVENT_ID });
    expect(JSON.stringify(mail.metadata)).not.toContain(PRIMARY_TOKEN);
  });

  it('does not send twice for the same address (publish after create, re-publish)', async () => {
    db.emailOutbox.findUnique.mockResolvedValue({ id: 'already' });
    expect(await sendPrimaryModeratorLink(EVENT_ID, { locale: 'it' })).toBe(false);
    expect(mockedEnqueue).not.toHaveBeenCalled();
    // La chiave e' per evento e indirizzo: un indirizzo nuovo ha la sua.
    const where = db.emailOutbox.findUnique.mock.calls[0]![0].where as { dedupKey: string };
    expect(where.dedupKey).toMatch(new RegExp(`^moderator-link:${EVENT_ID}:primary:[0-9a-f]{64}$`));
  });

  it('two concurrent requests: the unique key lets one through, the other reports not sent', async () => {
    mockedEnqueue.mockResolvedValueOnce(false);
    expect(await sendPrimaryModeratorLink(EVENT_ID, { locale: 'it' })).toBe(false);
    const input = mockedEnqueue.mock.calls[0]![0] as { dedupKey: string };
    expect(input.dedupKey).toMatch(new RegExp(`^moderator-link:${EVENT_ID}:primary:`));
  });

  it('sends nothing without an address or on a concluded event', async () => {
    db.event.findUnique.mockResolvedValue(eventRow({ moderatorEmail: null }));
    expect(await sendPrimaryModeratorLink(EVENT_ID, { locale: 'it' })).toBe(false);
    db.event.findUnique.mockResolvedValue(eventRow({ status: 'ENDED' }));
    expect(await sendPrimaryModeratorLink(EVENT_ID, { locale: 'it' })).toBe(false);
    expect(mockedEnqueue).not.toHaveBeenCalled();
  });

  it('never logs the link when queueing fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockedEnqueue.mockRejectedValue(new Error(`insert failed: token=${PRIMARY_TOKEN}`));
    expect(await sendPrimaryModeratorLink(EVENT_ID, { locale: 'it' })).toBe(false);
    expect(spy).toHaveBeenCalled();
    expect(JSON.stringify(spy.mock.calls)).not.toContain(PRIMARY_TOKEN);
    spy.mockRestore();
  });
});

describe('sendGrantModeratorLink', () => {
  it('sends a speaker the room link with the speaker wording', async () => {
    expect(await sendGrantModeratorLink('grant-1', { locale: 'en' })).toBe(true);
    const mail = queued();
    expect(mail.to).toBe('relatrice@example.test');
    expect(mail.subject).toBe('You are a speaker: Monthly meeting');
    expect(mail.text).toContain(`/en/events/incontro-mensile/live?token=${GRANT_TOKEN}`);
    expect(mail.text).not.toContain('/admin/');
    expect(mail.text).toContain('This link is personal');
    expect(mail.metadata).toMatchObject({ role: 'SPEAKER', grantId: 'grant-1' });
  });

  it('sends a co-moderator the moderation wording', async () => {
    db.eventModerator.findUnique.mockResolvedValue(grantRow({ role: 'MODERATOR' }));
    await sendGrantModeratorLink('grant-1', { locale: 'it' });
    expect(queued().subject).toBe('Sei co-moderatore: Incontro mensile');
  });

  it('sends nothing for a revoked grant or one without an address', async () => {
    db.eventModerator.findUnique.mockResolvedValue(grantRow({ revokedAt: new Date() }));
    expect(await sendGrantModeratorLink('grant-1', { locale: 'it' })).toBe(false);
    db.eventModerator.findUnique.mockResolvedValue(grantRow({ email: null }));
    expect(await sendGrantModeratorLink('grant-1', { locale: 'it' })).toBe(false);
    expect(mockedEnqueue).not.toHaveBeenCalled();
  });
});

describe('moderatorLinkEmail', () => {
  it('has every role and the personal-link line in every email language', () => {
    for (const locale of EMAIL_LOCALES) {
      for (const role of ['PRIMARY', 'MODERATOR', 'SPEAKER'] as const) {
        const mail = moderatorLinkEmail({
          locale,
          role,
          name: '<b>Nome</b>',
          eventTitle: 'Evento',
          eventDate: 'lunedì 1 marzo 2027',
          eventTime: '10:00',
          liveUrl: 'https://portale.example.test/x/live?token=t',
          manageUrl: 'https://portale.example.test/x/admin?token=t',
        });
        expect(mail.subject.length).toBeGreaterThan(0);
        expect(mail.html).toContain('https://portale.example.test/x/live?token=t');
        // Il nome non diventa markup.
        expect(mail.html).not.toContain('<b>Nome</b>');
        // Solo il principale ha il link di gestione.
        expect(mail.text.includes('/x/admin?token=t')).toBe(role === 'PRIMARY');
      }
    }
  });
});

describe('adminRequestLocale', () => {
  const req = (url: string, referer?: string) =>
    new Request(url, { headers: referer ? { referer } : {} });

  it('prefers ?locale=, then the admin page it comes from, then the instance default', () => {
    expect(adminRequestLocale(req('https://p.test/api/events?locale=de'), 'it')).toBe('de');
    expect(adminRequestLocale(req('https://p.test/api/events', 'https://p.test/es/admin/eventi/nuovo'), 'it')).toBe('es');
    expect(adminRequestLocale(req('https://p.test/api/events', 'https://p.test/api/other'), 'fr')).toBe('fr');
    expect(adminRequestLocale(req('https://p.test/api/events'), null)).toBe('it');
  });
});
