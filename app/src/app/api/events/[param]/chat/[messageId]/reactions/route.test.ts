// @vitest-environment node
/**
 * La reazione a un messaggio della chat. Vale il posto, non la persona: chi
 * condivide un link condivide la reazione, per questo restano fuori gli ospiti,
 * il cui identificativo puo' coincidere fra sconosciuti. La sala riceve solo i
 * conteggi, mai chi ha reagito.
 */
import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, publishChat, biscotti } = vi.hoisted(() => ({
  prisma: {
    event: { findUnique: vi.fn() },
    eventModerator: { findUnique: vi.fn() },
    registration: { findUnique: vi.fn() },
    chatMessage: { findFirst: vi.fn() },
    chatMessageReaction: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
  },
  publishChat: vi.fn(),
  biscotti: new Map<string, { value: string }>(),
}));

vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('@/lib/chat/pubsub', () => ({ publishChat }));
vi.mock('@/lib/settings', () => ({
  getSettings: async () => ({ guestAccessEnabled: true }),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (nome: string) => biscotti.get(nome) }),
}));

import { encryptPII } from '@/lib/crypto/pii';
import { eventAccessCookieName, signEventAccess } from '@/lib/event-session';

import { POST } from './route';

const ALTRO_EVENTO = '22222222-2222-4222-8222-222222222222';
const MESSAGGIO = '33333333-3333-4333-8333-333333333333';
const CONCESSIONE = '55555555-5555-4555-8555-555555555555';
const TOKEN_PRIMARIO = 'token-del-moderatore-primario';
const TOKEN_CONCESSIONE = 'token-di-una-concessione';
const TOKEN_ISCRITTO = 'link-personale';

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

let contatore = 0;
let indirizzo = '';
// Il limite conta per posto ed evento: ogni prova ha i suoi.
let evento = '';
let iscrizioneId = '';
let riga: { id: string; eventId: string; hiddenAt: Date | null };
let concessione: Record<string, unknown> | null;
let iscrizione: Record<string, unknown> | null;

function reagisci(
  corpo: unknown,
  headers: Record<string, string> = bearer(TOKEN_ISCRITTO),
  messageId = MESSAGGIO
) {
  const request = new Request(
    `http://localhost:3000/api/events/evento/chat/${messageId}/reactions`,
    {
      method: 'POST',
      headers: { 'x-forwarded-for': indirizzo, ...headers },
      body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
    }
  );
  return POST(request as unknown as NextRequest, {
    params: Promise.resolve({ param: 'evento', messageId }),
  });
}

function rigaEvento(extra: Record<string, unknown> = {}) {
  return {
    id: evento,
    status: 'LIVE',
    eventType: 'SCHEDULED',
    accessMode: null,
    moderatorToken: TOKEN_PRIMARIO,
    moderatorName: 'Moderatore',
    chatEnabled: true,
    audienceAnonymous: false,
    ...extra,
  };
}

function nessunaScrittura() {
  expect(prisma.chatMessageReaction.create).not.toHaveBeenCalled();
  expect(prisma.chatMessageReaction.delete).not.toHaveBeenCalled();
  expect(publishChat).not.toHaveBeenCalled();
}

const postoIscritto = () => `reg-${iscrizioneId}`;

