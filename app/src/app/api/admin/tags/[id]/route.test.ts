// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
/**
 * Una singola etichetta: la modifica e la toglie solo l’amministrazione, e un
 * identificativo sbagliato o gia’ sparito si dice senza errori interni.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, sessione } = vi.hoisted(() => ({
  prisma: {
    staffAccount: { findUnique: vi.fn() },
    adminAuditLog: { create: vi.fn() },
    tag: { update: vi.fn(), delete: vi.fn() },
  },
  sessione: { cookie: undefined as string | undefined },
}));

vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) =>
      nome === 'admin_session' && sessione.cookie
        ? { value: sessione.cookie }
        : undefined,
  }),
}));

import { signStaffSession } from '@/lib/auth/staff-session';

import { DELETE, PATCH } from './route';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const ETICHETTA = '88888888-8888-4888-8888-888888888888';

function chiama(handler: typeof PATCH, method: string, corpo?: unknown, id = ETICHETTA) {
  const request = new Request(`http://localhost/api/admin/tags/${id}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
  });
  return handler(request as never, { params: Promise.resolve({ id }) });
}
const modifica = (corpo: unknown, id?: string) => chiama(PATCH, 'PATCH', corpo, id);
const togli = (id?: string) => chiama(DELETE, 'DELETE', undefined, id);

async function entra(role: 'ADMIN' | 'ORGANIZER') {
  prisma.staffAccount.findUnique.mockResolvedValue({
    id: ACCOUNT,
    active: true,
    role,
    emailHash: 'impronta-account',
  });
  sessione.cookie = await signStaffSession({ id: ACCOUNT, role });
}

const nessunaScrittura = () => {
  expect(prisma.tag.update).not.toHaveBeenCalled();
  expect(prisma.tag.delete).not.toHaveBeenCalled();
};

beforeAll(() => {
  process.env.APP_SECRET = 'segreto-di-prova-delle-etichette-abbastanza-lungo';
});

beforeEach(async () => {
  vi.clearAllMocks();
  await entra('ADMIN');
  prisma.tag.update.mockImplementation(async ({ data }: { data: object }) => ({
    id: ETICHETTA,
    ...data,
  }));
  prisma.tag.delete.mockResolvedValue({ id: ETICHETTA });
});

describe('chi puo’ entrare', () => {
  it('senza sessione e’ 401', async () => {
    sessione.cookie = undefined;
    expect((await modifica({ color: null })).status).toBe(401);
    expect((await togli()).status).toBe(401);
    nessunaScrittura();
  });

  it('chi organizza e’ rifiutato: l’elenco e’ dell’amministrazione', async () => {
    await entra('ORGANIZER');
    expect((await modifica({ color: null })).status).toBe(401);
    expect((await togli()).status).toBe(401);
    nessunaScrittura();
  });

  it('un identificativo malformato e’ 400', async () => {
    expect((await modifica({ color: null }, 'non-un-uuid')).status).toBe(400);
    expect((await togli('non-un-uuid')).status).toBe(400);
    nessunaScrittura();
  });
});

describe('PATCH', () => {
  it('il nome non si cancella e non perde l’italiano', async () => {
    expect((await modifica({ name: {} })).status).toBe(422);
    expect((await modifica({ name: { en: 'Tag' } })).status).toBe(422);
    nessunaScrittura();
  });

  it('un corpo non valido e’ 422, e non si scrive niente', async () => {
    const corpi = [
      { slug: 'Con Maiuscole' },
      { color: 'blu' },
      { sortOrder: 10000 },
      { name: { it: '' } },
    ];
    for (const corpo of corpi) {
      expect((await modifica(corpo)).status).toBe(422);
    }
    nessunaScrittura();
  });

  it('tocca i soli campi mandati, e il colore si puo’ togliere', async () => {
    const r = await modifica({ color: null, sortOrder: 3 });
    expect(r.status).toBe(200);
    expect(prisma.tag.update.mock.calls[0]![0]).toEqual({
      where: { id: ETICHETTA },
      data: { color: null, sortOrder: 3 },
    });
  });

  it('uno slug gia’ usato e’ 409, senza traccia', async () => {
    prisma.tag.update.mockRejectedValue({ code: 'P2002' });
    const r = await modifica({ slug: 'pa' });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { code: string }).code).toBe('CONFLICT');
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it('un’etichetta sparita e’ 404, senza traccia', async () => {
    prisma.tag.update.mockRejectedValue({ code: 'P2025' });
    expect((await modifica({ slug: 'pa' })).status).toBe(404);
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it('la traccia dice quali campi', async () => {
    await modifica({ slug: 'pa', color: '#004080' });
    expect(prisma.adminAuditLog.create.mock.calls[0]![0].data).toMatchObject({
      action: 'TAG_UPDATE',
      target: ETICHETTA,
      details: JSON.stringify({ fields: ['slug', 'color'] }),
    });
  });
});

describe('DELETE', () => {
  it('toglie l’etichetta: i collegamenti agli eventi li scioglie il database', async () => {
    const r = await togli();
    expect(await r.json()).toEqual({ deleted: true, id: ETICHETTA });
    expect(prisma.tag.delete.mock.calls[0]![0]).toEqual({ where: { id: ETICHETTA } });
    expect(prisma.adminAuditLog.create.mock.calls[0]![0].data).toMatchObject({
      action: 'TAG_DELETE',
      target: ETICHETTA,
    });
  });

  it('un’etichetta sparita e’ 404, senza traccia', async () => {
    prisma.tag.delete.mockRejectedValue({ code: 'P2025' });
    expect((await togli()).status).toBe(404);
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });
});
