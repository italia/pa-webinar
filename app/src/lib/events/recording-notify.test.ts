import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findMany: vi.fn(), updateMany: vi.fn() },
    registration: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/crypto/pii', () => ({ decryptPII: (v: string) => v.replace(/^cifrato:/, '') }));
vi.mock('@/lib/email/outbox', () => ({ enqueueEmail: vi.fn(async () => undefined) }));
vi.mock('@/lib/persons/opt-out-link', () => ({ rubricaOptOutUrl: () => null }));
vi.mock('@/lib/auth/app-secret', () => ({ tryGetAppSecret: () => 'segreto-di-prova-abbastanza-lungo-per-hmac' }));

import { prisma } from '@/lib/db';
import { enqueueEmail } from '@/lib/email/outbox';

import { verifyViewingToken } from '@/lib/recording/viewing';

import { notifyPublishedRecordings } from './recording-notify';

const fn = (f: unknown) => f as ReturnType<typeof vi.fn>;
const NOW = new Date('2026-10-10T10:00:00Z');
const evento = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  slug: 'webinar',
  title: { it: 'Webinar', en: 'Webinar' },
  status: 'ENDED',
  eventType: 'SCHEDULED',
  endsAt: new Date('2026-10-08T12:00:00Z'),
  postEventPublic: true,
  postEventPublicUntil: null,
  recordingAudience: 'PUBLIC',
  recordingPublished: true,
  transcriptPublished: false,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  fn(prisma.event.updateMany).mockResolvedValue({ count: 1 });
  fn(prisma.registration.findMany).mockResolvedValue([
    { id: 'r1', email: 'cifrato:anna@ente.it', locale: 'it', person: null },
    { id: 'r2', email: 'cifrato:john@agency.eu', locale: 'en', person: null },
  ]);
});

const opts = { now: NOW, baseUrl: 'https://webinar.example.gov.it', siteName: 'PA Webinar' };

describe('notifyPublishedRecordings', () => {
  it('cerca solo eventi conclusi con registrazione visibile, avviso acceso e non ancora partito', async () => {
    fn(prisma.event.findMany).mockResolvedValue([]);
    await notifyPublishedRecordings(opts);
    const where = fn(prisma.event.findMany).mock.calls[0]?.[0].where;
    expect(where).toMatchObject({ status: 'ENDED', recordingNotifyEnabled: true, recordingNotifiedAt: null });
    expect(where.OR).toEqual([
      { recordingPublished: true, recordingUrl: { not: null } },
      { youtubeUrl: { not: null } },
    ]);
  });

  it("prenota l'evento e avvisa ogni iscritto nella sua lingua, con il link alla pagina", async () => {
    fn(prisma.event.findMany).mockResolvedValue([evento()]);
    const esito = await notifyPublishedRecordings(opts);
    expect(esito).toEqual({ eventsNotified: 1, emailsQueued: 2, emailsFailed: 0 });
    expect(prisma.event.updateMany).toHaveBeenCalledWith({
      where: { id: 'e1', recordingNotifiedAt: null },
      data: { recordingNotifiedAt: NOW },
    });
    const invii = fn(enqueueEmail).mock.calls.map((c) => c[0]);
    expect(invii[0].to).toBe('anna@ente.it');
    expect(invii[0].subject).toContain('registrazione');
    expect(invii[0].html).toContain('https://webinar.example.gov.it/it/eventi/webinar');
    expect(invii[1].subject).toContain('recording');
    expect(invii[0].metadata).toMatchObject({ kind: 'recording_published', eventId: 'e1' });
  });

  it('registrazione riservata agli iscritti: ognuno riceve il suo link personale della visione', async () => {
    fn(prisma.event.findMany).mockResolvedValue([evento({ recordingAudience: 'REGISTRANTS' })]);
    await notifyPublishedRecordings(opts);
    const invii = fn(enqueueEmail).mock.calls.map((c) => c[0]);
    const link = (html: string) => /https:\/\/webinar\.example\.gov\.it\/api\/events\/webinar\/recording\/access\?t=([^&"]+)&(?:amp;)?lang=(\w+)/.exec(html);
    const primo = link(invii[0].html);
    const secondo = link(invii[1].html);
    expect(primo?.[2]).toBe('it');
    expect(secondo?.[2]).toBe('en');
    expect(verifyViewingToken(decodeURIComponent(primo![1]!), 'e1')).toBe('r1');
    expect(verifyViewingToken(decodeURIComponent(secondo![1]!), 'e1')).toBe('r2');
    expect(invii[0].html).not.toContain('/it/eventi/webinar"');
  });

  it('pagina pubblica nascosta: aspetta, senza prenotare', async () => {
    fn(prisma.event.findMany).mockResolvedValue([evento({ postEventPublic: false })]);
    expect(await notifyPublishedRecordings(opts)).toEqual({ eventsNotified: 0, emailsQueued: 0, emailsFailed: 0 });
    expect(prisma.event.updateMany).not.toHaveBeenCalled();
    expect(enqueueEmail).not.toHaveBeenCalled();
  });

  it('un altro giro ha gia’ prenotato: nessun secondo avviso', async () => {
    fn(prisma.event.findMany).mockResolvedValue([evento()]);
    fn(prisma.event.updateMany).mockResolvedValue({ count: 0 });
    expect((await notifyPublishedRecordings(opts)).emailsQueued).toBe(0);
    expect(enqueueEmail).not.toHaveBeenCalled();
  });
});
