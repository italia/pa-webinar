// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
/**
 * Assenso e dissenso su un punto dell'agenda: funzione a scelta dell'evento, un
 * voto per identita', su un punto di quell'evento. Il limite per indirizzo e'
 * largo, perche' un ufficio esce da un solo indirizzo; quello che conta e' il
 * limite per chi vota.
 */
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, pokeLivePanel } = vi.hoisted(() => ({
  prisma: {
    event: { findUnique: vi.fn() },
    eventAgendaItem: { findUnique: vi.fn() },
    registration: { findUnique: vi.fn() },
    agendaItemReaction: { upsert: vi.fn(), deleteMany: vi.fn(), groupBy: vi.fn() },
  },
  pokeLivePanel: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('@/lib/live-state/publish', () => ({ pokeLivePanel }));
vi.mock('@/lib/settings', () => ({
  getSettings: async () => ({ guestAccessEnabled: true }),
}));

import { POST } from './route';

const EVENTO = '11111111-1111-4111-8111-111111111111';
const ALTRO_EVENTO = '22222222-2222-4222-8222-222222222222';
const PUNTO = '33333333-3333-4333-8333-333333333333';
const ISCRIZIONE = '44444444-4444-4444-8444-444444444444';
const LINK_PERSONALE = 'link-personale';

let contatore = 0;
let indirizzo = '';
let ospite = '';

function vota(corpo: unknown, punto = PUNTO) {
  const request = new Request(
    `http://localhost:3000/api/events/evento/agenda/${punto}/reactions`,
    {
      method: 'POST',
      headers: { 'x-forwarded-for': indirizzo },
      body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
    }
  );
  return POST(request as unknown as NextRequest, {
    params: Promise.resolve({ param: 'evento', id: punto }),
  });
}

const EVENTO_APERTO = {
  id: EVENTO,
  agendaEnabled: true,
  status: 'LIVE',
  eventType: 'INSTANT',
  accessMode: null,
  moderatorToken: 'token-moderatore',
  joinPasswordHash: null,
};

function nessunaScrittura() {
  expect(prisma.agendaItemReaction.upsert).not.toHaveBeenCalled();
  expect(prisma.agendaItemReaction.deleteMany).not.toHaveBeenCalled();
  expect(pokeLivePanel).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  contatore += 1;
  indirizzo = `203.0.113.${contatore}`;
  // Il limite per chi vota non guarda l'indirizzo: ogni prova ha il suo ospite.
  ospite = `browser-${contatore}`;
  prisma.event.findUnique.mockResolvedValue(EVENTO_APERTO);
  prisma.eventAgendaItem.findUnique.mockResolvedValue({ id: PUNTO, eventId: EVENTO });
  prisma.registration.findUnique.mockResolvedValue({ id: ISCRIZIONE, eventId: EVENTO });
  prisma.agendaItemReaction.upsert.mockResolvedValue({ id: 'v1' });
  prisma.agendaItemReaction.deleteMany.mockResolvedValue({ count: 1 });
  prisma.agendaItemReaction.groupBy.mockResolvedValue([
    { value: 'AGREE', _count: { _all: 3 } },
    { value: 'DISAGREE', _count: { _all: 1 } },
  ]);
});

describe('cosa si accetta', () => {
  it('un corpo che non e’ JSON e’ 400', async () => {
    expect((await vota('non json')).status).toBe(400);
  });

  it.each([
    ['senza valore', { guestId: 'browser-x' }],
    ['con un valore sconosciuto', { value: 'FORSE', guestId: 'browser-x' }],
    ['con un identificativo troppo lungo', { value: 'AGREE', guestId: 'x'.repeat(65) }],
    ['con un identificativo vuoto', { value: 'AGREE', guestId: '' }],
  ])('%s e’ 422', async (_nome, corpo) => {
    expect((await vota(corpo)).status).toBe(422);
    expect(prisma.event.findUnique).not.toHaveBeenCalled();
    nessunaScrittura();
  });

  it('senza identita’ e’ 422', async () => {
    expect((await vota({ value: 'AGREE' })).status).toBe(422);
    nessunaScrittura();
  });
});

describe('dove si vota', () => {
  it('un evento inesistente e’ 404', async () => {
    prisma.event.findUnique.mockResolvedValue(null);
    expect((await vota({ value: 'AGREE', guestId: ospite })).status).toBe(404);
    nessunaScrittura();
  });

  it('con l’agenda spenta non si vota', async () => {
    prisma.event.findUnique.mockResolvedValue({ id: EVENTO, agendaEnabled: false });
    expect((await vota({ value: 'AGREE', guestId: ospite })).status).toBe(403);
    expect(prisma.eventAgendaItem.findUnique).not.toHaveBeenCalled();
    nessunaScrittura();
  });

  it('un punto che non esiste e’ 404', async () => {
    prisma.eventAgendaItem.findUnique.mockResolvedValue(null);
    expect((await vota({ value: 'AGREE', guestId: ospite })).status).toBe(404);
    nessunaScrittura();
  });

  it('il punto di un altro evento non si raggiunge', async () => {
    prisma.eventAgendaItem.findUnique.mockResolvedValue({
      id: PUNTO,
      eventId: ALTRO_EVENTO,
    });
    expect((await vota({ value: 'AGREE', guestId: ospite })).status).toBe(404);
    nessunaScrittura();
  });
});

describe('chi vota', () => {
  it('un link personale sconosciuto e’ 403', async () => {
    prisma.registration.findUnique.mockResolvedValue(null);
    expect((await vota({ value: 'AGREE', accessToken: 'inventato' })).status).toBe(403);
    nessunaScrittura();
  });

  it('il link personale di un altro evento e’ 403', async () => {
    prisma.registration.findUnique.mockResolvedValue({
      id: ISCRIZIONE,
      eventId: ALTRO_EVENTO,
    });
    expect((await vota({ value: 'AGREE', accessToken: LINK_PERSONALE })).status).toBe(
      403
    );
    nessunaScrittura();
  });

  it('un link sbagliato non diventa un voto da ospite', async () => {
    prisma.registration.findUnique.mockResolvedValue(null);
    const r = await vota({ value: 'AGREE', accessToken: 'inventato', guestId: ospite });
    expect(r.status).toBe(403);
    nessunaScrittura();
  });

  it('l’iscritto vota con la sua iscrizione, e cambiare idea aggiorna il voto', async () => {
    const r = await vota({ value: 'DISAGREE', accessToken: LINK_PERSONALE });
    expect(r.status).toBe(201);
    expect(prisma.agendaItemReaction.upsert).toHaveBeenCalledWith({
      where: {
        agendaItemId_registrationId: { agendaItemId: PUNTO, registrationId: ISCRIZIONE },
      },
      create: {
        agendaItemId: PUNTO,
        registrationId: ISCRIZIONE,
        guestId: null,
        value: 'DISAGREE',
      },
      update: { value: 'DISAGREE' },
    });
  });

  it('l’ospite vota con l’identificativo del browser', async () => {
    await vota({ value: 'AGREE', guestId: ospite });
    expect(prisma.agendaItemReaction.upsert).toHaveBeenCalledWith({
      where: { agendaItemId_guestId: { agendaItemId: PUNTO, guestId: ospite } },
      create: {
        agendaItemId: PUNTO,
        registrationId: null,
        guestId: ospite,
        value: 'AGREE',
      },
      update: { value: 'AGREE' },
    });
  });
});

describe('il ritiro del voto', () => {
  it('l’iscritto ritira solo il proprio', async () => {
    const r = await vota({ value: null, accessToken: LINK_PERSONALE });
    expect(r.status).toBe(201);
    expect(prisma.agendaItemReaction.deleteMany).toHaveBeenCalledWith({
      where: { agendaItemId: PUNTO, registrationId: ISCRIZIONE },
    });
    expect(prisma.agendaItemReaction.upsert).not.toHaveBeenCalled();
  });

  it('l’ospite ritira solo il proprio', async () => {
    await vota({ value: null, guestId: ospite });
    expect(prisma.agendaItemReaction.deleteMany).toHaveBeenCalledWith({
      where: { agendaItemId: PUNTO, guestId: ospite },
    });
  });
});

describe('cosa esce', () => {
  it('i conteggi del punto e il proprio voto, senza identita’', async () => {
    const r = await vota({ value: 'AGREE', accessToken: LINK_PERSONALE });
    await expect(r.json()).resolves.toEqual({
      ok: true,
      itemId: PUNTO,
      agreeCount: 3,
      disagreeCount: 1,
      myReaction: 'AGREE',
    });
    expect(prisma.agendaItemReaction.groupBy.mock.calls[0]![0].where).toEqual({
      agendaItemId: PUNTO,
    });
  });

  it('senza voti i conteggi sono zero, e dopo il ritiro non resta il voto', async () => {
    prisma.agendaItemReaction.groupBy.mockResolvedValue([]);
    await expect(
      (await vota({ value: null, guestId: ospite })).json()
    ).resolves.toMatchObject({
      agreeCount: 0,
      disagreeCount: 0,
      myReaction: null,
    });
  });

  it('la sala viene avvisata di rileggere l’agenda', async () => {
    await vota({ value: 'AGREE', guestId: ospite });
    expect(pokeLivePanel).toHaveBeenCalledWith(EVENTO, 'agenda');
  });
});

describe('i limiti', () => {
  it('un ospite si ferma a trenta voti al minuto, anche cambiando indirizzo', async () => {
    for (let i = 0; i < 30; i++) {
      expect((await vota({ value: 'AGREE', guestId: ospite })).status).toBe(201);
    }
    indirizzo = '198.51.100.200';
    expect((await vota({ value: 'AGREE', guestId: ospite })).status).toBe(429);
    expect(prisma.agendaItemReaction.upsert).toHaveBeenCalledTimes(30);
  });

  it('un iscritto si ferma a trenta voti al minuto', async () => {
    const iscrizioneDelLimite = '55555555-5555-4555-8555-555555555555';
    prisma.registration.findUnique.mockResolvedValue({
      id: iscrizioneDelLimite,
      eventId: EVENTO,
    });
    for (let i = 0; i < 30; i++)
      await vota({ value: 'AGREE', accessToken: LINK_PERSONALE });
    expect((await vota({ value: 'AGREE', accessToken: LINK_PERSONALE })).status).toBe(
      429
    );
    expect(prisma.agendaItemReaction.upsert).toHaveBeenCalledTimes(30);
  });

  it('ruotare l’identificativo non aggira il limite per indirizzo', async () => {
    for (let i = 0; i < 600; i++)
      await vota({ value: 'AGREE', guestId: `${ospite}-${i}` });
    const r = await vota({ value: 'AGREE', guestId: `${ospite}-ultimo` });
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBeTruthy();
    expect(prisma.agendaItemReaction.upsert).toHaveBeenCalledTimes(600);
  });
});

describe('chi puo’ votare col browser', () => {
  it('oltre il limite si ferma prima di controllare la stanza', async () => {
    for (let i = 0; i < 30; i++) await vota({ value: 'AGREE', guestId: ospite });
    prisma.event.findUnique.mockResolvedValue({
      ...EVENTO_APERTO,
      accessMode: 'INVITATION',
    });
    expect((await vota({ value: 'AGREE', guestId: ospite })).status).toBe(429);
  });

  it('a evento finito non si vota, nemmeno con il link personale', async () => {
    for (const status of ['ENDED', 'ARCHIVED']) {
      prisma.event.findUnique.mockResolvedValue({ ...EVENTO_APERTO, status });
      expect((await vota({ value: 'AGREE', guestId: ospite })).status).toBe(409);
      expect((await vota({ value: 'AGREE', accessToken: LINK_PERSONALE })).status).toBe(
        409
      );
    }
    nessunaScrittura();
  });

  it('un ospite non vota dove la stanza non e’ aperta a chi arriva col link', async () => {
    prisma.event.findUnique.mockResolvedValue({ ...EVENTO_APERTO, status: 'PUBLISHED' });
    expect((await vota({ value: 'AGREE', guestId: ospite })).status).toBe(401);
    nessunaScrittura();
  });

  it('un evento a inviti non si vota inventando un identificativo', async () => {
    prisma.event.findUnique.mockResolvedValue({
      ...EVENTO_APERTO,
      eventType: 'SCHEDULED',
      accessMode: 'INVITATION',
    });
    expect((await vota({ value: 'AGREE', guestId: ospite })).status).toBe(401);
    nessunaScrittura();
  });

  it('un punto con un identificativo malformato e’ 404, senza toccare il database', async () => {
    const r = await vota({ value: 'AGREE', guestId: ospite }, 'non-un-uuid');
    expect(r.status).toBe(404);
    expect(prisma.event.findUnique).not.toHaveBeenCalled();
  });

  it('un voto non porta due identita’', async () => {
    await vota({
      value: 'AGREE',
      accessToken: LINK_PERSONALE,
      guestId: 'browser-altrui',
    });
    const { create } = prisma.agendaItemReaction.upsert.mock.calls[0]![0] as {
      create: { registrationId: string; guestId: string | null };
    };
    expect(create.registrationId).toBe(ISCRIZIONE);
    expect(create.guestId).toBeNull();
  });
});