const postoScritto = () =>
  prisma.chatMessageReaction.create.mock.calls[0]![0].data.senderId as string;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  process.env.APP_SECRET = 'segreto-di-prova-delle-reazioni-in-chat-lungo';
  process.env.PII_ENCRYPTION_KEY = 'a'.repeat(64);
  indirizzo = `203.0.113.${++contatore}`;
  evento = randomUUID();
  iscrizioneId = randomUUID();
  biscotti.clear();
  riga = { id: MESSAGGIO, eventId: evento, hiddenAt: null };
  concessione = null;
  iscrizione = {
    id: iscrizioneId,
    eventId: evento,
    displayName: encryptPII('Anna Bianchi'),
  };
  prisma.event.findUnique.mockResolvedValue(rigaEvento());
  prisma.eventModerator.findUnique.mockImplementation(async () => concessione);
  prisma.registration.findUnique.mockImplementation(
    async ({ where }: { where: { accessToken: string } }) =>
      where.accessToken === TOKEN_ISCRITTO ? iscrizione : null
  );
  // Come il database: un messaggio di un altro evento o nascosto non si trova.
  prisma.chatMessage.findFirst.mockImplementation(
    async ({ where }: { where: { id: string; eventId: string; hiddenAt: null } }) =>
      where.id === riga.id &&
      where.eventId === riga.eventId &&
      where.hiddenAt === riga.hiddenAt
        ? { id: riga.id }
        : null
  );
  prisma.chatMessageReaction.findUnique.mockResolvedValue(null);
  prisma.chatMessageReaction.findMany.mockResolvedValue([]);
  prisma.chatMessageReaction.create.mockResolvedValue({ id: 'r1' });
  prisma.chatMessageReaction.delete.mockResolvedValue({ id: 'r1' });
  publishChat.mockResolvedValue(0);
});

describe('cosa si accetta', () => {
  it('un identificativo che non e’ un UUID e’ 404, senza toccare il database', async () => {
    expect((await reagisci({ emoji: '👍' }, undefined, 'non-un-uuid')).status).toBe(404);
    expect(prisma.event.findUnique).not.toHaveBeenCalled();
  });

  it('un corpo che non e’ JSON e’ 400', async () => {
    expect((await reagisci('non json')).status).toBe(400);
  });

  it.each([
    ['senza emoji', {}],
    ['con un testo libero al posto dell’emoji', { emoji: 'buuu' }],
    ['con un’emoji fuori dall’elenco', { emoji: '💩' }],
  ])('%s e’ 422', async (_nome, corpo) => {
    expect((await reagisci(corpo)).status).toBe(422);
    expect(prisma.event.findUnique).not.toHaveBeenCalled();
    nessunaScrittura();
  });

  it('un evento inesistente e’ 404', async () => {
    prisma.event.findUnique.mockResolvedValue(null);
    expect((await reagisci({ emoji: '👍' })).status).toBe(404);
    nessunaScrittura();
  });
});

