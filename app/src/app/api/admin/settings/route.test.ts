// @vitest-environment node
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * La lettura delle impostazioni del sito su un'installazione nuova.
 *
 * Le prime richieste arrivano insieme e la riga non c'e' ancora: la crea una
 * sola, con la stessa creazione idempotente di getSettings (lib/settings), e
 * le altre la trovano. Prima la rotta faceva «leggi, poi crea»: chi perdeva la
 * gara urtava il vincolo di unicita'.
 */

const findUnique = vi.fn();
const createMany = vi.fn();
const findUniqueOrThrow = vi.fn();
const create = vi.fn();
vi.mock('@/lib/db', () => ({
  prisma: {
    siteSetting: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      createMany: (...a: unknown[]) => createMany(...a),
      findUniqueOrThrow: (...a: unknown[]) => findUniqueOrThrow(...a),
      create: (...a: unknown[]) => create(...a),
    },
  },
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
const isAdmin = vi.fn(async () => false);
vi.mock('@/lib/auth/admin-session', () => ({
  isAdminAuthenticated: () => isAdmin(),
}));

import { GET } from './route';

const ROW = {
  id: 'singleton',
  siteName: 'PA Webinar',
  customHomeHtml: '<p>solo admin</p>',
  emailReplyTo: 'staff@example.org',
};
const ctx = { params: Promise.resolve({}) };
const get = () =>
  GET(new Request('https://webinar.example.gov.it/api/admin/settings') as unknown as NextRequest, ctx);

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  findUnique.mockReset();
  createMany.mockReset();
  findUniqueOrThrow.mockReset();
  create.mockReset();
  isAdmin.mockResolvedValue(false);
});

describe('GET /api/admin/settings', () => {
  it('installazione nuova: crea la riga senza urtare chi e arrivato prima', async () => {
    findUnique.mockResolvedValue(null);
    // `skipDuplicates`: un'altra richiesta l'ha appena creata, nessun errore.
    createMany.mockResolvedValue({ count: 0 });
    findUniqueOrThrow.mockResolvedValue(ROW);

    const res = await get();
    expect(res.status).toBe(200);
    expect(createMany).toHaveBeenCalledWith({ data: [{ id: 'singleton' }], skipDuplicates: true });
    expect(create).not.toHaveBeenCalled();
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.siteName).toBe('PA Webinar');
    // Chi non e' admin riceve la proiezione pubblica.
    expect(body).not.toHaveProperty('customHomeHtml');
    expect(body).not.toHaveProperty('emailReplyTo');
  });

  it('riga gia presente: la legge e basta; l admin la riceve intera', async () => {
    findUnique.mockResolvedValue(ROW);
    isAdmin.mockResolvedValue(true);

    const res = await get();
    expect(res.status).toBe(200);
    expect(createMany).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ customHomeHtml: '<p>solo admin</p>' });
  });
});
