// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
/**
 * Le etichette di un evento: le mette chi gestisce l’evento, sostituendo
 * l’insieme intero in una transazione. Uno slug sconosciuto si scarta: l’elenco
 * delle etichette lo cura l’amministrazione altrove.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, tx, sessione } = vi.hoisted(() => {
  const tx = { eventTagLink: { deleteMany: vi.fn(), createMany: vi.fn() } };
  return {
    tx,
    sessione: { cookie: undefined as string | undefined },
    prisma: {
      staffAccount: { findUnique: vi.fn() },
      adminAuditLog: { create: vi.fn() },
      event: { count: vi.fn(), findUnique: vi.fn() },
      eventTagLink: { findMany: vi.fn() },
      tag: { findMany: vi.fn() },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    },
  };
});

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

import { GET, PUT } from './route';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const EVENTO = '22222222-2222-4222-8222-222222222222';

function chiama(handler: typeof GET, method: string, corpo?: unknown, id = EVENTO) {
  const request = new Request(`http://localhost/api/admin/events/${id}/tags`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
  });
  return handler(request as never, { params: Promise.resolve({ id }) });
}
const leggi = (id?: string) => chiama(GET, 'GET', undefined, id);
const salva = (corpo: unknown, id?: string) => chiama(PUT, 'PUT', corpo, id);

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
  expect(tx.eventTagLink.deleteMany).not.toHaveBeenCalled();
  expect(tx.eventTagLink.createMany).not.toHaveBeenCalled();
};

beforeAll(() => {
  process.env.APP_SECRET = 'segreto-di-prova-delle-etichette-abbastanza-lungo';
});

beforeEach(async () => {
  vi.clearAllMocks();
  await entra('ADMIN');
  prisma.event.count.mockResolvedValue(0);
  prisma.event.findUnique.mockResolvedValue({ id: EVENTO });
  prisma.eventTagLink.findMany.mockResolvedValue([]);
  prisma.tag.findMany.mockResolvedValue([]);
});

describe('chi puo’ entrare', () => {
  it('senza sessione e’ 401', async () => {
    sessione.cookie = undefined;
    expect((await leggi()).status).toBe(401);
    expect((await salva({ slugs: [] })).status).toBe(401);
    expect(prisma.eventTagLink.findMany).not.toHaveBeenCalled();
    nessunaScrittura();
  });

  it('un identificativo malformato e’ 400', async () => {
    expect((await leggi('non-un-uuid')).status).toBe(400);
    expect((await salva({ slugs: [] }, 'non-un-uuid')).status).toBe(400);
    nessunaScrittura();
  });

  it('l’evento di un altro organizzatore e’ 403, in lettura e in scrittura', async () => {
    await entra('ORGANIZER');
    expect((await leggi()).status).toBe(403);
    expect((await salva({ slugs: ['pa'] })).status).toBe(403);
    expect(prisma.event.count.mock.calls[0]![0].where).toMatchObject({
      id: EVENTO,
      AND: [{ OR: expect.arrayContaining([{ createdById: ACCOUNT }]) }],
    });
    expect(prisma.eventTagLink.findMany).not.toHaveBeenCalled();
    nessunaScrittura();
  });

  it('chi organizza lavora sul proprio evento', async () => {
    await entra('ORGANIZER');
    prisma.event.count.mockResolvedValue(1);
    expect((await leggi()).status).toBe(200);
    expect((await salva({ slugs: [] })).status).toBe(200);
  });

  it('per l’amministrazione un evento che non esiste e’ 404', async () => {
    prisma.event.findUnique.mockResolvedValue(null);
    expect((await leggi()).status).toBe(404);
    expect((await salva({ slugs: ['pa'] })).status).toBe(404);
    nessunaScrittura();
  });
});

describe('GET', () => {
  it('consegna le etichette di quell’evento', async () => {
    const tag = { id: 't1', slug: 'pa', name: { it: 'PA' } };
    prisma.eventTagLink.findMany.mockResolvedValue([
      { eventId: EVENTO, tagId: 't1', tag },
    ]);
    const r = await leggi();
    expect(await r.json()).toEqual({ rows: [tag] });
    expect(prisma.eventTagLink.findMany.mock.calls[0]![0].where).toEqual({
      eventId: EVENTO,
    });
  });
});

describe('PUT', () => {
  it('sostituisce l’insieme e scarta gli slug sconosciuti', async () => {
    prisma.tag.findMany.mockResolvedValue([{ id: 't1', slug: 'pa' }]);
    const r = await salva({ slugs: ['pa', 'inesistente'] });
    expect(await r.json()).toEqual({ updated: true, count: 1 });
    expect(prisma.tag.findMany.mock.calls[0]![0].where).toEqual({
      slug: { in: ['pa', 'inesistente'] },
    });
    expect(tx.eventTagLink.deleteMany).toHaveBeenCalledWith({
      where: { eventId: EVENTO },
    });
    expect(tx.eventTagLink.createMany.mock.calls[0]![0].data).toEqual([
      { eventId: EVENTO, tagId: 't1' },
    ]);
  });

  it('toglie i collegamenti vecchi prima di mettere i nuovi', async () => {
    prisma.tag.findMany.mockResolvedValue([{ id: 't1', slug: 'pa' }]);
    await salva({ slugs: ['pa'] });
    expect(tx.eventTagLink.deleteMany.mock.invocationCallOrder[0]!).toBeLessThan(
      tx.eventTagLink.createMany.mock.invocationCallOrder[0]!
    );
  });

  it('un elenco vuoto toglie tutte le etichette', async () => {
    const r = await salva({ slugs: [] });
    expect(await r.json()).toEqual({ updated: true, count: 0 });
    expect(tx.eventTagLink.deleteMany).toHaveBeenCalledTimes(1);
    expect(tx.eventTagLink.createMany).not.toHaveBeenCalled();
  });

  it('un corpo non valido e’ 422, e le etichette restano', async () => {
    const corpi = [
      {},
      { slugs: 'pa' },
      { slugs: [''] },
      { slugs: ['x'.repeat(101)] },
      { slugs: Array.from({ length: 31 }, (_, i) => `tag-${i}`) },
    ];
    for (const corpo of corpi) {
      expect((await salva(corpo)).status).toBe(422);
    }
    nessunaScrittura();
  });

  it('lascia traccia degli slug chiesti', async () => {
    await salva({ slugs: ['pa'] });
    expect(prisma.adminAuditLog.create.mock.calls[0]![0].data).toMatchObject({
      action: 'EVENT_TAGS_SET',
      target: EVENTO,
      details: JSON.stringify({ slugs: ['pa'] }),
    });
  });
});
