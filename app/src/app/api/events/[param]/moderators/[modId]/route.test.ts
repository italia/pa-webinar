import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Il profilo di una persona dell'evento (ente, logo, organizzatore, pagina
 * pubblica) si cambia senza toccare il suo link, e solo con il link
 * principale.
 */
vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn() },
    eventModerator: { findUnique: vi.fn(), update: vi.fn() },
    emailOutbox: { count: vi.fn(async () => 0) },
  },
}));
vi.mock('@/lib/crypto/pii', () => ({
  tryDecryptPII: (v: string | null) => v,
  hashEmail: (v: string) => `hash:${v}`,
}));
vi.mock('@/lib/auth/moderator', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invalidateModeratorCache: vi.fn(),
}));

const reinvio = vi.hoisted(() => ({ resend: vi.fn(async () => true) }));
vi.mock('@/lib/email/moderator-link', () => ({
  NO_SEND_STATUSES: new Set(['DRAFT', 'ENDED', 'ARCHIVED']),
  resendGrantModeratorLink: reinvio.resend,
  adminRequestLocale: () => 'it',
}));
vi.mock('@/lib/settings', () => ({ getSettings: vi.fn(async () => ({ defaultLocale: 'it' })) }));

const organizerMark = vi.hoisted(() => ({ allowed: true }));
vi.mock('@/lib/auth/organizer-mark', async () => {
  const { ForbiddenError } = await import('@/lib/errors');
  return {
    requireOrganizerMarkRight: vi.fn(async () => {
      if (!organizerMark.allowed) throw new ForbiddenError('Only staff who manage the event can name an organizer');
    }),
  };
});

import { prisma } from '@/lib/db';

import { PATCH, POST } from './route';

const db = prisma as unknown as {
  event: { findUnique: ReturnType<typeof vi.fn> };
  eventModerator: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  emailOutbox: { count: ReturnType<typeof vi.fn> };
};

const EVENT_ID = '0e5c3a9e-4b1d-4c7e-9f2a-6d8b1c3e5f70';
const MOD_ID = '5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const PRIMARY = '7b2f9c1e-3a4d-4e5f-8a6b-9c0d1e2f3a4b';

