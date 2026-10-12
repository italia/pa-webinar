import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * «Sta scrivendo», dalla frontiera HTTP in giù.
 *
 * Come per la POST dei messaggi, l'autenticazione NON si mocka
 * (authenticate / sender / read-access girano davvero): l'avviso deve passare
 * dalle stesse regole di chi scrive in chat, e mockarle significherebbe
 * provare il mock. Si stubbano solo il database, il fan-out Redis e gli effetti
 * collaterali (cifratura, cookie, impostazioni).
 */
vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findFirst: vi.fn(), findUnique: vi.fn() },
    chatMessage: { create: vi.fn() },
    registration: { findUnique: vi.fn() },
    eventModerator: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/crypto/pii', () => ({
  encryptPII: (v: string) => v,
  tryDecryptPII: (v: string) => v,
}));
vi.mock('@/lib/chat/typing-pubsub', () => ({ publishTyping: vi.fn() }));
vi.mock('@/lib/events/join-grant', () => ({ hasJoinGrant: vi.fn() }));
const { siteSettings } = vi.hoisted(() => ({ siteSettings: { guestAccessEnabled: true } }));
vi.mock('@/lib/settings', () => ({ getSettings: async () => siteSettings }));
vi.mock('@/lib/event-session', () => ({ readOwnedEventAccessToken: vi.fn() }));

import { prisma } from '@/lib/db';
import { guestSenderId, senderColourKey } from '@/lib/chat/sender-key';
import { publishTyping } from '@/lib/chat/typing-pubsub';
import { readOwnedEventAccessToken } from '@/lib/event-session';

import { POST } from './route';

const mockedFindUnique = prisma.event.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedCreate = prisma.chatMessage.create as unknown as ReturnType<typeof vi.fn>;
const mockedRegistration = prisma.registration
  .findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedGrantRow = prisma.eventModerator
  .findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedOwnedToken = readOwnedEventAccessToken as unknown as ReturnType<typeof vi.fn>;
const mockedPublish = publishTyping as unknown as ReturnType<typeof vi.fn>;

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const SLUG = 'evento-di-prova';
const PRIMARY_TOKEN = 'PRIMARY_MOD_TOKEN';
const CO_MOD_TOKEN = 'CO_MOD_TOKEN';
const GRANT_ID = 'g-77';

const GUEST_IP = '203.0.113.7';

function eventRow(over: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    slug: SLUG,
    status: 'LIVE',
    eventType: 'SCHEDULED',
    moderatorToken: PRIMARY_TOKEN,
    moderatorName: 'Segreteria',
    joinPasswordHash: null,
    ...over,
  };
}

const ctx = (param = SLUG) => ({ params: Promise.resolve({ param }) });

