// @vitest-environment node
/**
 * La cronologia di chi parla in diretta. L'ingresso e' pubblico: lo proteggono un
 * limite per indirizzo e i tetti sul lotto, sul registro e sui campi, e passa
 * solo cio' che lo schema prevede.
 */
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    event: { findFirst: vi.fn() },
    callSession: { findFirst: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('@/lib/db', () => ({ prisma }));

import { POST } from './route';

const EVENTO = '11111111-1111-4111-8111-111111111111';
const VOCE = { atMs: 1000, participantId: 'p1', displayName: 'Anna Bianchi' };

let contatore = 0;
let indirizzo = '';

function manda(corpo: unknown, param = 'evento') {
  const request = new Request(
    `http://localhost:3000/api/events/${param}/speaker-events`,
    {
      method: 'POST',
      headers: { 'x-forwarded-for': indirizzo },
      body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
    }
  );
  return POST(request as unknown as NextRequest, { params: Promise.resolve({ param }) });
}

function registroScritto() {
  return prisma.callSession.update.mock.calls[0]![0].data.dominantSpeakerLog as Array<{
    atMs: number;
    participantId: string;
  }>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  indirizzo = `203.0.113.${++contatore}`;
  prisma.event.findFirst.mockResolvedValue({ id: EVENTO });
  prisma.callSession.findFirst.mockResolvedValue({ id: 's1', dominantSpeakerLog: [] });
  prisma.callSession.update.mockResolvedValue({ id: 's1' });
});

describe('cosa si accetta', () => {
  it('un corpo che non e’ JSON e’ 400', async () => {
    expect((await manda('non json')).status).toBe(400);
  });

  it.each([
    ['un lotto assente', {}],
    ['un lotto vuoto', { events: [] }],
    ['un lotto oltre il tetto', { events: Array.from({ length: 2001 }, () => VOCE) }],
    ['un tempo negativo', { events: [{ ...VOCE, atMs: -1 }] }],
    ['un tempo non intero', { events: [{ ...VOCE, atMs: 1.5 }] }],
    ['un partecipante vuoto', { events: [{ ...VOCE, participantId: '' }] }],
    [
      'un partecipante troppo lungo',
      { events: [{ ...VOCE, participantId: 'x'.repeat(257) }] },
    ],
    ['un nome troppo lungo', { events: [{ ...VOCE, displayName: 'x'.repeat(257) }] }],
  ])('%s e’ 422 e non scrive', async (_nome, corpo) => {
    expect((await manda(corpo)).status).toBe(422);
    expect(prisma.event.findFirst).not.toHaveBeenCalled();
    expect(prisma.callSession.update).not.toHaveBeenCalled();
  });

  it('il lotto al tetto passa', async () => {
    const r = await manda({ events: Array.from({ length: 2000 }, () => VOCE) });
    expect(r.status).toBe(201);
  });

  it('oltre il limite per indirizzo si ferma prima di leggere l’evento', async () => {
    prisma.event.findFirst.mockResolvedValue(null);
    for (let i = 0; i < 60; i++) await manda({ events: [VOCE] });
    const r = await manda({ events: [VOCE] });
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBeTruthy();
    expect(prisma.event.findFirst).toHaveBeenCalledTimes(60);
  });
});

describe('dove si scrive', () => {
  it('un evento inesistente e’ 404', async () => {
    prisma.event.findFirst.mockResolvedValue(null);
    expect((await manda({ events: [VOCE] })).status).toBe(404);
    expect(prisma.callSession.update).not.toHaveBeenCalled();
  });

  it('senza una sessione aperta e’ 404', async () => {
    prisma.callSession.findFirst.mockResolvedValue(null);
    expect((await manda({ events: [VOCE] })).status).toBe(404);
    expect(prisma.callSession.update).not.toHaveBeenCalled();
  });

  it('va nella sessione aperta piu’ recente di questo evento', async () => {
    await manda({ events: [VOCE] });
    expect(prisma.callSession.findFirst.mock.calls[0]![0]).toMatchObject({
      where: { eventId: EVENTO, endedAt: null },
      orderBy: { startedAt: 'desc' },
    });
    expect(prisma.callSession.update.mock.calls[0]![0].where).toEqual({ id: 's1' });
  });

  it('l’evento si cerca per slug, o per identificativo se ne ha la forma', async () => {
    await manda({ events: [VOCE] });
    expect(prisma.event.findFirst.mock.calls[0]![0].where).toEqual({ slug: 'evento' });
    await manda({ events: [VOCE] }, EVENTO);
    expect(prisma.event.findFirst.mock.calls[1]![0].where).toEqual({
      OR: [{ id: EVENTO }, { slug: EVENTO }],
    });
  });
});

describe('il registro', () => {
  it('le voci nuove si accodano a quelle che ci sono', async () => {
    prisma.callSession.findFirst.mockResolvedValue({
      id: 's1',
      dominantSpeakerLog: [{ atMs: 1, participantId: 'p0' }],
    });
    const r = await manda({ events: [VOCE] });
    expect(r.status).toBe(201);
    expect(registroScritto().map((v) => [v.atMs, v.participantId])).toEqual([
      [1, 'p0'],
      [1000, 'p1'],
    ]);
    await expect(r.json()).resolves.toEqual({ ok: true, stored: 2 });
  });

  it('un registro che non e’ una lista riparte da vuoto', async () => {
    prisma.callSession.findFirst.mockResolvedValue({
      id: 's1',
      dominantSpeakerLog: { rotto: true },
    });
    await manda({ events: [VOCE] });
    expect(registroScritto()).toHaveLength(1);
  });

  it('oltre il tetto restano le voci piu’ recenti', async () => {
    prisma.callSession.findFirst.mockResolvedValue({
      id: 's1',
      dominantSpeakerLog: Array.from({ length: 5000 }, (_, i) => ({
        atMs: i,
        participantId: 'vecchio',
      })),
    });
    const r = await manda({ events: [{ atMs: 9000, participantId: 'nuovo' }] });
    const registro = registroScritto();
    expect(registro).toHaveLength(5000);
    expect(registro[0]!.atMs).toBe(1);
    expect(registro.at(-1)!.participantId).toBe('nuovo');
    await expect(r.json()).resolves.toEqual({ ok: true, stored: 5000 });
  });

  it('passa solo cio’ che lo schema prevede, e l’indirizzo non si salva', async () => {
    await manda({
      events: [{ ...VOCE, ip: '198.51.100.7', email: 'anna.bianchi@example.com' }],
    });
    const scritto = JSON.stringify(registroScritto());
    expect(scritto).not.toContain('198.51.100.7');
    expect(scritto).not.toContain('example.com');
    expect(scritto).not.toContain(indirizzo);
  });

  it('la risposta non riporta i nomi ricevuti', async () => {
    expect(await (await manda({ events: [VOCE] })).text()).not.toContain('Anna');
  });
});
