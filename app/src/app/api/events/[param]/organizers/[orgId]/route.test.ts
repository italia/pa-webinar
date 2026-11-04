// @vitest-environment node
/**
 * La modifica di un ente organizzatore: solo il link primario, e solo su un ente
 * di quell'evento. Il token di un evento non raggiunge gli enti di un altro.
 */
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    event: { findUnique: vi.fn() },
    eventOrganizer: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
  },
}));

vi.mock('@/lib/db', () => ({ prisma }));

import { DELETE, PATCH } from './route';

const EVENTO = '11111111-1111-4111-8111-111111111111';
const ALTRO_EVENTO = '22222222-2222-4222-8222-222222222222';
const ENTE = '33333333-3333-4333-8333-333333333333';
const TOKEN = 'token-del-moderatore-primario';
const BEARER = { authorization: `Bearer ${TOKEN}` };

function richiesta(
  metodo: 'PATCH' | 'DELETE',
  opzioni: { corpo?: unknown; headers?: Record<string, string>; query?: string } = {}
) {
  const { corpo, headers = BEARER, query = '' } = opzioni;
  return new Request(
    `http://localhost:3000/api/events/evento/organizers/${ENTE}${query}`,
    {
      method: metodo,
      headers,
      body:
        corpo === undefined
          ? undefined
          : typeof corpo === 'string'
            ? corpo
            : JSON.stringify(corpo),
    }
  ) as unknown as NextRequest;
}

const parametri = (orgId = ENTE, param = 'evento') => ({
  params: Promise.resolve({ param, orgId }),
});

const chiama = {
  PATCH: (headers?: Record<string, string>, orgId?: string) =>
    PATCH(
      richiesta('PATCH', { corpo: { name: 'Nuovo nome' }, headers }),
      parametri(orgId)
    ),
  DELETE: (headers?: Record<string, string>, orgId?: string) =>
    DELETE(richiesta('DELETE', { headers }), parametri(orgId)),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  prisma.event.findUnique.mockResolvedValue({ id: EVENTO, moderatorToken: TOKEN });
  prisma.eventOrganizer.findUnique.mockResolvedValue({ id: ENTE, eventId: EVENTO });
  prisma.eventOrganizer.update.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({ id: ENTE, ...data })
  );
  prisma.eventOrganizer.delete.mockResolvedValue({ id: ENTE });
});

function nessunaScrittura() {
  expect(prisma.eventOrganizer.update).not.toHaveBeenCalled();
  expect(prisma.eventOrganizer.delete).not.toHaveBeenCalled();
}

describe.each(['PATCH', 'DELETE'] as const)('%s: chi arriva all’ente', (metodo) => {
  it('senza token e’ 401', async () => {
    expect((await chiama[metodo]({})).status).toBe(401);
    expect(prisma.event.findUnique).not.toHaveBeenCalled();
  });

  it('il token non viaggia in un header proprio', async () => {
    expect((await chiama[metodo]({ 'x-moderator-token': TOKEN })).status).toBe(401);
    nessunaScrittura();
  });

  it('un identificativo che non e’ un UUID e’ 400, senza toccare il database', async () => {
    expect((await chiama[metodo](BEARER, 'non-un-uuid')).status).toBe(400);
    expect(prisma.event.findUnique).not.toHaveBeenCalled();
  });

  it('un evento inesistente e’ 404', async () => {
    prisma.event.findUnique.mockResolvedValue(null);
    expect((await chiama[metodo]()).status).toBe(404);
    nessunaScrittura();
  });

  it('un token che non e’ quello primario e’ 403', async () => {
    const r = await chiama[metodo]({ authorization: 'Bearer token-di-un-co-moderatore' });
    expect(r.status).toBe(403);
    expect(prisma.eventOrganizer.findUnique).not.toHaveBeenCalled();
    nessunaScrittura();
  });

  it('un ente che non esiste e’ 404', async () => {
    prisma.eventOrganizer.findUnique.mockResolvedValue(null);
    expect((await chiama[metodo]()).status).toBe(404);
    nessunaScrittura();
  });

  it('l’ente di un altro evento e’ 404', async () => {
    prisma.eventOrganizer.findUnique.mockResolvedValue({
      id: ENTE,
      eventId: ALTRO_EVENTO,
    });
    expect((await chiama[metodo]()).status).toBe(404);
    nessunaScrittura();
  });
});

describe('la modifica', () => {
  const modifica = (corpo: unknown) => PATCH(richiesta('PATCH', { corpo }), parametri());

  it('logo e sito sono solo indirizzi http o https', async () => {
    expect((await modifica({ websiteUrl: 'javascript:alert(1)' })).status).toBe(422);
    expect((await modifica({ logoUrl: 'data:text/html,x' })).status).toBe(422);
    expect(prisma.eventOrganizer.update).not.toHaveBeenCalled();
  });

  it('un corpo che non e’ JSON e’ 400', async () => {
    expect((await modifica('non json')).status).toBe(400);
    expect(prisma.eventOrganizer.update).not.toHaveBeenCalled();
  });

  it.each([
    ['un nome vuoto', { name: '' }],
    ['un nome troppo lungo', { name: 'x'.repeat(201) }],
    ['un logo che non e’ un indirizzo', { logoUrl: 'logo' }],
    ['un sito che non e’ un indirizzo', { websiteUrl: 'sito' }],
    ['un ordine negativo', { sortOrder: -1 }],
  ])('%s e’ 422', async (_nome, corpo) => {
    expect((await modifica(corpo)).status).toBe(422);
    expect(prisma.eventOrganizer.update).not.toHaveBeenCalled();
  });

  it('cambia solo i campi ammessi: l’ente non si sposta di evento', async () => {
    const r = await modifica({
      name: 'Nuovo nome',
      logoUrl: null,
      sortOrder: 2,
      eventId: ALTRO_EVENTO,
      id: 'altro',
    });
    expect(r.status).toBe(200);
    expect(prisma.eventOrganizer.update).toHaveBeenCalledWith({
      where: { id: ENTE },
      data: { name: 'Nuovo nome', logoUrl: null, sortOrder: 2 },
    });
  });

  it('l’evento si cerca anche per identificativo', async () => {
    await PATCH(
      richiesta('PATCH', { corpo: { name: 'Nuovo nome' } }),
      parametri(ENTE, EVENTO)
    );
    expect(prisma.event.findUnique).toHaveBeenCalledWith({ where: { id: EVENTO } });
  });
});

describe('la cancellazione', () => {
  it('toglie la riga e lo dice', async () => {
    const r = await DELETE(richiesta('DELETE'), parametri());
    expect(prisma.eventOrganizer.delete).toHaveBeenCalledWith({ where: { id: ENTE } });
    await expect(r.json()).resolves.toEqual({ deleted: true, id: ENTE });
  });

  it('il link primario passa anche con ?token=', async () => {
    const r = await DELETE(
      richiesta('DELETE', { headers: {}, query: `?token=${TOKEN}` }),
      parametri()
    );
    expect(r.status).toBe(200);
  });
});
