// @vitest-environment node
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: { event: { findUnique: vi.fn() } } }));
vi.mock('@/lib/live/presence', () => ({ segnaPresenza: vi.fn(), lasciaPresenza: vi.fn() }));
vi.mock('@/lib/events/panel-read-access', () => ({
  PANEL_READ_EVENT_SELECT: {},
  authorizePanelRead: vi.fn(),
}));

import { deleteCache } from '@/lib/cache';
import { prisma } from '@/lib/db';
import { lasciaPresenza, segnaPresenza } from '@/lib/live/presence';
import { authorizePanelRead } from '@/lib/events/panel-read-access';
import { UnauthorizedError } from '@/lib/errors';

import { POST } from './route';

const SLUG = 'evento-presenze';
const ID = '11111111-1111-4111-8111-111111111111';
const ctx = () => ({ params: Promise.resolve({ param: SLUG }) });
const post = (body: unknown) =>
  new Request(`http://localhost/api/events/${SLUG}/presence`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
const evento = prisma.event.findUnique as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  deleteCache(`presence-event:${SLUG}`);
  evento.mockResolvedValue({ id: 'e1', status: 'LIVE' });
  vi.mocked(authorizePanelRead).mockResolvedValue({ kind: 'guest', registrationId: null, isModerator: false });
});

describe('POST /api/events/[slug]/presence', () => {
  it('segna il luogo e restituisce i conteggi', async () => {
    vi.mocked(segnaPresenza).mockResolvedValue({ inDiretta: 3, inAttesa: 5 });
    const res = await POST(post({ id: ID, luogo: 'attesa' }), ctx());
    expect(await res.json()).toEqual({ inDiretta: 3, inAttesa: 5 });
    expect(segnaPresenza).toHaveBeenCalledWith('e1', ID, 'attesa');
  });

  it('senza Redis: conteggi sconosciuti, non zero', async () => {
    vi.mocked(segnaPresenza).mockResolvedValue(null);
    const res = await POST(post({ id: ID, luogo: 'diretta' }), ctx());
    expect(await res.json()).toEqual({ inDiretta: null, inAttesa: null });
  });

  it('un identificativo che non è un UUID si rifiuta', async () => {
    const res = await POST(post({ id: 'mario.rossi@example.org', luogo: 'attesa' }), ctx());
    expect(res.status).toBe(422);
    expect(segnaPresenza).not.toHaveBeenCalled();
  });

  it('chi chiude la scheda esce dal conto', async () => {
    await POST(post({ id: ID, luogo: 'attesa', lascia: true }), ctx());
    expect(lasciaPresenza).toHaveBeenCalledWith('e1', ID);
    expect(segnaPresenza).not.toHaveBeenCalled();
  });

  it('a evento concluso nessuno è in attesa né in diretta', async () => {
    evento.mockResolvedValue({ id: 'e1', status: 'ENDED' });
    const res = await POST(post({ id: ID, luogo: 'attesa' }), ctx());
    expect(await res.json()).toEqual({ inDiretta: 0, inAttesa: 0 });
  });

  it('chi non ha accesso alla sala non conta e non vede i conteggi', async () => {
    vi.mocked(authorizePanelRead).mockRejectedValue(new UnauthorizedError('Token required'));
    const res = await POST(post({ id: ID, luogo: 'diretta' }), ctx());
    expect(await res.json()).toEqual({ inDiretta: null, inAttesa: null });
    expect(segnaPresenza).not.toHaveBeenCalled();
  });

  it('una bozza o un archivio non hanno sala da contare', async () => {
    evento.mockResolvedValue({ id: 'e1', status: 'DRAFT' });
    const res = await POST(post({ id: ID, luogo: 'attesa' }), ctx());
    expect(await res.json()).toEqual({ inDiretta: null, inAttesa: null });
    expect(segnaPresenza).not.toHaveBeenCalled();
  });

  it('evento inesistente: 404', async () => {
    evento.mockResolvedValue(null);
    const res = await POST(post({ id: ID, luogo: 'attesa' }), ctx());
    expect(res.status).toBe(404);
  });
});
