// @vitest-environment node
/**
 * La valutazione di fine evento: la lascia solo chi ha partecipato, una volta
 * sola, a evento in corso o concluso entro la conservazione dei dati. I commenti
 * li legge solo il link primario di chi conduce, e nessuna risposta dice chi li
 * ha scritti.
 */
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    event: { findUnique: vi.fn() },
    registration: { findUnique: vi.fn() },
    eventFeedback: { findUnique: vi.fn(), create: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock('@/lib/db', () => ({ prisma }));

import { generateJitsiJwt, guestJitsiId, participantJitsiId } from '@/lib/auth/jwt';
import { issueRatingToken } from '@/lib/feedback/rating-link';

import { GET, POST } from './route';

const EVENTO = '11111111-1111-4111-8111-111111111111';
const ALTRO_EVENTO = '22222222-2222-4222-8222-222222222222';
const ISCRIZIONE = '33333333-3333-4333-8333-333333333333';
const STANZA = 'stanza-1';
const TOKEN_MODERATORE = 'token-del-moderatore';
const LINK_PERSONALE = 'link-personale';
const SEGRETO_SALA = 'segreto-della-sala-di-prova-abbastanza-lungo';
const GIORNO = 86_400_000;

let contatore = 0;
let indirizzo = '';
let iscrizione: { id: string; eventId: string; joinedAt: Date | null } | null = null;

function evento(extra: Record<string, unknown> = {}) {
  return {
    id: EVENTO,
    slug: 'evento',
    status: 'LIVE',
    jitsiRoomName: STANZA,
    moderatorToken: TOKEN_MODERATORE,
    endsAt: new Date(Date.now() - GIORNO),
    dataRetentionDays: 30,
    ...extra,
  };
}

function invia(corpo: unknown) {
  const request = new Request('http://localhost:3000/api/events/evento/feedback', {
    method: 'POST',
    headers: { 'x-forwarded-for': indirizzo },
    body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  });
  return POST(request as unknown as NextRequest, {
    params: Promise.resolve({ param: 'evento' }),
  });
}

function leggi(query = '', headers: Record<string, string> = {}) {
  const request = new Request(
    `http://localhost:3000/api/events/evento/feedback${query}`,
    {
      headers,
    }
  );
  return GET(request as unknown as NextRequest, {
    params: Promise.resolve({ param: 'evento' }),
  });
}

function tokenSala(
  posto: string,
  opzioni: { stanza?: string; moderatore?: boolean } = {}
): Promise<string> {
  return generateJitsiJwt({
    roomName: opzioni.stanza ?? STANZA,
    displayName: 'Anna Bianchi',
    uniqueId: posto,
    isModerator: opzioni.moderatore ?? false,
  });
}

function datiScritti() {
  return prisma.eventFeedback.create.mock.calls[0]![0].data as {
    eventId: string;
    registrationId: string | null;
    guestId: string | null;
    rating: number;
    comment: string | null;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  process.env.APP_SECRET = 'segreto-di-prova-della-valutazione-lungo';
  process.env.JITSI_JWT_SECRET = SEGRETO_SALA;
  indirizzo = `203.0.113.${++contatore}`;
  iscrizione = { id: ISCRIZIONE, eventId: EVENTO, joinedAt: new Date() };
  prisma.event.findUnique.mockResolvedValue(evento());
  prisma.registration.findUnique.mockImplementation(
    async ({ where }: { where: { id?: string; accessToken?: string } }) =>
      where.accessToken === LINK_PERSONALE || where.id === ISCRIZIONE ? iscrizione : null
  );
  prisma.eventFeedback.findUnique.mockResolvedValue(null);
  prisma.eventFeedback.create.mockImplementation(
    async ({ data }: { data: { rating: number } }) => ({ id: 'fb-1', ...data })
  );
  prisma.eventFeedback.findMany.mockResolvedValue([]);
});

describe('quando si valuta', () => {
  it('un evento inesistente e’ 404', async () => {
    prisma.event.findUnique.mockResolvedValue(null);
    expect((await invia({ rating: 5, accessToken: LINK_PERSONALE })).status).toBe(404);
  });

  it.each(['DRAFT', 'PUBLISHED', 'PROVISIONING', 'IDLE', 'ARCHIVED'])(
    'con l’evento in stato %s non si scrive niente',
    async (status) => {
      prisma.event.findUnique.mockResolvedValue(evento({ status }));
      expect((await invia({ rating: 5, accessToken: LINK_PERSONALE })).status).toBe(409);
      expect(prisma.eventFeedback.create).not.toHaveBeenCalled();
    }
  );

  it('a evento concluso si valuta finche’ i dati si conservano', async () => {
    prisma.event.findUnique.mockResolvedValue(
      evento({ status: 'ENDED', endsAt: new Date(Date.now() - 29 * GIORNO) })
    );
    expect((await invia({ rating: 5, accessToken: LINK_PERSONALE })).status).toBe(201);
  });

  it('oltre la conservazione dei dati non si raccoglie piu’ niente', async () => {
    prisma.event.findUnique.mockResolvedValue(
      evento({ status: 'ENDED', endsAt: new Date(Date.now() - 31 * GIORNO) })
    );
    expect((await invia({ rating: 5, accessToken: LINK_PERSONALE })).status).toBe(409);
    expect(prisma.eventFeedback.create).not.toHaveBeenCalled();
  });

  it('oltre il limite per indirizzo si ferma prima di leggere l’evento', async () => {
    prisma.event.findUnique.mockResolvedValue(null);
    for (let i = 0; i < 60; i++) await invia({ rating: 5, accessToken: LINK_PERSONALE });
    const r = await invia({ rating: 5, accessToken: LINK_PERSONALE });
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBeTruthy();
    expect(prisma.event.findUnique).toHaveBeenCalledTimes(60);
  });
});

describe('cosa si accetta', () => {
  it('un corpo che non e’ JSON e’ 400', async () => {
    expect((await invia('non json')).status).toBe(400);
  });

  it.each([
    ['un voto sotto il minimo', { rating: 0, accessToken: LINK_PERSONALE }],
    ['un voto sopra il massimo', { rating: 6, accessToken: LINK_PERSONALE }],
    ['un voto non intero', { rating: 2.5, accessToken: LINK_PERSONALE }],
    [
      'un commento troppo lungo',
      { rating: 3, accessToken: LINK_PERSONALE, comment: 'x'.repeat(501) },
    ],
    ['nessuna identita’', { rating: 3 }],
  ])('%s e’ 422', async (_nome, corpo) => {
    expect((await invia(corpo)).status).toBe(422);
    expect(prisma.eventFeedback.create).not.toHaveBeenCalled();
  });

  it('un commento vuoto non si salva', async () => {
    await invia({ rating: 4, accessToken: LINK_PERSONALE, comment: '' });
    expect(datiScritti().comment).toBeNull();
  });
});

describe('chi valuta', () => {
  it('l’identificativo scelto dal browser da solo non prova niente', async () => {
    const r = await invia({ rating: 5, guestId: 'browser-1' });
    expect(r.status).toBe(403);
    await expect(r.json()).resolves.toMatchObject({ code: 'NOT_A_PARTICIPANT' });
    expect(prisma.eventFeedback.create).not.toHaveBeenCalled();
  });

  it('un link personale sconosciuto e’ 403', async () => {
    expect((await invia({ rating: 5, accessToken: 'inventato' })).status).toBe(403);
    expect(prisma.eventFeedback.create).not.toHaveBeenCalled();
  });

  it('il link personale di un altro evento e’ 403', async () => {
    iscrizione = { id: ISCRIZIONE, eventId: ALTRO_EVENTO, joinedAt: new Date() };
    expect((await invia({ rating: 5, accessToken: LINK_PERSONALE })).status).toBe(403);
    expect(prisma.eventFeedback.create).not.toHaveBeenCalled();
  });

  it('chi si e’ iscritto ma non e’ mai entrato non valuta', async () => {
    iscrizione = { id: ISCRIZIONE, eventId: EVENTO, joinedAt: null };
    expect((await invia({ rating: 5, accessToken: LINK_PERSONALE })).status).toBe(403);
    expect(prisma.eventFeedback.create).not.toHaveBeenCalled();
  });

  it('chi e’ entrato valuta con la sua iscrizione', async () => {
    const r = await invia({
      rating: 4,
      accessToken: LINK_PERSONALE,
      comment: 'Molto utile',
      guestId: 'browser-1',
    });
    expect(r.status).toBe(201);
    expect(datiScritti()).toEqual({
      eventId: EVENTO,
      registrationId: ISCRIZIONE,
      guestId: null,
      rating: 4,
      comment: 'Molto utile',
    });
  });

  it('il link della valutazione vale per l’iscrizione entrata in sala', async () => {
    const r = await invia({
      rating: 4,
      ratingToken: issueRatingToken(EVENTO, ISCRIZIONE),
    });
    expect(r.status).toBe(201);
    expect(datiScritti().registrationId).toBe(ISCRIZIONE);
  });

  it('il link della valutazione di un altro evento non vale', async () => {
    const ratingToken = issueRatingToken(ALTRO_EVENTO, ISCRIZIONE);
    expect((await invia({ rating: 4, ratingToken })).status).toBe(403);
  });

  it('il link della valutazione alterato non vale', async () => {
    const ratingToken = `${issueRatingToken(EVENTO, ISCRIZIONE)!.slice(0, -2)}xx`;
    expect((await invia({ rating: 4, ratingToken })).status).toBe(403);
  });

  it('il link della valutazione di chi non e’ mai entrato non vale', async () => {
    iscrizione = { id: ISCRIZIONE, eventId: EVENTO, joinedAt: null };
    const ratingToken = issueRatingToken(EVENTO, ISCRIZIONE);
    expect((await invia({ rating: 4, ratingToken })).status).toBe(403);
  });

  it('un ospite valuta col token della sala, e la chiave e’ il suo posto', async () => {
    const posto = guestJitsiId();
    const r = await invia({ rating: 3, roomToken: await tokenSala(posto) });
    expect(r.status).toBe(201);
    expect(datiScritti()).toMatchObject({
      registrationId: null,
      guestId: `posto:${posto}`,
    });
  });

  it('l’identificativo del browser non sostituisce il posto', async () => {
    const posto = guestJitsiId();
    await invia({
      rating: 3,
      roomToken: await tokenSala(posto),
      guestId: 'scelto-dal-browser',
    });
    expect(datiScritti().guestId).toBe(`posto:${posto}`);
  });

  it('il token di un’altra stanza non vale', async () => {
    const roomToken = await tokenSala(guestJitsiId(), { stanza: 'altra-stanza' });
    expect((await invia({ rating: 3, roomToken })).status).toBe(403);
  });

  it('il token di chi modera non vale', async () => {
    const roomToken = await tokenSala('mod-1', { moderatore: true });
    expect((await invia({ rating: 3, roomToken })).status).toBe(403);
  });

  it('un token firmato con un altro segreto non vale', async () => {
    process.env.JITSI_JWT_SECRET = 'altro-segreto-della-sala-abbastanza-lungo';
    const roomToken = await tokenSala(guestJitsiId());
    process.env.JITSI_JWT_SECRET = SEGRETO_SALA;
    expect((await invia({ rating: 3, roomToken })).status).toBe(403);
  });

  it('un iscritto entrato da un altro dispositivo risponde con la sua iscrizione', async () => {
    iscrizione = { id: ISCRIZIONE, eventId: EVENTO, joinedAt: null };
    const roomToken = await tokenSala(participantJitsiId(ISCRIZIONE));
    await invia({ rating: 3, roomToken });
    expect(datiScritti()).toMatchObject({ registrationId: ISCRIZIONE, guestId: null });
  });

  it('il posto di un’iscrizione di un altro evento resta un posto anonimo', async () => {
    iscrizione = { id: ISCRIZIONE, eventId: ALTRO_EVENTO, joinedAt: new Date() };
    const posto = participantJitsiId(ISCRIZIONE);
    await invia({ rating: 3, roomToken: await tokenSala(posto) });
    expect(datiScritti()).toMatchObject({
      registrationId: null,
      guestId: `posto:${posto}`,
    });
  });

  it('chi ha in mano il link di un altro, mai entrato, non risponde a suo nome', async () => {
    iscrizione = { id: ISCRIZIONE, eventId: EVENTO, joinedAt: null };
    const posto = guestJitsiId();
    await invia({
      rating: 1,
      accessToken: LINK_PERSONALE,
      roomToken: await tokenSala(posto),
    });
    expect(datiScritti()).toMatchObject({
      registrationId: null,
      guestId: `posto:${posto}`,
    });
  });
});

describe('una risposta a testa', () => {
  it('una seconda risposta della stessa iscrizione e’ 409', async () => {
    prisma.eventFeedback.findUnique.mockResolvedValue({ id: 'fb-0' });
    expect((await invia({ rating: 5, accessToken: LINK_PERSONALE })).status).toBe(409);
    expect(prisma.eventFeedback.findUnique).toHaveBeenCalledWith({
      where: { eventId_registrationId: { eventId: EVENTO, registrationId: ISCRIZIONE } },
    });
    expect(prisma.eventFeedback.create).not.toHaveBeenCalled();
  });

  it('una seconda risposta dello stesso posto e’ 409', async () => {
    prisma.eventFeedback.findUnique.mockResolvedValue({ id: 'fb-0' });
    const posto = guestJitsiId();
    expect((await invia({ rating: 5, roomToken: await tokenSala(posto) })).status).toBe(
      409
    );
    expect(prisma.eventFeedback.findUnique).toHaveBeenCalledWith({
      where: { eventId_guestId: { eventId: EVENTO, guestId: `posto:${posto}` } },
    });
    expect(prisma.eventFeedback.create).not.toHaveBeenCalled();
  });

  it('la risposta non dice chi ha valutato, e l’indirizzo non si salva', async () => {
    const r = await invia({ rating: 5, accessToken: LINK_PERSONALE });
    await expect(r.json()).resolves.toEqual({ id: 'fb-1', rating: 5 });
    expect(JSON.stringify(datiScritti())).not.toContain(indirizzo);
  });
});

describe('la lettura', () => {
  const righe = [
    {
      id: 'fb-1',
      rating: 5,
      comment: 'Scrive Anna Bianchi',
      registrationId: ISCRIZIONE,
      guestId: null,
      createdAt: new Date('2026-10-02T10:00:00Z'),
    },
    {
      id: 'fb-2',
      rating: 4,
      comment: null,
      registrationId: null,
      guestId: 'posto:guest-1',
      createdAt: new Date('2026-10-02T10:01:00Z'),
    },
    {
      id: 'fb-3',
      rating: 4,
      comment: null,
      registrationId: null,
      guestId: 'posto:guest-2',
      createdAt: new Date('2026-10-02T10:02:00Z'),
    },
  ];

  beforeEach(() => {
    prisma.eventFeedback.findMany.mockResolvedValue(righe);
  });

  it('un evento inesistente e’ 404', async () => {
    prisma.event.findUnique.mockResolvedValue(null);
    expect((await leggi()).status).toBe(404);
  });

  it('senza token si vedono solo i numeri, e solo di questo evento', async () => {
    const r = await leggi();
    await expect(r.json()).resolves.toEqual({
      averageRating: 4.3,
      totalCount: 3,
      distribution: [0, 0, 0, 2, 1],
    });
    expect(prisma.eventFeedback.findMany.mock.calls[0]![0].where).toEqual({
      eventId: EVENTO,
    });
  });

  it('un evento senza valutazioni ha media zero', async () => {
    prisma.eventFeedback.findMany.mockResolvedValue([]);
    await expect((await leggi()).json()).resolves.toEqual({
      averageRating: 0,
      totalCount: 0,
      distribution: [0, 0, 0, 0, 0],
    });
  });

  it('un token sbagliato non apre i commenti', async () => {
    const testo = await (await leggi('', { authorization: 'Bearer sbagliato' })).text();
    expect(testo).not.toContain('Anna Bianchi');
  });

  it('il link primario legge i commenti, senza sapere chi li ha scritti', async () => {
    const r = await leggi('', { authorization: `Bearer ${TOKEN_MODERATORE}` });
    const testo = await r.text();
    const corpo = JSON.parse(testo) as { feedback: Array<Record<string, unknown>> };
    expect(corpo.feedback[0]).toEqual({
      id: 'fb-1',
      rating: 5,
      comment: 'Scrive Anna Bianchi',
      createdAt: '2026-10-02T10:00:00.000Z',
    });
    expect(testo).not.toContain(ISCRIZIONE);
    expect(testo).not.toContain('guest-1');
  });

  it('il token puo’ arrivare anche in ?token=', async () => {
    const corpo = (await (await leggi(`?token=${TOKEN_MODERATORE}`)).json()) as {
      feedback?: unknown[];
    };
    expect(corpo.feedback).toHaveLength(3);
  });
});
