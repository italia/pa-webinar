// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
/**
 * I modelli di evento: solo l’amministrazione li scrive. Un modello non avvia
 * mai la registrazione da solo, i campi JSON si azzerano con il null del
 * database e la matrice dei permessi si normalizza prima di essere salvata.
 */
import { Prisma } from '@prisma/client';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, sessione } = vi.hoisted(() => ({
  prisma: {
    staffAccount: { findUnique: vi.fn() },
    adminAuditLog: { create: vi.fn() },
    eventTemplate: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      aggregate: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
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

import { DELETE, GET, POST, PUT } from './route';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const MODELLO = '99999999-9999-4999-8999-999999999999';

function chiama(handler: typeof POST, method: string, corpo?: unknown, query = '') {
  const request = new Request(`http://localhost/api/admin/templates${query}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(corpo !== undefined
      ? { body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo) }
      : {}),
  });
  return handler(request as never, { params: Promise.resolve({}) });
}
const crea = (corpo: unknown) => chiama(POST, 'POST', corpo);
const modifica = (corpo: unknown) => chiama(PUT, 'PUT', corpo);
const togli = (query = `?id=${MODELLO}`) => chiama(DELETE, 'DELETE', undefined, query);

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
  expect(prisma.eventTemplate.create).not.toHaveBeenCalled();
  expect(prisma.eventTemplate.update).not.toHaveBeenCalled();
  expect(prisma.eventTemplate.delete).not.toHaveBeenCalled();
};
const creato = () => prisma.eventTemplate.create.mock.calls[0]![0].data;
const aggiornato = () => prisma.eventTemplate.update.mock.calls[0]![0].data;

beforeAll(() => {
  process.env.APP_SECRET = 'segreto-di-prova-dei-modelli-di-evento-abbastanza-lungo';
});

beforeEach(async () => {
  vi.clearAllMocks();
  await entra('ADMIN');
  prisma.eventTemplate.findUnique.mockResolvedValue({ id: MODELLO, isSystem: false });
  prisma.eventTemplate.aggregate.mockResolvedValue({ _max: { sortOrder: 4 } });
  prisma.eventTemplate.create.mockImplementation(async ({ data }: { data: object }) => ({
    id: MODELLO,
    ...data,
  }));
  prisma.eventTemplate.update.mockImplementation(async ({ data }: { data: object }) => ({
    id: MODELLO,
    ...data,
  }));
  prisma.eventTemplate.delete.mockResolvedValue({ id: MODELLO });
});

describe('chi puo’ leggere', () => {
  const leggi = () =>
    GET(new Request('http://localhost/api/admin/templates') as never, {
      params: Promise.resolve({}),
    });

  it('l’elenco e’ dell’amministrazione', async () => {
    prisma.eventTemplate.findMany.mockResolvedValue([{ id: 'm1' }]);
    await expect((await leggi()).json()).resolves.toEqual([{ id: 'm1' }]);
    await entra('ORGANIZER');
    expect((await leggi()).status).toBe(401);
  });
});

describe('chi puo’ scrivere', () => {
  const chiamate = () => [
    crea({ name: 'Webinar' }),
    modifica({ id: MODELLO, name: 'Webinar' }),
    togli(),
  ];

  it('senza sessione e’ 401', async () => {
    sessione.cookie = undefined;
    const risposte = await Promise.all(chiamate());
    expect(risposte.map((r) => r.status)).toEqual([401, 401, 401]);
    expect(prisma.eventTemplate.findUnique).not.toHaveBeenCalled();
    nessunaScrittura();
  });

  it('chi organizza e’ rifiutato', async () => {
    await entra('ORGANIZER');
    const risposte = await Promise.all(chiamate());
    expect(risposte.map((r) => r.status)).toEqual([401, 401, 401]);
    expect(prisma.eventTemplate.findUnique).not.toHaveBeenCalled();
    nessunaScrittura();
  });
});

describe('POST', () => {
  it('un corpo non valido e’ 422, con il campo da correggere', async () => {
    const r = await crea({ name: 'Webinar', maxParticipants: 1 });
    expect(r.status).toBe(422);
    const corpo = (await r.json()) as { details: Array<{ path: string[] }> };
    expect(corpo.details[0]!.path).toEqual(['maxParticipants']);
    nessunaScrittura();
  });

  it('rifiuta i valori fuori dominio', async () => {
    const corpi = [
      {},
      { name: '' },
      { name: 'Webinar', waitingRoomEngine: 'ALTRO' },
      { name: 'Webinar', defaultDurationMinutes: 4 },
      { name: 'Webinar', defaultRetentionDays: 0 },
      { name: 'Webinar', defaultExpectedSpeakers: 31 },
      { name: 'Webinar', permissionMatrix: { qa: 'GUEST' } },
    ];
    for (const corpo of corpi) {
      expect((await crea(corpo)).status).toBe(422);
    }
    nessunaScrittura();
  });

  it('un corpo che non e’ JSON e’ 400', async () => {
    expect((await crea('non-json')).status).toBe(400);
    nessunaScrittura();
  });

  it('senza ordine il modello va in fondo all’elenco', async () => {
    const r = await crea({ name: 'Webinar' });
    expect(r.status).toBe(201);
    expect(creato()).toEqual({ name: 'Webinar', sortOrder: 5 });
  });

  it('il primo modello in assoluto ha ordine 1', async () => {
    prisma.eventTemplate.aggregate.mockResolvedValue({ _max: { sortOrder: null } });
    await crea({ name: 'Webinar' });
    expect(creato().sortOrder).toBe(1);
  });

  it('un ordine dato si rispetta', async () => {
    await crea({ name: 'Webinar', sortOrder: 0 });
    expect(creato().sortOrder).toBe(0);
  });

  it('lascia traccia del modello creato', async () => {
    await crea({ name: 'Webinar' });
    expect(prisma.adminAuditLog.create.mock.calls[0]![0].data).toMatchObject({
      action: 'EVENT_TEMPLATE_CREATE',
      target: MODELLO,
    });
  });
});

describe('cosa si salva', () => {
  it('un modello non avvia mai la registrazione da solo', async () => {
    await crea({ name: 'Webinar', autoStartRecording: true });
    expect(creato().autoStartRecording).toBe(false);

    await modifica({ id: MODELLO, autoStartRecording: true });
    expect(aggiornato().autoStartRecording).toBe(false);
  });

  it('il null di un campo JSON azzera la colonna', async () => {
    await crea({ name: 'Webinar', descriptionTemplate: null, permissionMatrix: null });
    expect(creato().descriptionTemplate).toBe(Prisma.DbNull);
    expect(creato().permissionMatrix).toBe(Prisma.DbNull);
  });

  it('una descrizione data si salva cosi’ com’e’', async () => {
    await crea({ name: 'Webinar', descriptionTemplate: { it: 'Testo' } });
    expect(creato().descriptionTemplate).toEqual({ it: 'Testo' });
  });

  it('la matrice perde ruoli e funzioni sconosciuti e tiene i moderatori', async () => {
    await crea({
      name: 'Webinar',
      permissionMatrix: { qa: ['GUEST', 'RUOLO_IGNOTO'], funzione_ignota: ['GUEST'] },
    });
    const matrice = creato().permissionMatrix;
    expect(matrice.qa).toEqual(['GUEST', 'MODERATOR', 'SPEAKER']);
    expect(matrice.recording_control).toEqual(['MODERATOR']);
    expect(matrice).not.toHaveProperty('funzione_ignota');
  });
});

describe('PUT', () => {
  it('senza identificativo e’ 422', async () => {
    expect((await modifica({ name: 'Webinar' })).status).toBe(422);
    nessunaScrittura();
  });

  it('un modello che non esiste e’ 404', async () => {
    prisma.eventTemplate.findUnique.mockResolvedValue(null);
    expect((await modifica({ id: MODELLO, name: 'Webinar' })).status).toBe(404);
    nessunaScrittura();
  });

  it('un corpo non valido e’ 422, e non si scrive niente', async () => {
    expect((await modifica({ id: MODELLO, maxParticipants: 1 })).status).toBe(422);
    nessunaScrittura();
  });

  it('tocca i soli campi mandati', async () => {
    const r = await modifica({ id: MODELLO, name: 'Webinar', chatEnabled: false });
    expect(r.status).toBe(200);
    expect(prisma.eventTemplate.update.mock.calls[0]![0]).toEqual({
      where: { id: MODELLO },
      data: { name: 'Webinar', chatEnabled: false },
    });
  });

  it('la traccia dice quali campi', async () => {
    await modifica({ id: MODELLO, name: 'Webinar' });
    expect(prisma.adminAuditLog.create.mock.calls[0]![0].data).toMatchObject({
      action: 'EVENT_TEMPLATE_UPDATE',
      target: MODELLO,
      details: JSON.stringify({ fields: ['name'] }),
    });
  });
});

describe('DELETE', () => {
  it('senza identificativo e’ 422', async () => {
    expect((await togli('')).status).toBe(422);
    nessunaScrittura();
  });

  it('un modello che non esiste e’ 404, senza traccia', async () => {
    prisma.eventTemplate.findUnique.mockResolvedValue(null);
    expect((await togli()).status).toBe(404);
    nessunaScrittura();
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it('si cancella anche un modello di sistema', async () => {
    prisma.eventTemplate.findUnique.mockResolvedValue({ id: MODELLO, isSystem: true });
    const r = await togli();
    expect(r.status).toBe(200);
    expect(prisma.eventTemplate.delete.mock.calls[0]![0]).toEqual({
      where: { id: MODELLO },
    });
    expect(prisma.adminAuditLog.create.mock.calls[0]![0].data).toMatchObject({
      action: 'EVENT_TEMPLATE_DELETE',
      target: MODELLO,
    });
  });
});
