// @vitest-environment node
/**
 * Il glossario di un evento: chi lo modera col proprio token, oppure lo
 * staff che gestisce l'evento. Le modifiche toccano solo le voci di
 * quell'evento.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock('@/lib/auth/staff-session', () => ({ requireEventManager: vi.fn() }));
vi.mock('@/lib/auth/moderator', () => ({
  extractModeratorToken: vi.fn((r: Request) => r.headers.get('authorization')?.replace(/^Bearer /, '') || null),
  isEventModerator: vi.fn(async (e: { moderatorToken: string }, t: string) => e.moderatorToken === t),
}));
vi.mock('@/lib/db', () => ({ prisma: { event: { findUnique: vi.fn() } } }));
vi.mock('@/lib/ai/glossary', async (importOriginal) => ({
  ...(await importOriginal<typeof GlossaryModule>()),
  listGlossary: vi.fn(async (eventId: string | null) => [{ id: eventId ?? 'istanza' }]),
  createGlossaryTerm: vi.fn(async () => ({ id: 'nuova' })),
  updateGlossaryTerm: vi.fn(async () => ({ id: 'voce' })),
  deleteGlossaryTerm: vi.fn(),
}));

import type * as GlossaryModule from '@/lib/ai/glossary';
import { createGlossaryTerm, deleteGlossaryTerm, updateGlossaryTerm } from '@/lib/ai/glossary';
import { requireEventManager } from '@/lib/auth/staff-session';
import { prisma } from '@/lib/db';
import { ForbiddenError } from '@/lib/errors';

import { GET, POST } from './route';
import { DELETE, PATCH } from './[termId]/route';

const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const TERM_ID = '44444444-4444-4444-8444-444444444444';
const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) });
const req = (method: string, { token, body }: { token?: string; body?: unknown } = {}) =>
  new Request(`http://localhost/api/admin/events/${EVENT_ID}/glossary`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }) as never;
const findEvent = prisma.event.findUnique as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  findEvent.mockResolvedValue({ id: EVENT_ID, moderatorToken: 'TOKEN' });
  vi.mocked(requireEventManager).mockResolvedValue({ role: 'organizer', accountId: 'a' } as never);
});

describe('/api/admin/events/[id]/glossary', () => {
  it('chi modera entra col token, senza passare dalla sessione dello staff', async () => {
    const res = await GET(req('GET', { token: 'TOKEN' }), ctx({ id: EVENT_ID }));
    expect(res.status).toBe(200);
    // Le voci dell'evento si modificano qui; quelle dell'istanza solo si vedono.
    expect(await res.json()).toEqual({
      terms: [{ id: EVENT_ID, canEdit: true }],
      instance: [{ id: 'istanza', canEdit: false }],
    });
    expect(requireEventManager).not.toHaveBeenCalled();
  });

  it('un token sbagliato non basta: decide la sessione dello staff', async () => {
    vi.mocked(requireEventManager).mockRejectedValue(new ForbiddenError());
    expect((await GET(req('GET', { token: 'ALTRO' }), ctx({ id: EVENT_ID }))).status).toBe(403);
    expect((await POST(req('POST', { body: { term: 'ABC' } }), ctx({ id: EVENT_ID }))).status).toBe(403);
    expect(createGlossaryTerm).not.toHaveBeenCalled();
  });

  it('le scritture restano nell’evento', async () => {
    expect((await POST(req('POST', { body: { term: 'ABC' } }), ctx({ id: EVENT_ID }))).status).toBe(201);
    expect(createGlossaryTerm).toHaveBeenCalledWith(EVENT_ID, expect.objectContaining({ term: 'ABC' }));
    await PATCH(req('PATCH', { body: { note: 'x' } }), ctx({ id: EVENT_ID, termId: TERM_ID }));
    expect(updateGlossaryTerm).toHaveBeenCalledWith(TERM_ID, EVENT_ID, { note: 'x' });
    await DELETE(req('DELETE'), ctx({ id: EVENT_ID, termId: TERM_ID }));
    expect(deleteGlossaryTerm).toHaveBeenCalledWith(TERM_ID, EVENT_ID);
  });

  it('evento inesistente: 404', async () => {
    findEvent.mockResolvedValue(null);
    expect((await GET(req('GET'), ctx({ id: EVENT_ID }))).status).toBe(404);
  });
});
