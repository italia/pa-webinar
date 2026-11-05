// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
/**
 * Gli enti che organizzano un evento: l'elenco e' pubblico, perche' sta sulla
 * pagina dell'evento, ma lo cambia solo il link primario: un co-moderatore o un
 * relatore non aggiungono nessuno.
 */
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    event: { findUnique: vi.fn() },
    eventOrganizer: { findMany: vi.fn(), aggregate: vi.fn(), create: vi.fn() },
  },
}));

vi.mock('@/lib/db', () => ({ prisma }));

import { GET, POST } from './route';

const EVENTO = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'token-del-moderatore-primario';
const CORPO = { name: 'Comune di Esempio' };

let contatore = 0;
let indirizzo = '';

function elenca(param = 'evento') {
  const request = new Request(`http://localhost:3000/api/events/${param}/organizers`);
  return GET(request as unknown as NextRequest, { params: Promise.resolve({ param }) });
}

function aggiungi(
  corpo: unknown,
  headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` },
  query = ''
) {
  const request = new Request(
    `http://localhost:3000/api/events/evento/organizers${query}`,
    {
      method: 'POST',
      headers: { 'x-forwarded-for': indirizzo, ...headers },
      body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
    }
  );
  return POST(request as unknown as NextRequest, {
    params: Promise.resolve({ param: 'evento' }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  indirizzo = `203.0.113.${++contatore}`;
  prisma.event.findUnique.mockResolvedValue({ id: EVENTO, moderatorToken: TOKEN });
  prisma.eventOrganizer.findMany.mockResolvedValue([
    { id: 'o1', name: 'Comune di Esempio' },
  ]);
  prisma.eventOrganizer.aggregate.mockResolvedValue({ _max: { sortOrder: 3 } });
  prisma.eventOrganizer.create.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({ id: 'o2', ...data })
  );
});

describe('l’elenco', () => {
  it('si legge senza token, solo per questo evento', async () => {
    const r = await elenca();
    expect(r.status).toBe(200);
    await expect(r.json()).resolves.toEqual({
      rows: [{ id: 'o1', name: 'Comune di Esempio' }],
    });
    expect(prisma.eventOrganizer.findMany.mock.calls[0]![0].where).toEqual({
      eventId: EVENTO,
    });
  });

  it('un evento inesistente e’ 404', async () => {
    prisma.event.findUnique.mockResolvedValue(null);
    expect((await elenca()).status).toBe(404);
    expect(prisma.eventOrganizer.findMany).not.toHaveBeenCalled();
  });

  it('l’evento si cerca per identificativo o per slug', async () => {
    await elenca(EVENTO);
    expect(prisma.event.findUnique).toHaveBeenLastCalledWith({ where: { id: EVENTO } });
    await elenca('evento');
    expect(prisma.event.findUnique).toHaveBeenLastCalledWith({
      where: { slug: 'evento' },
    });
  });
});

describe('chi aggiunge', () => {
  it('senza token e’ 401', async () => {
    expect((await aggiungi(CORPO, {})).status).toBe(401);
    expect(prisma.event.findUnique).not.toHaveBeenCalled();
  });

  it('il token non viaggia in un header proprio', async () => {
    expect((await aggiungi(CORPO, { 'x-moderator-token': TOKEN })).status).toBe(401);
    expect(prisma.eventOrganizer.create).not.toHaveBeenCalled();
  });

  it('un evento inesistente e’ 404', async () => {
    prisma.event.findUnique.mockResolvedValue(null);
    expect((await aggiungi(CORPO)).status).toBe(404);
  });

  it('un token che non e’ quello primario e’ 403', async () => {
    const r = await aggiungi(CORPO, {
      authorization: 'Bearer token-di-un-co-moderatore',
    });
    expect(r.status).toBe(403);
    expect(prisma.eventOrganizer.create).not.toHaveBeenCalled();
  });

  it('il link primario passa anche con ?token=', async () => {
    expect((await aggiungi(CORPO, {}, `?token=${TOKEN}`)).status).toBe(201);
  });

  it('oltre il limite si ferma, e i tentativi rifiutati non lo consumano', async () => {
    for (let i = 0; i < 5; i++) {
      await aggiungi(CORPO, { authorization: 'Bearer sbagliato' });
    }
    for (let i = 0; i < 20; i++) expect((await aggiungi(CORPO)).status).toBe(201);
    const r = await aggiungi(CORPO);
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBeTruthy();
    expect(prisma.eventOrganizer.create).toHaveBeenCalledTimes(20);
  });
});

describe('cosa si scrive', () => {
  it('logo e sito sono solo indirizzi http o https', async () => {
    for (const corpo of [
      { name: 'Ente', websiteUrl: 'javascript:alert(1)' },
      { name: 'Ente', logoUrl: 'data:text/html,x' },
    ]) {
      expect((await aggiungi(corpo)).status).toBe(422);
    }
  });

  it('un corpo che non e’ JSON e’ 400', async () => {
    expect((await aggiungi('non json')).status).toBe(400);
  });

  it.each([
    ['senza nome', {}],
    ['con il nome vuoto', { name: '' }],
    ['con il nome troppo lungo', { name: 'x'.repeat(201) }],
    ['con un logo che non e’ un indirizzo', { ...CORPO, logoUrl: 'logo' }],
    ['con un sito che non e’ un indirizzo', { ...CORPO, websiteUrl: 'sito' }],
    ['con un ordine negativo', { ...CORPO, sortOrder: -1 }],
    ['con un ordine non intero', { ...CORPO, sortOrder: 1.5 }],
  ])('%s e’ 422', async (_nome, corpo) => {
    expect((await aggiungi(corpo)).status).toBe(422);
    expect(prisma.eventOrganizer.create).not.toHaveBeenCalled();
  });

  it('l’ente va nell’evento dell’indirizzo, non in quello del corpo', async () => {
    const r = await aggiungi({
      ...CORPO,
      eventId: '22222222-2222-4222-8222-222222222222',
      logoUrl: 'https://comune.example.com/logo.png',
      websiteUrl: 'https://comune.example.com',
    });
    expect(r.status).toBe(201);
    expect(prisma.eventOrganizer.create.mock.calls[0]![0].data).toEqual({
      eventId: EVENTO,
      name: 'Comune di Esempio',
      logoUrl: 'https://comune.example.com/logo.png',
      websiteUrl: 'https://comune.example.com',
      sortOrder: 4,
    });
  });

  it('senza ordine si mette in fondo, e il primo parte da uno', async () => {
    prisma.eventOrganizer.aggregate.mockResolvedValue({ _max: { sortOrder: null } });
    await aggiungi(CORPO);
    expect(prisma.eventOrganizer.aggregate.mock.calls[0]![0].where).toEqual({
      eventId: EVENTO,
    });
    expect(prisma.eventOrganizer.create.mock.calls[0]![0].data).toMatchObject({
      logoUrl: null,
      websiteUrl: null,
      sortOrder: 1,
    });
  });

  it('un ordine dato, anche zero, si rispetta', async () => {
    await aggiungi({ ...CORPO, sortOrder: 0 });
    expect(prisma.eventOrganizer.create.mock.calls[0]![0].data.sortOrder).toBe(0);
  });
});
