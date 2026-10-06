// @vitest-environment node
/**
 * Il glossario dell'istanza: tutto lo staff lo legge e lo arricchisce;
 * chi organizza modifica e cancella solo le voci che ha aggiunto.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock('@/lib/auth/staff-session', () => ({ requireStaff: vi.fn() }));
vi.mock('@/lib/audit/admin-audit', () => ({ logAdminAction: vi.fn() }));
vi.mock('@/lib/ai/glossary', async (importOriginal) => ({
  ...(await importOriginal<typeof GlossaryModule>()),
  listGlossary: vi.fn(async () => [
    { id: 'a', term: 'MIA', createdById: 'acc-1' },
    { id: 'b', term: 'ALTRA', createdById: null },
  ]),
  getGlossaryTerm: vi.fn(),
  createGlossaryTerm: vi.fn(),
  updateGlossaryTerm: vi.fn(),
  deleteGlossaryTerm: vi.fn(),
}));

import type * as GlossaryModule from '@/lib/ai/glossary';
import { createGlossaryTerm, deleteGlossaryTerm, getGlossaryTerm, updateGlossaryTerm } from '@/lib/ai/glossary';
import { requireStaff } from '@/lib/auth/staff-session';
import { UnauthorizedError } from '@/lib/errors';

import { GET, POST } from './route';
import { DELETE, PATCH } from './[id]/route';

const ID = '33333333-3333-4333-8333-333333333333';
const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });
const req = (method: string, body?: unknown) =>
  new Request('http://localhost/api/admin/glossary', {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireStaff).mockResolvedValue({ role: 'admin', accountId: null });
});

describe('/api/admin/glossary', () => {
  it('senza sessione dello staff: 401, e niente letture o scritture', async () => {
    vi.mocked(requireStaff).mockRejectedValue(new UnauthorizedError());
    expect((await GET(req('GET'), ctx())).status).toBe(401);
    expect((await POST(req('POST', { term: 'ABC' }), ctx())).status).toBe(401);
    expect(createGlossaryTerm).not.toHaveBeenCalled();
  });

  it('aggiunge una voce dell’istanza, validata', async () => {
    vi.mocked(createGlossaryTerm).mockResolvedValue({ id: ID, term: 'ABC' } as never);
    const res = await POST(req('POST', { term: ' ABC ', reading: 'spell' }), ctx());
    expect(res.status).toBe(201);
    expect(createGlossaryTerm).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ term: 'ABC', reading: 'spell' }),
      { createdById: null },
    );
    expect((await POST(req('POST', { term: 'ABC', reading: 'boh' }), ctx())).status).toBe(422);
  });

  it('modifica e cancellazione restano sulle voci dell’istanza', async () => {
    vi.mocked(updateGlossaryTerm).mockResolvedValue({ id: ID, term: 'ABC' } as never);
    expect((await PATCH(req('PATCH', { note: 'x' }), ctx({ id: ID }))).status).toBe(200);
    expect(updateGlossaryTerm).toHaveBeenCalledWith(ID, null, { note: 'x' });
    expect((await DELETE(req('DELETE'), ctx({ id: ID }))).status).toBe(200);
    expect(deleteGlossaryTerm).toHaveBeenCalledWith(ID, null);
    expect((await DELETE(req('DELETE'), ctx({ id: 'non-uuid' }))).status).toBe(400);
  });

  it('chi organizza aggiunge voci a proprio nome e modifica solo le sue', async () => {
    vi.mocked(requireStaff).mockResolvedValue({ role: 'organizer', accountId: 'acc-1' });
    const lista = await (await GET(req('GET'), ctx())).json();
    expect(lista.terms.map((t: { id: string; canEdit: boolean }) => [t.id, t.canEdit])).toEqual([
      ['a', true],
      ['b', false],
    ]);
    vi.mocked(createGlossaryTerm).mockResolvedValue({ id: ID, term: 'XYZ' } as never);
    await POST(req('POST', { term: 'XYZ' }), ctx());
    expect(createGlossaryTerm).toHaveBeenCalledWith(null, expect.anything(), { createdById: 'acc-1' });

    vi.mocked(getGlossaryTerm).mockResolvedValue({ id: ID, createdById: 'acc-2' } as never);
    expect((await PATCH(req('PATCH', { note: 'x' }), ctx({ id: ID }))).status).toBe(403);
    expect((await DELETE(req('DELETE'), ctx({ id: ID }))).status).toBe(403);
    expect(updateGlossaryTerm).not.toHaveBeenCalled();
    expect(deleteGlossaryTerm).not.toHaveBeenCalled();

    vi.mocked(getGlossaryTerm).mockResolvedValue({ id: ID, createdById: 'acc-1' } as never);
    vi.mocked(updateGlossaryTerm).mockResolvedValue({ id: ID, term: 'XYZ' } as never);
    expect((await PATCH(req('PATCH', { note: 'x' }), ctx({ id: ID }))).status).toBe(200);
    vi.mocked(getGlossaryTerm).mockResolvedValue(null);
    expect((await DELETE(req('DELETE'), ctx({ id: ID }))).status).toBe(404);
  });
});
