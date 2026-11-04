// @vitest-environment node
/**
 * Le reazioni della sala: pubbliche, quindi limitate per indirizzo e ristrette a
 * un insieme chiuso di emoji. La riga delle statistiche non dice chi ha reagito,
 * e un guasto del database non fa perdere il clic.
 */
import { randomUUID } from 'node:crypto';

import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    event: { findUnique: vi.fn() },
    $executeRaw: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('@/lib/redis', () => ({
  getRedis: () => null,
  getRedisSubscriber: () => null,
  withDeadline: <T>(promessa: Promise<T>) => promessa,
}));

import { GET, POST } from './route';

const parametri = { params: Promise.resolve({ param: 'evento' }) };

let contatore = 0;
let indirizzo = '';
let evento = '';

function reagisci(corpo: unknown) {
  const request = new Request('http://localhost:3000/api/events/evento/reactions', {
    method: 'POST',
    headers: { 'x-forwarded-for': indirizzo },
    body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  });
  return POST(request as unknown as NextRequest, parametri);
}

function conta() {
  const request = new Request('http://localhost:3000/api/events/evento/reactions');
  return GET(request as unknown as NextRequest, parametri);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  indirizzo = `203.0.113.${++contatore}`;
  // I contatori restano nella memoria del processo: ogni prova ha il suo evento.
  evento = randomUUID();
  prisma.event.findUnique.mockResolvedValue({ id: evento, status: 'LIVE' });
  prisma.$executeRaw.mockResolvedValue(1);
});

describe('l’invio di una reazione', () => {
  it('un evento inesistente e’ 404', async () => {
    prisma.event.findUnique.mockResolvedValue(null);
    expect((await reagisci({ emoji: '👍' })).status).toBe(404);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('un corpo che non e’ JSON e’ 400', async () => {
    expect((await reagisci('non json')).status).toBe(400);
  });

  it.each([
    ['manca', {}],
    ['e’ testo libero', { emoji: 'buuu' }],
    ['non e’ fra quelle ammesse', { emoji: '💩' }],
  ])('un’emoji che %s e’ 422 e non conta', async (_nome, corpo) => {
    expect((await reagisci(corpo)).status).toBe(422);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('ogni clic fa salire il contatore di quell’emoji', async () => {
    await expect((await reagisci({ emoji: '👏' })).json()).resolves.toEqual({
      ok: true,
      emoji: '👏',
      total: 1,
    });
    await expect((await reagisci({ emoji: '👏' })).json()).resolves.toMatchObject({
      total: 2,
    });
    await expect((await reagisci({ emoji: '🎉' })).json()).resolves.toMatchObject({
      total: 1,
    });
  });

  it('la riga salvata ha solo evento ed emoji, con il tetto per evento', async () => {
    await reagisci({ emoji: '👍' });
    const [testo, ...valori] = prisma.$executeRaw.mock.calls[0]! as [
      string[],
      ...unknown[],
    ];
    expect(valori).toEqual([evento, '👍', evento, 20000]);
    expect(testo.join('')).toContain(
      '"reactions" ("id", "event_id", "emoji", "created_at")'
    );
  });

  it('un guasto del database non fa fallire il clic', async () => {
    prisma.$executeRaw.mockRejectedValue(new Error('database irraggiungibile'));
    const r = await reagisci({ emoji: '👍' });
    expect(r.status).toBe(200);
    await expect(r.json()).resolves.toMatchObject({ ok: true, total: 1 });
  });

  it('oltre il limite per indirizzo non si conta piu’', async () => {
    for (let i = 0; i < 30; i++) await reagisci({ emoji: '👍' });
    const r = await reagisci({ emoji: '👍' });
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBeTruthy();
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(30);
    await expect((await conta()).json()).resolves.toMatchObject({ total: 30 });
  });
});

describe('la lettura dei conteggi', () => {
  it('un evento inesistente e’ 404', async () => {
    prisma.event.findUnique.mockResolvedValue(null);
    expect((await conta()).status).toBe(404);
  });

  it('elenca tutte le emoji, anche a zero, con il totale', async () => {
    await reagisci({ emoji: '👏' });
    await reagisci({ emoji: '👏' });
    await reagisci({ emoji: '🎉' });
    const corpo = (await (await conta()).json()) as {
      counts: Record<string, number>;
      total: number;
    };
    expect(corpo.counts).toMatchObject({ '👏': 2, '🎉': 1, '😂': 0 });
    expect(corpo.total).toBe(3);
  });

  it('i conteggi di un evento non finiscono in un altro', async () => {
    await reagisci({ emoji: '👏' });
    prisma.event.findUnique.mockResolvedValue({ id: randomUUID(), status: 'LIVE' });
    await expect((await conta()).json()).resolves.toMatchObject({ total: 0 });
  });
});
