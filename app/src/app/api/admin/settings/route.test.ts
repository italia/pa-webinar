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
const update = vi.fn();
vi.mock('@/lib/db', () => ({
  prisma: {
    siteSetting: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      createMany: (...a: unknown[]) => createMany(...a),
      findUniqueOrThrow: (...a: unknown[]) => findUniqueOrThrow(...a),
      create: (...a: unknown[]) => create(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}));
vi.mock('@/lib/audit/admin-audit', () => ({ logAdminAction: vi.fn(async () => undefined) }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
const isAdmin = vi.fn(async () => false);
vi.mock('@/lib/auth/admin-session', () => ({
  isAdminAuthenticated: () => isAdmin(),
}));

import { GET, PUT } from './route';

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

/**
 * Il salvataggio dal pannello: rimanda le impostazioni appena lette, con i
 * link del pie' di pagina che le installazioni gia' in esercizio hanno come
 * testo JSON. Un rifiuto dice il campo e il tipo di controllo fallito.
 */
describe('PUT /api/admin/settings', () => {
  const put = (body: unknown) =>
    PUT(
      new Request('https://webinar.example.gov.it/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }) as unknown as NextRequest,
      ctx,
    );

  beforeEach(() => {
    isAdmin.mockResolvedValue(true);
    update.mockReset();
    update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...ROW, ...data }));
  });

  it('la riga letta, con i link come testo JSON, si salva e i link diventano un elenco', async () => {
    const res = await put({
      ...ROW,
      updatedAt: '2026-10-01T10:00:00.000Z',
      organizationUrl: 'www.comune-esempio.it',
      footerLinks: JSON.stringify([{ title: 'Privacy', url: '/privacy', section: 'legal' }]),
    });

    expect(res.status).toBe(200);
    const dati = update.mock.calls[0]![0].data as Record<string, unknown>;
    expect(dati.footerLinks).toEqual([{ title: 'Privacy', url: '/privacy', section: 'legal' }]);
    expect(dati.organizationUrl).toBe('https://www.comune-esempio.it');
    expect(dati).not.toHaveProperty('id');
    expect(dati).not.toHaveProperty('updatedAt');
  });

  it('un testo non JSON nei link e\' un 422 sul campo, non un 500', async () => {
    const res = await put({ footerLinks: '{non json' });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { details: { path: unknown[] }[] };
    expect(body.details[0]!.path).toEqual(['footerLinks']);
    expect(update).not.toHaveBeenCalled();
  });

  it('il rifiuto dice il tipo di controllo fallito', async () => {
    const res = await put({ supportEmail: 'non-una-email', jvbMaxReplicas: 99 });
    expect(res.status).toBe(422);
    const { details } = (await res.json()) as { details: Record<string, unknown>[] };
    expect(details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ['supportEmail'], code: 'invalid_string', validation: 'email' }),
        expect.objectContaining({ path: ['jvbMaxReplicas'], code: 'too_big', type: 'number', maximum: 50 }),
      ]),
    );
  });
});