let ip = 0;
function patch(body: Record<string, unknown>, token = PRIMARY): Request {
  ip += 1;
  return new Request(`https://portale.example.test/api/events/${EVENT_ID}/moderators/${MOD_ID}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'x-forwarded-for': `198.51.100.${ip}`,
    },
    body: JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ param: EVENT_ID, modId: MOD_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  organizerMark.allowed = true;
  db.event.findUnique.mockResolvedValue({ id: EVENT_ID, moderatorToken: PRIMARY });
  db.eventModerator.findUnique.mockResolvedValue({ id: MOD_ID, eventId: EVENT_ID, role: 'SPEAKER' });
  db.eventModerator.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: MOD_ID,
    name: 'Relatore 1',
    role: 'SPEAKER',
    organizer: false,
    organization: null,
    organizationLogoUrl: null,
    publicListed: false,
    ...data,
  }));
});

describe('PATCH /api/events/[param]/moderators/[modId]', () => {
  it("aggiorna solo i campi del profilo mandati", async () => {
    const res = await PATCH(
      patch({ organization: 'Ente di esempio', publicListed: true }) as never,
      ctx as never,
    );
    expect(res.status).toBe(200);
    expect(db.eventModerator.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: MOD_ID },
        data: { organization: 'Ente di esempio', publicListed: true },
      }),
    );
    expect(await res.json()).toMatchObject({ organization: 'Ente di esempio', publicListed: true });
  });

  it("un ente vuoto si toglie", async () => {
    await PATCH(patch({ organization: '' }) as never, ctx as never);
    expect(db.eventModerator.update.mock.calls[0]![0].data).toEqual({ organization: null });
  });

  it("una concessione senza impronta la riceve, per riconoscere l'account dello staff", async () => {
    db.eventModerator.findUnique.mockResolvedValue({
      id: MOD_ID,
      eventId: EVENT_ID,
      role: 'MODERATOR',
      email: 'org@example.test',
      emailHash: null,
    });
    await PATCH(patch({ organizer: true }) as never, ctx as never);
    expect(db.eventModerator.update.mock.calls[0]![0].data).toEqual({
      organizer: true,
      emailHash: 'hash:org@example.test',
    });
  });

  it('una concessione già da organizzatore non riceve l’impronta senza il controllo', async () => {
    db.eventModerator.findUnique.mockResolvedValue({
      id: MOD_ID,
      eventId: EVENT_ID,
      role: 'MODERATOR',
      organizer: true,
      email: 'org@example.test',
      emailHash: null,
    });
    await PATCH(patch({ publicListed: true }) as never, ctx as never);
    expect(db.eventModerator.update.mock.calls[0]![0].data).toEqual({ publicListed: true });
  });

  it('una concessione senza segno riceve l’impronta anche con il solo link', async () => {
    organizerMark.allowed = false;
    db.eventModerator.findUnique.mockResolvedValue({
      id: MOD_ID,
      eventId: EVENT_ID,
      role: 'SPEAKER',
      organizer: false,
      email: 'rel@example.test',
      emailHash: null,
    });
    await PATCH(patch({ publicListed: true }) as never, ctx as never);
    expect(db.eventModerator.update.mock.calls[0]![0].data).toEqual({
      publicListed: true,
      emailHash: 'hash:rel@example.test',
    });
  });

  it('dare il segno di organizzatore chiede chi gestisce già l’evento; toglierlo no', async () => {
    organizerMark.allowed = false;
    db.eventModerator.findUnique.mockResolvedValue({
      id: MOD_ID,
      eventId: EVENT_ID,
      role: 'MODERATOR',
      organizer: false,
      emailHash: 'h',
    });
    expect((await PATCH(patch({ organizer: true }) as never, ctx as never)).status).toBe(403);
    expect(db.eventModerator.update).not.toHaveBeenCalled();

    db.eventModerator.findUnique.mockResolvedValue({
      id: MOD_ID,
      eventId: EVENT_ID,
      role: 'MODERATOR',
      organizer: true,
      emailHash: 'h',
    });
    expect((await PATCH(patch({ organizer: false }) as never, ctx as never)).status).toBe(200);
  });

  it('un relatore non diventa organizzatore', async () => {
    const res = await PATCH(patch({ organizer: true }) as never, ctx as never);
    expect(res.status).toBe(422);
    expect(db.eventModerator.update).not.toHaveBeenCalled();
  });

  it('serve il link principale', async () => {
    const res = await PATCH(
      patch({ publicListed: true }, '00000000-0000-4000-8000-000000000000') as never,
      ctx as never,
    );
    expect(res.status).toBe(403);
    expect(db.eventModerator.update).not.toHaveBeenCalled();
  });

  it("una persona di un altro evento non si tocca", async () => {
    db.eventModerator.findUnique.mockResolvedValue({ id: MOD_ID, eventId: 'altro', role: 'SPEAKER' });
    const res = await PATCH(patch({ publicListed: true }) as never, ctx as never);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/events/[param]/moderators/[modId] — «Reinvia link»', () => {
  const MOD_RESEND = '6e2d3c4b-5f6a-4b7c-9d8e-0f1a2b3c4d5e';
  const ctxResend = { params: Promise.resolve({ param: EVENT_ID, modId: MOD_RESEND }) };
  const post = (token = PRIMARY) =>
    new Request(`https://portale.example.test/api/events/${EVENT_ID}/moderators/${MOD_RESEND}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });

  beforeEach(() => {
    db.event.findUnique.mockResolvedValue({ id: EVENT_ID, moderatorToken: PRIMARY, status: 'PUBLISHED' });
    db.eventModerator.findUnique.mockResolvedValue({
      id: MOD_RESEND,
      eventId: EVENT_ID,
      role: 'SPEAKER',
      email: 'relatore@example.org',
      revokedAt: null,
    });
  });

  it('rimette in coda il link della persona', async () => {
    const res = await POST(post() as never, ctxResend as never);
    expect(res.status).toBe(200);
    expect(reinvio.resend).toHaveBeenCalledWith(MOD_RESEND, { locale: 'it' });
  });

  it('solo con il link principale', async () => {
    const res = await POST(post('altro-token') as never, ctxResend as never);
    expect(res.status).toBe(403);
    expect(reinvio.resend).not.toHaveBeenCalled();
  });

  it('in bozza, a evento concluso, revocata o senza indirizzo non parte, e lo dice', async () => {
    db.event.findUnique.mockResolvedValueOnce({ id: EVENT_ID, moderatorToken: PRIMARY, status: 'DRAFT' });
    expect((await (await POST(post() as never, ctxResend as never)).json()).code).toBe('EVENT_DRAFT');
    db.event.findUnique.mockResolvedValueOnce({ id: EVENT_ID, moderatorToken: PRIMARY, status: 'ENDED' });
    expect((await (await POST(post() as never, ctxResend as never)).json()).code).toBe('EVENT_ENDED');
    db.eventModerator.findUnique.mockResolvedValueOnce({ id: MOD_RESEND, eventId: EVENT_ID, email: 'x@y.it', revokedAt: new Date() });
    expect((await (await POST(post() as never, ctxResend as never)).json()).code).toBe('GRANT_REVOKED');
    db.eventModerator.findUnique.mockResolvedValueOnce({ id: MOD_RESEND, eventId: EVENT_ID, email: null, revokedAt: null });
    expect((await (await POST(post() as never, ctxResend as never)).json()).code).toBe('GRANT_NO_EMAIL');
    expect(reinvio.resend).not.toHaveBeenCalled();
  });

  it('con tre email del link gia\' in coda negli ultimi dieci minuti risponde 429', async () => {
    db.emailOutbox.count.mockResolvedValueOnce(3);
    const res = await POST(post() as never, ctxResend as never);
    expect(res.status).toBe(429);
    expect(reinvio.resend).not.toHaveBeenCalled();
    const where = db.emailOutbox.count.mock.calls[0]![0].where;
    expect(where.metadata).toEqual({ path: ['grantId'], equals: MOD_RESEND });
    expect(Date.now() - where.createdAt.gte.getTime()).toBeGreaterThanOrEqual(10 * 60_000 - 1000);
  });

  it('un invio che non va in coda risponde 500 senza consumare il limite', async () => {
    reinvio.resend.mockResolvedValueOnce(false);
    expect((await POST(post() as never, ctxResend as never)).status).toBe(500);
  });
});

