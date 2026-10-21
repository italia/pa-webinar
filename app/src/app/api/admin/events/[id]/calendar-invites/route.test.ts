import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Il reinvio degli inviti di calendario dall'amministrazione: la prova a
 * vuoto conta e non spedisce; l'invio vuole lo slug dell'evento ripetuto e un
 * evento non ancora concluso.
 */
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({})) }));
const requireAdmin = vi.fn();
vi.mock('@/lib/auth/staff-session', () => ({ requireAdmin: () => requireAdmin() }));
vi.mock('@/lib/audit/admin-audit', () => ({ logAdminAction: vi.fn() }));
vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(async () => ({ defaultLocale: 'it' })),
}));
vi.mock('@/lib/db', () => ({ prisma: { event: { findUnique: vi.fn() } } }));
vi.mock('@/lib/email/calendar-invite', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  countCalendarInviteRecipients: vi.fn(async () => ({
    registrations: 120,
    grants: 4,
    primary: 1,
    total: 125,
  })),
  sendCalendarInvites: vi.fn(async () => ({
    recipients: { registrations: 120, grants: 4, primary: 1, total: 125 },
    queued: 125,
    alreadyQueued: 0,
    failed: 0,
  })),
}));

import { logAdminAction } from '@/lib/audit/admin-audit';
import { prisma } from '@/lib/db';
import { sendCalendarInvites } from '@/lib/email/calendar-invite';
import { UnauthorizedError } from '@/lib/errors';

import { GET, POST } from './route';

const db = prisma as unknown as { event: { findUnique: ReturnType<typeof vi.fn> } };
const send = sendCalendarInvites as unknown as ReturnType<typeof vi.fn>;

const EVENT_ID = '0e5c3a9e-4b1d-4c7e-9f2a-6d8b1c3e5f70';
const ctx = { params: Promise.resolve({ id: EVENT_ID }) };
const URL_BASE = `https://portale.example.test/api/admin/events/${EVENT_ID}/calendar-invites`;
const post = (body: unknown) =>
  POST(
    new Request(URL_BASE, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        referer: 'https://portale.example.test/en/admin',
      },
      body: JSON.stringify(body),
    }) as never,
    ctx as never
  );

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ role: 'admin', accountId: null });
  db.event.findUnique.mockResolvedValue({
    id: EVENT_ID,
    slug: 'incontro-mensile',
    status: 'PUBLISHED',
    endsAt: new Date(Date.now() + 86_400_000),
  });
});

describe('GET /api/admin/events/[id]/calendar-invites', () => {
  it('conta i destinatari e non spedisce nulla', async () => {
    const res = await GET(new Request(URL_BASE) as never, ctx as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      dryRun: true,
      sendable: true,
      recipients: { registrations: 120, grants: 4, primary: 1, total: 125 },
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('solo l’amministrazione', async () => {
    requireAdmin.mockRejectedValue(new UnauthorizedError());
    const res = await GET(new Request(URL_BASE) as never, ctx as never);
    expect(res.status).toBe(401);
  });

  it('identificativo malformato: 400; evento inesistente: 404', async () => {
    const bad = await GET(
      new Request(URL_BASE) as never,
      { params: Promise.resolve({ id: 'x' }) } as never
    );
    expect(bad.status).toBe(400);
    db.event.findUnique.mockResolvedValue(null);
    expect((await GET(new Request(URL_BASE) as never, ctx as never)).status).toBe(404);
  });
});

describe('POST /api/admin/events/[id]/calendar-invites', () => {
  it('spedisce solo se il corpo ripete lo slug dell’evento', async () => {
    expect((await post({})).status).toBe(422);
    expect((await post({ confirm: 'un-altro-evento' })).status).toBe(422);
    expect(send).not.toHaveBeenCalled();

    const res = await post({ confirm: 'incontro-mensile' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ queued: 125, alreadyQueued: 0, failed: 0 });
    // La lingua di chi conduce: quella dell'interfaccia da cui parte la richiesta.
    expect(send).toHaveBeenCalledWith(EVENT_ID, { staffLocale: 'en' });
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'EVENT_CALENDAR_INVITES_SEND', target: EVENT_ID })
    );
  });

  it('niente per un evento concluso o in bozza: 409', async () => {
    db.event.findUnique.mockResolvedValue({
      id: EVENT_ID,
      slug: 'incontro-mensile',
      status: 'ENDED',
      endsAt: new Date(Date.now() - 60_000),
    });
    expect((await post({ confirm: 'incontro-mensile' })).status).toBe(409);
    expect(send).not.toHaveBeenCalled();
  });

  it('solo l’amministrazione', async () => {
    requireAdmin.mockRejectedValue(new UnauthorizedError());
    expect((await post({ confirm: 'incontro-mensile' })).status).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });
});