describe('chi puo’ reagire', () => {
  it('un token che non corrisponde a niente e’ 403, non un ospite', async () => {
    const r = await reagisci({ emoji: '👍', guestName: 'Anna' }, bearer('inventato'));
    expect(r.status).toBe(403);
    nessunaScrittura();
  });

  it('l’iscrizione di un altro evento e’ 403', async () => {
    iscrizione = { ...iscrizione, eventId: ALTRO_EVENTO };
    expect((await reagisci({ emoji: '👍' })).status).toBe(403);
    nessunaScrittura();
  });

  it('una concessione di un altro evento e’ 403', async () => {
    concessione = {
      id: CONCESSIONE,
      eventId: ALTRO_EVENTO,
      role: 'MODERATOR',
      revokedAt: null,
      name: 'Luca Verdi',
      email: null,
    };
    expect((await reagisci({ emoji: '👍' }, bearer(TOKEN_CONCESSIONE))).status).toBe(403);
    nessunaScrittura();
  });

  it('una concessione revocata e’ 403', async () => {
    concessione = {
      id: CONCESSIONE,
      eventId: evento,
      role: 'MODERATOR',
      revokedAt: new Date(),
      name: 'Luca Verdi',
      email: null,
    };
    expect((await reagisci({ emoji: '👍' }, bearer(TOKEN_CONCESSIONE))).status).toBe(403);
    nessunaScrittura();
  });

  it('un ospite senza nome e’ 422', async () => {
    expect((await reagisci({ emoji: '👍' }, {})).status).toBe(422);
    nessunaScrittura();
  });

  it('un ospite, anche con la chat aperta, non reagisce', async () => {
    const r = await reagisci({ emoji: '👍', guestName: 'Anna Bianchi' }, {});
    expect(r.status).toBe(403);
    expect(prisma.chatMessage.findFirst).not.toHaveBeenCalled();
    nessunaScrittura();
  });

  it('fuori dalla diretta un ospite non entra neanche', async () => {
    prisma.event.findUnique.mockResolvedValue(rigaEvento({ status: 'PUBLISHED' }));
    const r = await reagisci({ emoji: '👍', guestName: 'Anna Bianchi' }, {});
    expect(r.status).toBe(403);
    nessunaScrittura();
  });

  it('il token non viaggia in un header proprio: senza Bearer si e’ ospiti', async () => {
    const r = await reagisci(
      { emoji: '👍', guestName: 'Anna Bianchi' },
      { 'x-moderator-token': TOKEN_PRIMARIO }
    );
    expect(r.status).toBe(403);
    nessunaScrittura();
  });

  it('il token passa anche con ?token=', async () => {
    const request = new Request(
      `http://localhost:3000/api/events/evento/chat/${MESSAGGIO}/reactions?token=${TOKEN_ISCRITTO}`,
      {
        method: 'POST',
        headers: { 'x-forwarded-for': indirizzo },
        body: JSON.stringify({ emoji: '👍' }),
      }
    );
    const r = await POST(request as unknown as NextRequest, {
      params: Promise.resolve({ param: 'evento', messageId: MESSAGGIO }),
    });
    expect(r.status).toBe(200);
  });

  it('con la chat spenta chi partecipa non reagisce', async () => {
    prisma.event.findUnique.mockResolvedValue(rigaEvento({ chatEnabled: false }));
    const r = await reagisci({ emoji: '👍' });
    expect(r.status).toBe(403);
    await expect(r.json()).resolves.toMatchObject({ code: 'CHAT_DISABLED' });
    nessunaScrittura();
  });

  it('con la chat spenta un relatore non reagisce: non modera', async () => {
    prisma.event.findUnique.mockResolvedValue(rigaEvento({ chatEnabled: false }));
    concessione = {
      id: CONCESSIONE,
      eventId: evento,
      role: 'SPEAKER',
      revokedAt: null,
      name: 'Luca Verdi',
      email: null,
    };
    const r = await reagisci({ emoji: '👍' }, bearer(TOKEN_CONCESSIONE));
    expect(r.status).toBe(403);
    nessunaScrittura();
  });

  it('con la chat spenta chi modera puo’ ancora reagire', async () => {
    prisma.event.findUnique.mockResolvedValue(rigaEvento({ chatEnabled: false }));
    expect((await reagisci({ emoji: '👍' }, bearer(TOKEN_PRIMARIO))).status).toBe(200);
  });
});

describe('il posto di chi reagisce', () => {
  it('l’iscritto reagisce dal posto della sua iscrizione', async () => {
    await reagisci({ emoji: '👍' });
    expect(prisma.chatMessageReaction.create).toHaveBeenCalledWith({
      data: { messageId: MESSAGGIO, senderId: postoIscritto(), emoji: '👍' },
    });
  });

  it('il link inoltrato resta lo stesso posto di chi si e’ iscritto', async () => {
    biscotti.set(eventAccessCookieName(evento), {
      value: await signEventAccess(evento, TOKEN_ISCRITTO, 3600),
    });
    await reagisci({ emoji: '👍' });
    const delProprietario = postoScritto();
    vi.mocked(prisma.chatMessageReaction.create).mockClear();
    biscotti.clear();
    await reagisci({ emoji: '👍' });
    expect(postoScritto()).toBe(delProprietario);
  });

  it('il link primario e’ un solo posto per tutti quelli che lo condividono', async () => {
    await reagisci(
      { emoji: '👍', displayNameOverride: 'Sara Neri' },
      bearer(TOKEN_PRIMARIO)
    );
    expect(postoScritto()).toBe(`mod-${evento}-primary`);
  });

  it('un relatore ha il suo posto, distinto da quello di chi modera', async () => {
    concessione = {
      id: CONCESSIONE,
      eventId: evento,
      role: 'SPEAKER',
      revokedAt: null,
      name: 'Luca Verdi',
      email: null,
    };
    await reagisci({ emoji: '👍' }, bearer(TOKEN_CONCESSIONE));
    expect(postoScritto()).toBe(`spk-${evento}-${CONCESSIONE}`);
  });
});

