import type { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Il ping del giardino come CONTRATTO di rete, non come funzione.
 *
 * L'emote è stata aggiunta a un protocollo che gira già nei browser degli
 * utenti, quindi qui si presidiano le due cose che possono rompersi in modi
 * opposti: che il campo nuovo arrivi davvero fino al record Redis (altrimenti
 * il tasto emote torna a essere un no-op, solo spostato di un livello), e che
 * un client che quel campo non lo conosce continui a essere accettato.
 *
 * Si stubbano solo DB e Redis: schema, guardie di stato e mappatura del peer
 * girano davvero — è lì che vive il rischio.
 */
vi.mock('@/lib/db', () => ({
  prisma: { event: { findFirst: vi.fn() } },
}));
vi.mock('@/lib/garden/pubsub', () => ({
  publishGardenPing: vi.fn(),
  listGardenPeers: vi.fn(),
  removeGardenPeer: vi.fn(),
}));

import { prisma } from '@/lib/db';
import { publishGardenPing, listGardenPeers } from '@/lib/garden/pubsub';

import { POST } from './route';

const mockedEvent = prisma.event.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockedPublish = publishGardenPing as unknown as ReturnType<typeof vi.fn>;
const mockedList = listGardenPeers as unknown as ReturnType<typeof vi.fn>;

const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const SLUG = 'evento-di-prova';

/** Il ping minimo che manda un client precedente all'emote. */
function legacyPing(): Record<string, unknown> {
  return {
    userId: 'utente-0123456789',
    displayName: 'Bruno',
    avatarId: '008758',
    x: 50,
    y: 40,
    facing: 'down',
    walkPhase: 0,
  };
}

/** Il param di rotta arriva come Promise: è la firma di Next 15. */
const ctx = (param = SLUG) => ({ params: Promise.resolve({ param }) });

let ipCounter = 0;

function pingRequest(body: Record<string, unknown>): NextRequest {
  // Un IP diverso per richiesta: il rate limit della rotta è per IP e ha stato
  // di processo, quindi condividerlo legherebbe fra loro test indipendenti.
  ipCounter += 1;
  return new Request(`https://webinar.gov.it/api/events/${SLUG}/garden/ping`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `203.0.113.${ipCounter}`,
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

/** Il peer che la rotta ha davvero scritto su Redis. */
function publishedPeer(): Record<string, unknown> {
  const call = mockedPublish.mock.calls[0] as [string, Record<string, unknown>] | undefined;
  expect(call, 'nessun peer pubblicato').toBeDefined();
  return call![1];
}

beforeEach(() => {
  vi.clearAllMocks();
  ipCounter = 0;
  mockedEvent.mockResolvedValue({ id: EVENT_ID, status: 'LIVE' });
  mockedList.mockResolvedValue([]);
});

describe('POST /api/events/[param]/garden/ping — canale emote', () => {
  it('inoltra l’emote fino al record del peer', async () => {
    const body = { ...legacyPing(), emote: { type: 'wave', at: 1_000 } };
    const res = await POST(pingRequest(body), ctx());

    expect(res.status).toBe(200);
    expect(publishedPeer().emote).toEqual({ type: 'wave', at: 1_000 });
  });

  it('accetta il ping di un client che l’emote non la conosce', async () => {
    // Retrocompatibilità: i browser già aperti continuano a mandare il corpo
    // vecchio. Se lo schema diventasse esigente, il campo in più farebbe 400 su
    // OGNI ping e quei client sparirebbero dal giardino.
    const res = await POST(pingRequest(legacyPing()), ctx());

    expect(res.status).toBe(200);
    expect(publishedPeer()).not.toHaveProperty('emote');
  });

  it('rifiuta un’emote che non esiste, senza scriverla', async () => {
    // Il campo è relayato così com'è fino agli altri client: quello che entra
    // qui è quello che loro renderizzano, quindi il set va chiuso sul bordo.
    const body = { ...legacyPing(), emote: { type: 'rickroll', at: 1 } };
    const res = await POST(pingRequest(body), ctx());

    expect(res.status).toBe(400);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it('rifiuta un’emote senza timestamp: senza `at` il ricevente non deduplica', async () => {
    // `at` è l'identità dell'emote per chi legge: se manca, la ripetizione su
    // ogni ping farebbe ripartire l'animazione a ogni poll.
    const res = await POST(
      pingRequest({ ...legacyPing(), emote: { type: 'wave' } }),
      ctx(),
    );

    expect(res.status).toBe(400);
    expect(mockedPublish).not.toHaveBeenCalled();
  });
});
