import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findMany: vi.fn(), updateMany: vi.fn() },
    registration: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/email/outbox', () => ({ enqueueEmail: vi.fn() }));
vi.mock('@/lib/events/recap', () => ({
  ensureEventRecap: vi.fn(async () => null),
  formatRecapSummary: vi.fn(() => 'summary'),
}));
vi.mock('@/lib/crypto/pii', () => ({
  decryptPII: vi.fn((x: string) => `dec:${x}`),
  tryDecryptPII: vi.fn((x: string | null) => (x ? `dec:${x}` : null)),
}));
vi.mock('@/lib/utils/localized-url', () => ({
  localizedUrl: vi.fn(() => 'https://x.gov.it/it/events/e'),
}));

import { prisma } from '@/lib/db';
import { enqueueEmail } from '@/lib/email/outbox';

import { finalizePostEventEmails } from './post-event-finalize';

const db = prisma as unknown as {
  event: { findMany: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
  registration: { findMany: ReturnType<typeof vi.fn> };
};
const enqueue = enqueueEmail as unknown as ReturnType<typeof vi.fn>;

const EVENT = {
  id: 'evt1',
  slug: 'e',
  title: { it: 'Titolo', en: 'Title' },
  moderatorEmail: 'mod@x.it',
  recordingPublished: false,
  recordingUrl: null,
};

const OPTS = { now: new Date('2026-07-07T10:00:00Z'), baseUrl: 'https://x.gov.it', siteName: 'PA' };

describe('finalizePostEventEmails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.event.findMany.mockResolvedValue([EVENT]);
    db.event.updateMany.mockResolvedValue({ count: 1 });
    db.registration.findMany.mockResolvedValue([
      { id: 'r1', email: 'a@x.it' },
      { id: 'r2', email: 'b@x.it' },
    ]);
  });

  it('reclama l’evento e invia a partecipanti + moderatore', async () => {
    const res = await finalizePostEventEmails(OPTS);
    expect(res.eventsFinalized).toBe(1);
    expect(res.emailsSent).toBe(3); // 2 partecipanti + 1 moderatore
    expect(enqueue).toHaveBeenCalledTimes(3);
    // Claim guardato su postEventEmailSentAt null
    expect(db.event.updateMany).toHaveBeenCalledWith({
      where: { id: 'evt1', postEventEmailSentAt: null },
      data: { postEventEmailSentAt: OPTS.now },
    });
  });

  it('NON invia se il claim fallisce (già reclamato da un altro run)', async () => {
    db.event.updateMany.mockResolvedValue({ count: 0 });
    const res = await finalizePostEventEmails(OPTS);
    expect(res.eventsFinalized).toBe(0);
    expect(res.emailsSent).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
    // le registrazioni non vengono nemmeno lette dopo un claim fallito
    expect(db.registration.findMany).not.toHaveBeenCalled();
  });

  it('salta l’email moderatore se manca l’indirizzo', async () => {
    db.event.findMany.mockResolvedValue([{ ...EVENT, moderatorEmail: null }]);
    const res = await finalizePostEventEmails(OPTS);
    expect(res.emailsSent).toBe(2); // solo i 2 partecipanti
  });

  it('non fa nulla quando non ci sono eventi idonei', async () => {
    db.event.findMany.mockResolvedValue([]);
    const res = await finalizePostEventEmails(OPTS);
    expect(res).toEqual({ eventsFinalized: 0, emailsSent: 0, emailsFailed: 0 });
    expect(enqueue).not.toHaveBeenCalled();
  });
});