describe('il messaggio', () => {
  it('un messaggio che non esiste e’ 404', async () => {
    riga = { ...riga, id: 'altro' };
    expect((await reagisci({ emoji: '👍' })).status).toBe(404);
    nessunaScrittura();
  });

  it('il messaggio di un altro evento non si raggiunge', async () => {
    riga = { ...riga, eventId: ALTRO_EVENTO };
    expect((await reagisci({ emoji: '👍' })).status).toBe(404);
    nessunaScrittura();
  });

  it('un messaggio nascosto non prende reazioni', async () => {
    riga = { ...riga, hiddenAt: new Date() };
    expect((await reagisci({ emoji: '👍' })).status).toBe(404);
    nessunaScrittura();
  });
});

describe('l’interruttore', () => {
  it('la seconda volta toglie la reazione del proprio posto', async () => {
    prisma.chatMessageReaction.findUnique.mockResolvedValue({ id: 'r-esistente' });
    const r = await reagisci({ emoji: '👍' });
    expect(r.status).toBe(200);
    expect(prisma.chatMessageReaction.findUnique.mock.calls[0]![0].where).toEqual({
      messageId_senderId_emoji: {
        messageId: MESSAGGIO,
        senderId: postoIscritto(),
        emoji: '👍',
      },
    });
    expect(prisma.chatMessageReaction.delete).toHaveBeenCalledWith({
      where: { id: 'r-esistente' },
    });
    expect(prisma.chatMessageReaction.create).not.toHaveBeenCalled();
  });

  it('un doppione simultaneo sull’indice unico non e’ un errore', async () => {
    prisma.chatMessageReaction.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicato', {
        code: 'P2002',
        clientVersion: 'prova',
      })
    );
    expect((await reagisci({ emoji: '👍' })).status).toBe(200);
  });

  it('un altro errore del database non si tace', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    prisma.chatMessageReaction.create.mockRejectedValue(new Error('database giu’'));
    expect((await reagisci({ emoji: '👍' })).status).toBe(500);
  });

  it('oltre il limite del posto si ferma, anche cambiando indirizzo', async () => {
    for (let i = 0; i < 60; i++)
      expect((await reagisci({ emoji: '👍' })).status).toBe(200);
    indirizzo = '198.51.100.200';
    const r = await reagisci({ emoji: '👍' });
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBeTruthy();
    expect(prisma.chatMessageReaction.create).toHaveBeenCalledTimes(60);
  });
});

describe('cosa esce', () => {
  beforeEach(() => {
    prisma.chatMessageReaction.findMany.mockResolvedValue([
      { emoji: '👍', senderId: postoIscritto() },
      { emoji: '👍', senderId: `mod-${evento}-primary` },
      { emoji: '🎉', senderId: 'reg-di-qualcun-altro' },
    ]);
  });

  it('chi reagisce vede i conteggi e le proprie, mai i posti degli altri', async () => {
    const r = await reagisci({ emoji: '👍' });
    const testo = await r.text();
    expect(JSON.parse(testo)).toEqual({ reactions: { '👍': 2, '🎉': 1 }, mine: ['👍'] });
    expect(testo).not.toContain('reg-');
    expect(testo).not.toContain('mod-');
  });

  it('i conteggi sono solo di questo messaggio', async () => {
    await reagisci({ emoji: '👍' });
    expect(prisma.chatMessageReaction.findMany.mock.calls[0]![0].where).toEqual({
      messageId: MESSAGGIO,
    });
  });

  it('alla sala arrivano i conteggi, senza chi ha reagito', async () => {
    await reagisci({ emoji: '👍' });
    expect(publishChat).toHaveBeenCalledTimes(1);
    const busta = publishChat.mock.calls[0]![0] as Record<string, unknown>;
    expect(busta).toMatchObject({
      id: MESSAGGIO,
      eventId: evento,
      op: 'reaction',
      senderKey: '',
      senderName: '',
      isModerator: false,
      text: '',
      reactions: { '👍': 2, '🎉': 1 },
    });
    expect(JSON.stringify(busta)).not.toContain(postoIscritto());
  });
});