function typingRequest(
  body: unknown,
  { token, ip = GUEST_IP }: { token?: string; ip?: string } = {},
): NextRequest {
  return new Request(`https://webinar.gov.it/api/events/${SLUG}/chat/typing`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as unknown as NextRequest;
}

/** L'unico avviso pubblicato dalla richiesta. */
function published(): Record<string, unknown> {
  expect(mockedPublish).toHaveBeenCalledTimes(1);
  return mockedPublish.mock.calls[0]![0] as Record<string, unknown>;
}

// I limiti sono in memoria e contano sull'orologio: ogni test parte due minuti
// dopo il precedente, così nessuna finestra resta aperta da un test all'altro.
let orologio = Date.parse('2026-10-06T10:00:00.000Z');

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  orologio += 120_000;
  vi.setSystemTime(orologio);
  siteSettings.guestAccessEnabled = true;
  mockedFindUnique.mockResolvedValue(eventRow());
  mockedRegistration.mockResolvedValue(null);
  mockedGrantRow.mockResolvedValue(null);
  mockedOwnedToken.mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('POST /api/events/[param]/chat/typing — chi può avvisare', () => {
  it('un ospite su un evento LIVE: 204, nessun corpo, nessuna scrittura nel database', async () => {
    const res = await POST(typingRequest({ guestName: 'Anna' }), ctx());
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(mockedCreate).not.toHaveBeenCalled();
    const avviso = published();
    expect(avviso.eventId).toBe(EVENT_ID);
    expect(avviso.senderName).toBe('Anna');
  });

  it('pubblica la chiave opaca, mai l’id grezzo né l’indirizzo dell’ospite', async () => {
    // L'avviso arriva a ogni lettore della sala, ospiti senza token compresi.
    await POST(typingRequest({ guestName: 'Anna' }), ctx());
    const avviso = published();
    const idGrezzo = guestSenderId(GUEST_IP, 'Anna');
    expect(avviso).not.toHaveProperty('senderId');
    expect(avviso.senderKey).toBe(senderColourKey(idGrezzo));
    const payload = JSON.stringify(avviso);
    expect(payload).not.toContain(idGrezzo);
    expect(payload).not.toContain(GUEST_IP);
  });

  it('rifiuta un ospite fuori dalla finestra degli ospiti', async () => {
    mockedFindUnique.mockResolvedValue(eventRow({ status: 'PUBLISHED' }));
    const res = await POST(typingRequest({ guestName: 'Anna' }), ctx());
    expect(res.status).toBe(403);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it('rifiuta un ospite quando l’accesso ospiti è spento', async () => {
    siteSettings.guestAccessEnabled = false;
    const res = await POST(typingRequest({ guestName: 'Anna' }), ctx());
    expect(res.status).toBe(403);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it('pretende il nome da un ospite senza token', async () => {
    const res = await POST(typingRequest({}), ctx());
    expect(res.status).toBe(422);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it('rifiuta un token sconosciuto invece di trattarlo da ospite', async () => {
    const res = await POST(typingRequest({ guestName: 'Anna' }, { token: 'TOKEN-INVENTATO' }), ctx());
    expect(res.status).toBe(403);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it('risponde 404 per un evento che non esiste', async () => {
    mockedFindUnique.mockResolvedValue(null);
    const res = await POST(typingRequest({ guestName: 'Anna' }), ctx());
    expect(res.status).toBe(404);
    expect(mockedPublish).not.toHaveBeenCalled();
  });
});

describe('POST /api/events/[param]/chat/typing — validazione del corpo', () => {
  it.each([
    ['un nome troppo lungo', { guestName: 'x'.repeat(81) }],
    ['un nome vuoto', { guestName: '   ' }],
    ['un nome non stringa', { guestName: 42 }],
    ['un override troppo lungo', { displayNameOverride: 'x'.repeat(81) }],
  ])('rifiuta %s', async (_caso, body) => {
    const res = await POST(typingRequest(body), ctx());
    expect(res.status).toBe(422);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it('rifiuta un corpo che non è JSON', async () => {
    const res = await POST(typingRequest('non json'), ctx());
    expect(res.status).toBe(400);
  });

  it('rifiuta un corpo oltre il limite prima di leggerlo', async () => {
    const res = await POST(typingRequest({ guestName: 'Anna', zavorra: 'x'.repeat(4096) }), ctx());
    expect(res.status).toBe(413);
    expect(mockedPublish).not.toHaveBeenCalled();
  });
});

describe('POST /api/events/[param]/chat/typing — nomi', () => {
  it('il link primario condiviso si presenta col nome dichiarato, sulla chiave del posto', async () => {
    const res = await POST(
      typingRequest({ displayNameOverride: 'Mario' }, { token: PRIMARY_TOKEN }),
      ctx(),
    );
    expect(res.status).toBe(204);
    const avviso = published();
    expect(avviso.senderName).toBe('Mario');
    expect(avviso.senderKey).toBe(senderColourKey(`mod-${EVENT_ID}-primary`));
  });

  it('per un grant nominale il nome è quello registrato, non quello digitato', async () => {
    mockedGrantRow.mockResolvedValue({
      id: GRANT_ID,
      eventId: EVENT_ID,
      revokedAt: null,
      role: 'MODERATOR',
      name: 'Mara Rossi',
      email: null,
    });
    const res = await POST(
      typingRequest({ displayNameOverride: 'Il Ministro' }, { token: CO_MOD_TOKEN }),
      ctx(),
    );
    expect(res.status).toBe(204);
    expect(published().senderName).toBe('Mara Rossi');
  });

  it('chi ha un token può mandare un corpo vuoto', async () => {
    const res = await POST(typingRequest({}, { token: PRIMARY_TOKEN }), ctx());
    expect(res.status).toBe(204);
    expect(published().senderName).toBe('Segreteria');
  });
});

describe('POST /api/events/[param]/chat/typing — limiti', () => {
  it('oltre 40 avvisi al minuto dello stesso mittente risponde 429', async () => {
    for (let i = 0; i < 40; i++) {
      // Un secondo fra un avviso e l'altro: il tetto per evento non entra in gioco.
      vi.setSystemTime(orologio + i * 1000);
      const ok = await POST(typingRequest({ guestName: 'Anna' }), ctx());
      expect(ok.status).toBe(204);
    }
    vi.setSystemTime(orologio + 40_000);
    const res = await POST(typingRequest({ guestName: 'Anna' }), ctx());
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
    expect(mockedPublish).toHaveBeenCalledTimes(40);
  });

  it('un altro mittente sullo stesso evento ha il suo limite', async () => {
    for (let i = 0; i < 41; i++) {
      vi.setSystemTime(orologio + i * 1000);
      await POST(typingRequest({ guestName: 'Anna' }), ctx());
    }
    const res = await POST(typingRequest({ guestName: 'Bruno' }), ctx());
    expect(res.status).toBe(204);
  });

  it('oltre il tetto per evento accetta ma non pubblica', async () => {
    // Ogni avviso raggiunge ogni lettore: in una sala grande che scrive tutta
    // insieme si pubblica solo quanto basta a dire «più persone stanno scrivendo».
    const esiti: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await POST(typingRequest({ guestName: `Ospite ${i}` }), ctx());
      esiti.push(res.status);
    }
    expect(esiti.every((s) => s === 204)).toBe(true);
    expect(mockedPublish).toHaveBeenCalledTimes(10);

    // Il secondo dopo si riparte.
    vi.setSystemTime(orologio + 1000);
    await POST(typingRequest({ guestName: 'Ospite 0' }), ctx());
    expect(mockedPublish).toHaveBeenCalledTimes(11);
  });
});
