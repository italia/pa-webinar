// @vitest-environment node
/**
 * I modelli di informativa dell’istanza: li vede e li crea solo
 * l’amministrazione, e di predefinito ce n’e’ uno solo: chi lo diventa lo toglie
 * agli altri nella stessa transazione.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, tx, sessione } = vi.hoisted(() => {
  const tx = { gdprTemplate: { updateMany: vi.fn(), create: vi.fn() } };
  return {
    tx,
    sessione: { cookie: undefined as string | undefined },
    prisma: {
      staffAccount: { findUnique: vi.fn() },
      adminAuditLog: { create: vi.fn() },
      gdprTemplate: { findMany: vi.fn() },
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

import { GET, POST } from './route';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const TESTO = 'Informativa sul trattamento dei dati personali degli iscritti.';

function chiama(handler: typeof GET, method: string, corpo?: unknown) {
  const request = new Request('http://localhost/api/admin/gdpr-templates', {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
  });
  return handler(request as never, { params: Promise.resolve({}) });
}
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

beforeAll(() => {
  process.env.APP_SECRET = 'segreto-di-prova-delle-informative-abbastanza-lungo';
});

beforeEach(async () => {
  vi.clearAllMocks();
  await entra('ADMIN');
  prisma.gdprTemplate.findMany.mockResolvedValue([]);
  tx.gdprTemplate.create.mockImplementation(async ({ data }: { data: object }) => ({
    id: 'nuovo',
    ...data,
  }));
});

describe('chi puo’ entrare', () => {
  it('senza sessione e’ 401', async () => {
    sessione.cookie = undefined;
    expect((await chiama(GET, 'GET')).status).toBe(401);
    expect((await crea({ name: 'Modello', body: { it: TESTO } })).status).toBe(401);
    expect(prisma.gdprTemplate.findMany).not.toHaveBeenCalled();
    expect(tx.gdprTemplate.create).not.toHaveBeenCalled();
  });

  it('chi organizza e’ rifiutato: i modelli sono dell’istanza', async () => {
    await entra('ORGANIZER');
    expect((await chiama(GET, 'GET')).status).toBe(401);
    expect((await crea({ name: 'Modello', body: { it: TESTO } })).status).toBe(401);
    expect(prisma.gdprTemplate.findMany).not.toHaveBeenCalled();
    expect(tx.gdprTemplate.create).not.toHaveBeenCalled();
  });
});

describe('GET', () => {
  it('dice le lingue del testo e quanti eventi usano il modello, senza cache', async () => {
    prisma.gdprTemplate.findMany.mockResolvedValue([
      {
        id: 'm1',
        name: 'Modello',
        description: null,
        body: { it: TESTO, en: 'Privacy notice for registered participants.' },
        isDefault: true,
        createdAt: new Date('2026-10-01T08:00:00Z'),
        updatedAt: new Date('2026-10-02T08:00:00Z'),
        _count: { events: 3 },
      },
    ]);
    const r = await chiama(GET, 'GET');
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    const corpo = (await r.json()) as { rows: Array<Record<string, unknown>> };
    expect(corpo.rows[0]).toMatchObject({
      locales: ['it', 'en'],
      usedByEvents: 3,
      updatedAt: '2026-10-02T08:00:00.000Z',
    });
  });
});

describe('POST', () => {
  it('un corpo non valido e’ 422, e non si scrive niente', async () => {
    const corpi = [
      { name: 'M', body: { it: TESTO } },
      { name: 'Modello' },
      { name: 'Modello', body: { it: 'troppo corto' } },
      { name: 'Modello', body: { it: `${' '.repeat(30)}x` } },
      { name: 'Modello', body: { it: TESTO }, description: 'x'.repeat(501) },
    ];
    for (const corpo of corpi) {
      expect((await crea(corpo)).status).toBe(422);
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('un modello normale lascia stare il predefinito', async () => {
    const r = await crea({ name: 'Modello', body: { it: TESTO } });
    expect(r.status).toBe(201);
    expect(tx.gdprTemplate.updateMany).not.toHaveBeenCalled();
    expect(tx.gdprTemplate.create.mock.calls[0]![0].data).toEqual({
      name: 'Modello',
      description: null,
      body: { it: TESTO },
      isDefault: false,
    });
  });

  it('il nuovo predefinito lo toglie agli altri, prima di nascere', async () => {
    const r = await crea({ name: 'Modello', body: { it: TESTO }, isDefault: true });
    expect(r.status).toBe(201);
    expect(tx.gdprTemplate.updateMany.mock.calls[0]![0]).toEqual({
      where: { isDefault: true },
      data: { isDefault: false },
    });
    expect(tx.gdprTemplate.create.mock.calls[0]![0].data.isDefault).toBe(true);
    expect(tx.gdprTemplate.updateMany.mock.invocationCallOrder[0]!).toBeLessThan(
      tx.gdprTemplate.create.mock.invocationCallOrder[0]!
    );
  });

  it('un nome gia’ usato e’ 409, senza traccia', async () => {
    tx.gdprTemplate.create.mockRejectedValue({ code: 'P2002' });
    expect((await crea({ name: 'Modello', body: { it: TESTO } })).status).toBe(409);
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it('lascia traccia, senza il testo dell’informativa', async () => {
    await crea({ name: 'Modello', body: { it: TESTO }, isDefault: true });
    expect(prisma.adminAuditLog.create.mock.calls[0]![0].data).toMatchObject({
      action: 'GDPR_TEMPLATE_CREATE',
      target: 'nuovo',
      details: JSON.stringify({ isDefault: true }),
    });
  });
});
