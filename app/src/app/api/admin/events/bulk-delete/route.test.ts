// @vitest-environment node
/**
 * Cancellare eventi in blocco dall'area admin.
 *
 * La cascata del database porta via i materiali e i messaggi di chat, ma non i
 * file caricati nello storage: senza cancellarli prima resterebbero scaricabili
 * dal loro URL, senza più nessuna riga da cui la pulizia per retention possa
 * ritrovarli. Se lo storage non risponde gli eventi restano, e si riprova.
 * L'organizzatore cancella solo i propri eventi, e solo i file di quelli.
 */

import type { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { session, files } = vi.hoisted(() => ({
  session: { current: { role: 'admin' } as Record<string, unknown> },
  files: {
    removeFilesOfEventsBeingDeleted: vi.fn(),
  },
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
// La transazione con le righe bloccate: gli stati letti li' decidono tutto.
const tx = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  event: { findMany: vi.fn(), deleteMany: vi.fn() },
}));
vi.mock('@/lib/db', () => ({
  prisma: { $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)) },
}));
vi.mock('@/lib/events/material-files', () => files);

import { AppError } from '@/lib/errors';

import { POST } from './route';

const mockedDeleteMany = tx.event.deleteMany;

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ctx = { params: Promise.resolve({}) } as never;

function post(ids: string[]): NextRequest {
  return new Request('https://webinar.example.gov.it/api/admin/events/bulk-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  session.current = { role: 'admin' };
  tx.event.findMany.mockResolvedValue([{ id: A }, { id: B }]);
  tx.$queryRaw.mockResolvedValue([
    { id: A, status: 'PUBLISHED' },
    { id: B, status: 'ENDED' },
  ]);
  mockedDeleteMany.mockResolvedValue({ count: 2 });
  files.removeFilesOfEventsBeingDeleted.mockResolvedValue(1);
});

describe('POST /api/admin/events/bulk-delete — i file degli eventi', () => {
  it('gli eventi in diretta restano, e la risposta li conta', async () => {
    tx.$queryRaw.mockResolvedValue([
      { id: A, status: 'PUBLISHED' },
      { id: B, status: 'LIVE' },
    ]);
    mockedDeleteMany.mockResolvedValue({ count: 1 });
    const res = await POST(post([A, B]), ctx);
    expect(await res.json()).toEqual({ deleted: 1, skippedLive: 1 });
    expect(files.removeFilesOfEventsBeingDeleted).toHaveBeenCalledWith({ id: { in: [A] } });
    expect(mockedDeleteMany).toHaveBeenCalledWith({ where: { id: { in: [A] } } });
  });

  it('cancella i file prima, poi gli eventi, a righe bloccate', async () => {
    const res = await POST(post([A, B]), ctx);
    expect(res.status).toBe(200);
    expect(String(tx.$queryRaw.mock.calls[0]![0])).toContain('FOR NO KEY UPDATE');
    const where = { id: { in: [A, B] } };
    expect(files.removeFilesOfEventsBeingDeleted).toHaveBeenCalledWith(where);
    expect(mockedDeleteMany).toHaveBeenCalledWith({ where });
    expect(files.removeFilesOfEventsBeingDeleted.mock.invocationCallOrder[0]).toBeLessThan(
      mockedDeleteMany.mock.invocationCallOrder[0]!,
    );
  });

  it('l’organizzatore: si parte solo dai propri eventi', async () => {
    session.current = { role: 'organizer', accountId: 'org-1' };
    await POST(post([A, B]), ctx);
    expect(tx.event.findMany).toHaveBeenCalledWith({
      where: { id: { in: [A, B] }, createdById: 'org-1' },
      select: { id: true },
    });
  });

  it('nessun evento fra i propri: niente da bloccare né da cancellare', async () => {
    tx.event.findMany.mockResolvedValue([]);
    const res = await POST(post([A]), ctx);
    expect(await res.json()).toEqual({ deleted: 0, skippedLive: 0 });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(mockedDeleteMany).not.toHaveBeenCalled();
  });

  it('se i file non si cancellano, gli eventi restano: 503', async () => {
    files.removeFilesOfEventsBeingDeleted.mockRejectedValue(
      new AppError('storage', 503, 'STORAGE_DELETE_FAILED'),
    );
    const res = await POST(post([A]), ctx);
    expect(res.status).toBe(503);
    expect(mockedDeleteMany).not.toHaveBeenCalled();
  });
});
