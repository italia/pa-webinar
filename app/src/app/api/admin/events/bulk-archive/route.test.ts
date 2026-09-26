// @vitest-environment node
/**
 * Archiviare eventi in blocco dall'area admin.
 *
 * Un evento archiviato mentre era in servizio (LIVE, in pausa, in
 * preparazione) chiude le sue sessioni di chiamata nella stessa transazione:
 * altrimenti resterebbero senza fine e le statistiche riporterebbero la
 * finestra programmata. Quelle di un evento già concluso le ripara il giro del
 * ciclo di vita, con un orario stimato, non «adesso».
 */

import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { session, sessioni } = vi.hoisted(() => ({
  session: { current: { role: 'admin' } as Record<string, unknown> },
  sessioni: { closeOpenSessions: vi.fn(async () => 0) },
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => ({ value: 'staff-session' }) })),
}));
vi.mock('@/lib/auth/staff-session', () => ({
  requireStaff: vi.fn(async () => session.current),
  eventScope: (s: { role: string; accountId?: string }) =>
    s.role === 'admin' ? {} : { createdById: s.accountId },
}));
vi.mock('@/lib/audit/admin-audit', () => ({
  logAdminAction: vi.fn(async () => undefined),
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findMany: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('@/lib/events/call-sessions', () => sessioni);

import { prisma } from '@/lib/db';

import { POST } from './route';

const db = prisma as unknown as {
  event: { findMany: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const ctx = { params: Promise.resolve({}) } as never;

function post(ids: string[]): NextRequest {
  return new Request('https://webinar.example.gov.it/api/admin/events/bulk-archive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  session.current = { role: 'admin' };
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
  db.event.updateMany.mockResolvedValue({ count: 3 });
  db.event.findMany.mockResolvedValue([
    { id: A, status: 'LIVE' },
    { id: B, status: 'ENDED' },
    { id: C, status: 'IDLE' },
  ]);
});

describe('POST /api/admin/events/bulk-archive — sessioni di chiamata', () => {
  it('archivia e chiude le sessioni dei soli eventi ancora in servizio', async () => {
    const res = await POST(post([A, B, C]), ctx);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ archived: 3 });
    expect(db.event.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [A, B, C] } },
      data: { status: 'ARCHIVED' },
    });
    expect(sessioni.closeOpenSessions).toHaveBeenCalledWith(prisma, [A, C], expect.any(Date));
  });

  it('l\'organizzatore resta nel perimetro dei propri eventi, anche per le sessioni', async () => {
    session.current = { role: 'organizer', accountId: 'acc-1' };

    await POST(post([A]), ctx);

    const where = { id: { in: [A] }, createdById: 'acc-1' };
    expect(db.event.findMany).toHaveBeenCalledWith({ where, select: { id: true, status: true } });
    expect(db.event.updateMany).toHaveBeenCalledWith({ where, data: { status: 'ARCHIVED' } });
  });
});
