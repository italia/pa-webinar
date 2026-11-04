// @vitest-environment node
/**
 * Un modello di informativa: solo l’amministrazione lo legge, lo modifica e lo
 * cancella. La modifica tocca i soli campi mandati, il predefinito resta uno, e
 * cancellare un modello in uso scollega gli eventi senza toccarli.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, tx, sessione } = vi.hoisted(() => {
  const tx = { gdprTemplate: { updateMany: vi.fn(), update: vi.fn() } };
  return {
    tx,
    sessione: { cookie: undefined as string | undefined },
    prisma: {
      staffAccount: { findUnique: vi.fn() },
      adminAuditLog: { create: vi.fn() },
      gdprTemplate: { findUnique: vi.fn(), delete: vi.fn() },
      event: { count: vi.fn() },
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

import { DELETE, GET, PUT } from './route';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const MODELLO = '44444444-4444-4444-8444-444444444444';
const TESTO = 'Informativa sul trattamento dei dati personali degli iscritti.';

function chiama(handler: typeof GET, method: string, corpo?: unknown, id = MODELLO) {
  const request = new Request(`http://localhost/api/admin/gdpr-templates/${id}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
  });
  return handler(request as never, { params: Promise.resolve({ id }) });
}
const leggi = (id?: string) => chiama(GET, 'GET', undefined, id);
const modifica = (corpo: unknown, id?: string) => chiama(PUT, 'PUT', corpo, id);
const cancella = (id?: string) => chiama(DELETE, 'DELETE', undefined, id);

async function entra(role: 'ADMIN' | 'ORGANIZER') {
  prisma.staffAccount.findUnique.mockResolvedValue({
    id: ACCOUNT,
    active: true,
    role,
    emailHash: 'impronta-account',
  });
  sessione.cookie = await signStaffSession({ id: ACCOUNT, role });
}

const nessunTocco = () => {
  expect(prisma.gdprTemplate.findUnique).not.toHaveBeenCalled();
  expect(prisma.$transaction).not.toHaveBeenCalled();
  expect(prisma.gdprTemplate.delete).not.toHaveBeenCalled();
};

const modello = {
  id: MODELLO,
  name: 'Modello',
  description: null,
  body: { it: TESTO },
  isDefault: false,
  createdAt: new Date('2026-10-01T08:00:00Z'),
  updatedAt: new Date('2026-10-02T08:00:00Z'),
  _count: { events: 2 },
};

beforeAll(() => {
  process.env.APP_SECRET = 'segreto-di-prova-delle-informative-abbastanza-lungo';
});

beforeEach(async () => {
  vi.clearAllMocks();
  await entra('ADMIN');
  prisma.gdprTemplate.findUnique.mockResolvedValue(modello);
  prisma.gdprTemplate.delete.mockResolvedValue(modello);
  prisma.event.count.mockResolvedValue(0);
  tx.gdprTemplate.update.mockResolvedValue(modello);
});

describe('chi puo’ entrare', () => {
  it('senza sessione e’ 401', async () => {
    sessione.cookie = undefined;
    const risposte = await Promise.all([
      leggi(),
      modifica({ name: 'Altro' }),
      cancella(),
    ]);
    expect(risposte.map((r) => r.status)).toEqual([401, 401, 401]);
    nessunTocco();
  });

  it('chi organizza e’ rifiutato', async () => {
    await entra('ORGANIZER');
    const risposte = await Promise.all([
      leggi(),
      modifica({ name: 'Altro' }),
      cancella(),
    ]);
    expect(risposte.map((r) => r.status)).toEqual([401, 401, 401]);
    nessunTocco();
  });

  it('un identificativo malformato e’ 400', async () => {
    const risposte = await Promise.all([
      leggi('non-un-uuid'),
      modifica({ name: 'Altro' }, 'non-un-uuid'),
      cancella('non-un-uuid'),
    ]);
    expect(risposte.map((r) => r.status)).toEqual([400, 400, 400]);
    nessunTocco();
  });
});

describe('GET', () => {
  it('un modello che non esiste e’ 404', async () => {
    prisma.gdprTemplate.findUnique.mockResolvedValue(null);
    expect((await leggi()).status).toBe(404);
  });

  it('consegna il testo e quanti eventi lo usano, senza cache', async () => {
    const r = await leggi();
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect(await r.json()).toMatchObject({
      id: MODELLO,
      body: { it: TESTO },
      usedByEvents: 2,
      createdAt: '2026-10-01T08:00:00.000Z',
    });
  });
});

describe('PUT', () => {
  it('un corpo non valido e’ 422, e non si scrive niente', async () => {
    const corpi = [{ name: 'M' }, { body: { it: 'troppo corto' } }, { isDefault: 'si' }];
    for (const corpo of corpi) {
      expect((await modifica(corpo)).status).toBe(422);
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('tocca i soli campi mandati: rinominare non toglie il predefinito', async () => {
    const r = await modifica({ name: 'Altro nome' });
    expect(r.status).toBe(200);
    expect(tx.gdprTemplate.update.mock.calls[0]![0]).toEqual({
      where: { id: MODELLO },
      data: { name: 'Altro nome' },
    });
    expect(tx.gdprTemplate.updateMany).not.toHaveBeenCalled();
  });

  it('il nuovo predefinito lo toglie agli altri, non a se stesso', async () => {
    await modifica({ isDefault: true });
    expect(tx.gdprTemplate.updateMany.mock.calls[0]![0]).toEqual({
      where: { isDefault: true, NOT: { id: MODELLO } },
      data: { isDefault: false },
    });
    expect(tx.gdprTemplate.update.mock.calls[0]![0].data).toEqual({ isDefault: true });
    expect(tx.gdprTemplate.updateMany.mock.invocationCallOrder[0]!).toBeLessThan(
      tx.gdprTemplate.update.mock.invocationCallOrder[0]!
    );
  });

  it('togliere il predefinito non tocca gli altri modelli', async () => {
    await modifica({ isDefault: false });
    expect(tx.gdprTemplate.updateMany).not.toHaveBeenCalled();
    expect(tx.gdprTemplate.update.mock.calls[0]![0].data).toEqual({ isDefault: false });
  });

  it('un modello che non esiste e’ 404, senza traccia', async () => {
    tx.gdprTemplate.update.mockRejectedValue({ code: 'P2025' });
    expect((await modifica({ name: 'Altro nome' })).status).toBe(404);
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it('un nome gia’ usato e’ 409', async () => {
    tx.gdprTemplate.update.mockRejectedValue({ code: 'P2002' });
    expect((await modifica({ name: 'Altro nome' })).status).toBe(409);
  });

  it('la traccia dice quali campi, non il loro contenuto', async () => {
    await modifica({ body: { it: TESTO } });
    expect(prisma.adminAuditLog.create.mock.calls[0]![0].data).toMatchObject({
      action: 'GDPR_TEMPLATE_UPDATE',
      target: MODELLO,
      details: JSON.stringify({ fields: ['body'] }),
    });
  });
});

describe('DELETE', () => {
  it('un modello in uso si cancella e dice quanti eventi perdono il collegamento', async () => {
    prisma.event.count.mockResolvedValue(3);
    const r = await cancella();
    expect(await r.json()).toEqual({ deleted: true, unlinkedEvents: 3 });
    expect(prisma.event.count.mock.calls[0]![0].where).toEqual({
      gdprTemplateId: MODELLO,
    });
    expect(prisma.gdprTemplate.delete.mock.calls[0]![0]).toEqual({
      where: { id: MODELLO },
    });
    expect(prisma.adminAuditLog.create.mock.calls[0]![0].data).toMatchObject({
      action: 'GDPR_TEMPLATE_DELETE',
      target: MODELLO,
      details: JSON.stringify({ unlinkedEvents: 3 }),
    });
  });

  it('un modello che non esiste e’ 404, senza traccia', async () => {
    prisma.gdprTemplate.delete.mockRejectedValue({ code: 'P2025' });
    expect((await cancella()).status).toBe(404);
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });
});
