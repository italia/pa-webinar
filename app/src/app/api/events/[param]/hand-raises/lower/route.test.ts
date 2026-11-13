// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
/**
 * Abbassare la mano di qualcun altro e' un potere di moderazione: serve il link
 * primario o una concessione MODERATOR valida di questo evento. Un relatore non
 * modera. Alla sala arriva solo un segnale con l'identificativo opaco di Jitsi.
 */
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, publishControl } = vi.hoisted(() => ({
  prisma: {
    event: { findFirst: vi.fn() },
    eventModerator: { findUnique: vi.fn() },
  },
  publishControl: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('@/lib/live-control/pubsub', () => ({ publishControl }));

import { POST } from './route';

const EVENTO = '11111111-1111-4111-8111-111111111111';
const ALTRO_EVENTO = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'token-del-moderatore-primario';
const TOKEN_CONCESSIONE = 'token-di-una-concessione';
const CORPO = { targetEndpointId: 'abc12345', raiseId: 1730000000000 };

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

let contatore = 0;
let indirizzo = '';

function abbassa(
  corpo: unknown = CORPO,
  headers: Record<string, string> = bearer(TOKEN),
  opzioni: { query?: string; param?: string } = {}
) {
  const { query = '', param = 'evento' } = opzioni;
  const request = new Request(
    `http://localhost:3000/api/events/${param}/hand-raises/lower${query}`,
    {
      method: 'POST',
      headers: { 'x-forwarded-for': indirizzo, ...headers },
      body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
    }
  );
  return POST(request as unknown as NextRequest, { params: Promise.resolve({ param }) });
}

function concessione(extra: Record<string, unknown> = {}) {
  return { eventId: EVENTO, revokedAt: null, role: 'MODERATOR', ...extra };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  indirizzo = `203.0.113.${++contatore}`;
  prisma.event.findFirst.mockResolvedValue({ id: EVENTO, moderatorToken: TOKEN });
  prisma.eventModerator.findUnique.mockResolvedValue(null);
  publishControl.mockResolvedValue(1);
});

describe('chi puo’ abbassare una mano', () => {
  it('senza token e’ 401, senza toccare il database', async () => {
    expect((await abbassa(CORPO, {})).status).toBe(401);
    expect(prisma.event.findFirst).not.toHaveBeenCalled();
  });

  it('un Bearer vuoto vale come nessun token', async () => {
    expect((await abbassa(CORPO, { authorization: 'Bearer ' })).status).toBe(401);
  });

  it('il token non viaggia in un header proprio', async () => {
    expect((await abbassa(CORPO, { 'x-moderator-token': TOKEN })).status).toBe(401);
    expect(publishControl).not.toHaveBeenCalled();
  });

  it('un evento inesistente e’ 404', async () => {
    prisma.event.findFirst.mockResolvedValue(null);
    expect((await abbassa()).status).toBe(404);
    expect(publishControl).not.toHaveBeenCalled();
  });

  it('un token sconosciuto e’ 403', async () => {
    expect((await abbassa(CORPO, bearer('sconosciuto'))).status).toBe(403);
    expect(publishControl).not.toHaveBeenCalled();
  });

  it('il link primario passa, anche con ?token=', async () => {
    expect((await abbassa(CORPO, {}, { query: `?token=${TOKEN}` })).status).toBe(200);
    expect(publishControl).toHaveBeenCalledTimes(1);
  });

  it('un co-moderatore di questo evento passa', async () => {
    prisma.eventModerator.findUnique.mockResolvedValue(concessione());
    expect((await abbassa(CORPO, bearer(TOKEN_CONCESSIONE))).status).toBe(200);
    expect(prisma.eventModerator.findUnique).toHaveBeenCalledWith({
      where: { token: TOKEN_CONCESSIONE },
    });
  });

  it.each([
    ['un relatore', { role: 'SPEAKER' }],
    ['una concessione revocata', { revokedAt: new Date() }],
    ['una concessione di un altro evento', { eventId: ALTRO_EVENTO }],
  ])('%s e’ 403', async (_nome, extra) => {
    prisma.eventModerator.findUnique.mockResolvedValue(concessione(extra));
    expect((await abbassa(CORPO, bearer(TOKEN_CONCESSIONE))).status).toBe(403);
    expect(publishControl).not.toHaveBeenCalled();
  });

  it('il limite conta solo chi modera: i tentativi rifiutati non lo consumano', async () => {
    for (let i = 0; i < 3; i++) await abbassa(CORPO, bearer('sconosciuto'));
    for (let i = 0; i < 60; i++) expect((await abbassa()).status).toBe(200);
    const r = await abbassa();
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBeTruthy();
    expect(publishControl).toHaveBeenCalledTimes(60);
  });
});

describe('il segnale', () => {
  it('un corpo che non e’ JSON e’ 400', async () => {
    expect((await abbassa('non json')).status).toBe(400);
    expect(publishControl).not.toHaveBeenCalled();
  });

  it.each([
    ['senza destinatario', { raiseId: 1 }],
    ['con un destinatario vuoto', { targetEndpointId: '', raiseId: 1 }],
    [
      'con un destinatario troppo lungo',
      { targetEndpointId: 'x'.repeat(257), raiseId: 1 },
    ],
    ['senza alzata', { targetEndpointId: 'abc12345' }],
    ['con un’alzata a zero', { targetEndpointId: 'abc12345', raiseId: 0 }],
    ['con un’alzata non intera', { targetEndpointId: 'abc12345', raiseId: 1.5 }],
  ])('%s e’ 422', async (_nome, corpo) => {
    expect((await abbassa(corpo)).status).toBe(422);
    expect(publishControl).not.toHaveBeenCalled();
  });

  it('parte sul canale di questo evento, con il destinatario e l’alzata', async () => {
    const r = await abbassa();
    expect(r.status).toBe(200);
    await expect(r.json()).resolves.toEqual({ ok: true });
    expect(publishControl).toHaveBeenCalledWith(EVENTO, {
      op: 'lowerHand',
      targetEndpointId: 'abc12345',
      raiseId: 1730000000000,
      ts: expect.any(String),
    });
  });

  it('nel segnale non passa niente oltre ai campi previsti', async () => {
    await abbassa({ ...CORPO, displayName: 'Anna Bianchi', email: 'anna@example.com' });
    const segnale = JSON.stringify(publishControl.mock.calls[0]![1]);
    expect(segnale).not.toContain('Anna');
    expect(segnale).not.toContain('example.com');
    expect(segnale).not.toContain(TOKEN);
  });

  it('l’evento si cerca per slug, o per identificativo se ne ha la forma', async () => {
    await abbassa();
    expect(prisma.event.findFirst.mock.calls[0]![0].where).toEqual({ slug: 'evento' });
    await abbassa(CORPO, bearer(TOKEN), { param: EVENTO });
    expect(prisma.event.findFirst.mock.calls[1]![0].where).toEqual({
      OR: [{ id: EVENTO }, { slug: EVENTO }],
    });
  });
});
