// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
/**
 * L’elenco delle etichette: lo legge chiunque etichetti un evento, lo scrive
 * solo l’amministrazione, e un’etichetta nasce sempre con il nome italiano.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, sessione } = vi.hoisted(() => ({
  prisma: {
    staffAccount: { findUnique: vi.fn() },
    adminAuditLog: { create: vi.fn() },
    tag: { findMany: vi.fn(), create: vi.fn() },
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

import { GET, POST } from './route';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';

function chiama(handler: typeof GET, method: string, corpo?: unknown) {
  const request = new Request('http://localhost/api/admin/tags', {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
  });
  return handler(request as never, { params: Promise.resolve({}) });
}
const elenca = () => chiama(GET, 'GET');
const crea = (corpo: unknown) => chiama(POST, 'POST', corpo);

async function entra(role: 'ADMIN' | 'ORGANIZER') {
  prisma.staffAccount.findUnique.mockResolvedValue({
    id: ACCOUNT,
    active: true,
    role,
    emailHash: 'impronta-account',
  });
  sessione.cookie = await signStaffSession({ id: ACCOUNT, role });
}

const ETICHETTA = {
  slug: 'pubblica-amministrazione',
  name: { it: 'Pubblica amministrazione' },
};

beforeAll(() => {
  process.env.APP_SECRET = 'segreto-di-prova-delle-etichette-abbastanza-lungo';
});

beforeEach(async () => {
  vi.clearAllMocks();
  await entra('ADMIN');
  prisma.tag.findMany.mockResolvedValue([{ id: 't1', slug: 'pa', name: { it: 'PA' } }]);
  prisma.tag.create.mockImplementation(async ({ data }: { data: object }) => ({
    id: 'nuova',
    ...data,
  }));
});

describe('GET', () => {
  it('senza sessione e’ 401', async () => {
    sessione.cookie = undefined;
    expect((await elenca()).status).toBe(401);
    expect(prisma.tag.findMany).not.toHaveBeenCalled();
  });

  it('chi organizza legge l’elenco', async () => {
    await entra('ORGANIZER');
    const r = await elenca();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      rows: [{ id: 't1', slug: 'pa', name: { it: 'PA' } }],
    });
  });
});

describe('POST', () => {
  it('senza sessione e’ 401', async () => {
    sessione.cookie = undefined;
    expect((await crea(ETICHETTA)).status).toBe(401);
    expect(prisma.tag.create).not.toHaveBeenCalled();
  });

  it('chi organizza legge ma non crea', async () => {
    await entra('ORGANIZER');
    expect((await crea(ETICHETTA)).status).toBe(401);
    expect(prisma.tag.create).not.toHaveBeenCalled();
  });

  it('un corpo non valido e’ 422, e non si scrive niente', async () => {
    const corpi = [
      { ...ETICHETTA, slug: 'Con Maiuscole' },
      { ...ETICHETTA, slug: '-trattino' },
      { ...ETICHETTA, name: { en: 'Only English' } },
      { ...ETICHETTA, name: { it: '' } },
      { ...ETICHETTA, name: { it: 'x'.repeat(81) } },
      { ...ETICHETTA, color: 'blu' },
      { ...ETICHETTA, sortOrder: 10000 },
      { ...ETICHETTA, sortOrder: -1 },
    ];
    for (const corpo of corpi) {
      expect((await crea(corpo)).status).toBe(422);
    }
    expect(prisma.tag.create).not.toHaveBeenCalled();
  });

  it('crea l’etichetta con colore e ordine facoltativi', async () => {
    const r = await crea(ETICHETTA);
    expect(r.status).toBe(201);
    expect(prisma.tag.create.mock.calls[0]![0].data).toEqual({
      ...ETICHETTA,
      color: null,
      sortOrder: 0,
    });
  });

  it('tiene colore e ordine dati', async () => {
    await crea({ ...ETICHETTA, color: '#004080', sortOrder: 7 });
    expect(prisma.tag.create.mock.calls[0]![0].data).toMatchObject({
      color: '#004080',
      sortOrder: 7,
    });
  });

  it('uno slug gia’ usato e’ 409, senza traccia', async () => {
    prisma.tag.create.mockRejectedValue({ code: 'P2002' });
    const r = await crea(ETICHETTA);
    expect(r.status).toBe(409);
    expect(((await r.json()) as { code: string }).code).toBe('CONFLICT');
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it('lascia traccia dell’etichetta creata', async () => {
    await crea(ETICHETTA);
    expect(prisma.adminAuditLog.create.mock.calls[0]![0].data).toMatchObject({
      action: 'TAG_CREATE',
      target: 'nuova',
      details: JSON.stringify({ slug: ETICHETTA.slug }),
    });
  });
});
