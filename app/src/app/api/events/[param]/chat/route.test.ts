import type { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Chat authorization, exercised from the HTTP boundary down.
 *
 * Due falle vere sono già passate di qui, ed entrambe vivevano nel CABLAGGIO
 * fra route, read-access e sender — non dentro un singolo helper:
 *   1. `GET /chat` non aveva alcuna autenticazione: chiunque conoscesse lo slug
 *      scaricava la trascrizione (nomi veri + testo) di un evento concluso;
 *   2. l'identità si poteva dichiarare: il nome digitato dal client finiva per
 *      valere quanto quello autoritativo del DB.
 * Per questo qui NON si mocka l'autorizzazione (read-access / sender /
 * moderator girano davvero): si stubbano solo il DB e gli effetti collaterali
 * (fan-out Redis, cifratura a riposo, cookie). Mockare il gate significherebbe
 * testare il mock.
 */
vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findFirst: vi.fn(), findUnique: vi.fn() },
    chatMessage: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    registration: { findUnique: vi.fn() },
    eventModerator: { findUnique: vi.fn() },
  },
}));
// Identità: così l'asserzione sul nome persistito legge il plaintext.
vi.mock('@/lib/crypto/pii', () => ({
  encryptPII: (v: string) => v,
  tryDecryptPII: (v: string) => v,
}));
vi.mock('@/lib/chat/pubsub', () => ({ publishChat: vi.fn() }));
vi.mock('@/lib/events/join-grant', () => ({ hasJoinGrant: vi.fn() }));
vi.mock('@/lib/event-session', () => ({ readOwnedEventAccessToken: vi.fn() }));

import { prisma } from '@/lib/db';
import { senderColourKey } from '@/lib/chat/sender-key';
import { readOwnedEventAccessToken } from '@/lib/event-session';
import { hasJoinGrant } from '@/lib/events/join-grant';

import { GET, POST } from './route';

const mockedFindFirst = prisma.event.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockedFindUnique = prisma.event.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedMessages = prisma.chatMessage.findMany as unknown as ReturnType<typeof vi.fn>;
const mockedCreate = prisma.chatMessage.create as unknown as ReturnType<typeof vi.fn>;
const mockedRegistration = prisma.registration
  .findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedGrantRow = prisma.eventModerator
  .findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedJoinGrant = hasJoinGrant as unknown as ReturnType<typeof vi.fn>;
const mockedOwnedToken = readOwnedEventAccessToken as unknown as ReturnType<typeof vi.fn>;

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const SLUG = 'evento-di-prova';
const PRIMARY_TOKEN = 'PRIMARY_MOD_TOKEN';
const CO_MOD_TOKEN = 'CO_MOD_TOKEN';
const GRANT_ID = 'g-77';
const ACCESS_TOKEN = 'ALICE_ACCESS_TOKEN';

/** IP dell'ospite: il senderId lo contiene in chiaro (base64url di `ip:nome`). */
const GUEST_IP = '203.0.113.7';
const GUEST_SENDER_ID = `guest-${Buffer.from(`${GUEST_IP}:Anna`)
  .toString('base64url')
  .slice(0, 24)}`;

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

function messageRow(over: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    senderId: GUEST_SENDER_ID,
    senderName: 'Anna',
    isModerator: false,
    text: 'Buongiorno',
    createdAt: new Date('2026-07-22T10:00:00.000Z'),
    attachmentBlobPath: null,
    attachmentName: null,
    attachmentMime: null,
    attachmentSize: null,
    editedAt: null,
    reactions: [],
    replyToId: null,
    replyTo: null,
    ...over,
  };
}

/** Le `data` che la POST ha davvero persistito — dove si vede il nome scritto
 *  in chat, che è il punto in cui l'impersonazione si materializza. */
function persistedMessage(): Record<string, unknown> {
  const call = mockedCreate.mock.calls[0]?.[0] as
    | { data: Record<string, unknown> }
    | undefined;
  expect(call, 'nessun messaggio persistito').toBeDefined();
  return call!.data;
}

/** Il param di rotta arriva come Promise: è la firma di Next 15. */
const ctx = (param = SLUG) => ({ params: Promise.resolve({ param }) });

function getRequest(query = ''): NextRequest {
  return new Request(`https://webinar.gov.it/api/events/${SLUG}/chat${query}`, {
    headers: { 'x-forwarded-for': GUEST_IP },
  }) as unknown as NextRequest;
}

function postRequest(body: Record<string, unknown>, token?: string): NextRequest {
  return new Request(`https://webinar.gov.it/api/events/${SLUG}/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': GUEST_IP,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedFindFirst.mockResolvedValue(eventRow());
  mockedFindUnique.mockResolvedValue(eventRow());
  mockedMessages.mockResolvedValue([]);
  mockedRegistration.mockResolvedValue(null);
  mockedGrantRow.mockResolvedValue(null);
  mockedJoinGrant.mockResolvedValue(false);
  mockedOwnedToken.mockResolvedValue(null);
  mockedCreate.mockImplementation(
    ({ data }: { data: Record<string, unknown> }) => ({
      ...data,
      id: 'created-1',
      createdAt: new Date('2026-07-22T10:05:00.000Z'),
    }),
  );
});

describe('GET /api/events/[param]/chat — read authorization', () => {
  it('rejects an anonymous reader once the event is over, without touching the rows', async () => {
    // La falla come si presentò in prod: un curl anonimo su un evento ENDED
    // restituiva 25 messaggi con i nomi veri. Non basta il 403: la query non
    // deve nemmeno partire.
    mockedFindFirst.mockResolvedValue(eventRow({ status: 'ENDED' }));
    const res = await GET(getRequest(), ctx());
    expect(res.status).toBe(403);
    expect(mockedMessages).not.toHaveBeenCalled();
  });

  it('rejects an anonymous reader before the event goes live', async () => {
    mockedFindFirst.mockResolvedValue(eventRow({ status: 'PUBLISHED' }));
    expect((await GET(getRequest(), ctx())).status).toBe(403);
    expect(mockedMessages).not.toHaveBeenCalled();
  });

  it('rejects an anonymous reader on a password-protected event even while LIVE', async () => {
    // Chi non ha la password non entra in sala: non deve poterne leggere la
    // chat. È l'unico punto in cui la lettura è più severa della scrittura.
    mockedFindFirst.mockResolvedValue(eventRow({ joinPasswordHash: 'argon2-hash' }));
    const res = await GET(getRequest(), ctx());
    expect(res.status).toBe(403);
    expect(mockedMessages).not.toHaveBeenCalled();
  });

  it('serves the anonymous reader on a password event holding the join grant', async () => {
    mockedFindFirst.mockResolvedValue(eventRow({ joinPasswordHash: 'argon2-hash' }));
    mockedJoinGrant.mockResolvedValue(true);
    expect((await GET(getRequest(), ctx())).status).toBe(200);
  });

  it('rejects a token belonging to another event instead of reading it as a guest', async () => {
    // Registrazione esistente ma di un ALTRO evento: se il token sconosciuto
    // scivolasse nel ramo ospite, l'evento LIVE lo servirebbe lo stesso e un
    // token estraneo diventerebbe un lasciapassare silenzioso.
    mockedRegistration.mockResolvedValue({
      id: 'reg-9',
      displayName: 'Alice',
      eventId: 'un-altro-evento',
    });
    const res = await GET(getRequest(`?token=${ACCESS_TOKEN}`), ctx());
    expect(res.status).toBe(403);
    expect(mockedMessages).not.toHaveBeenCalled();
  });

  it('rejects a revoked co-moderator grant', async () => {
    mockedGrantRow.mockResolvedValue({
      id: GRANT_ID,
      eventId: EVENT_ID,
      revokedAt: new Date('2026-07-01T00:00:00.000Z'),
      role: 'MODERATOR',
      name: 'Mara Rossi',
      email: null,
    });
    expect((await GET(getRequest(`?token=${CO_MOD_TOKEN}`), ctx())).status).toBe(403);
  });
});

describe('GET /api/events/[param]/chat — identity and canEdit', () => {
  it('does not treat the shared primary moderator seat as a person', async () => {
    // `mod-<eventId>-primary` è lo STESSO id per chiunque abbia il link
    // primario: il messaggio risulta "mio" (colore/allineamento) ma modificarlo
    // significherebbe riscrivere le parole di un collega sotto il suo nome.
    mockedMessages.mockResolvedValue([
      messageRow({ id: 'm-mod', senderId: `mod-${EVENT_ID}-primary`, isModerator: true }),
      messageRow({ id: 'm-guest' }),
    ]);
    const res = await GET(getRequest(`?token=${PRIMARY_TOKEN}`), ctx());
    expect(res.status).toBe(200);
    const { messages } = await res.json();
    const own = messages.find((m: { id: string }) => m.id === 'm-mod');
    expect(own.mine).toBe(true);
    expect(own.canEdit).toBe(false);
    const other = messages.find((m: { id: string }) => m.id === 'm-guest');
    expect(other.mine).toBe(false);
    expect(other.canEdit).toBe(false);
  });

  it('treats a per-row grant as a person, and still serves it a concluded event', async () => {
    // Il grant per-riga è emesso a UNA persona: può modificare i propri
    // messaggi. Lo status ARCHIVED verifica insieme che il gate di lettura non
    // abbia chiuso fuori chi ha diritto all'archivio post-evento.
    mockedFindFirst.mockResolvedValue(eventRow({ status: 'ARCHIVED' }));
    mockedGrantRow.mockResolvedValue({
      id: GRANT_ID,
      eventId: EVENT_ID,
      revokedAt: null,
      role: 'MODERATOR',
      name: 'Mara Rossi',
      email: null,
    });
    mockedMessages.mockResolvedValue([
      messageRow({ id: 'm-mara', senderId: `mod-${EVENT_ID}-${GRANT_ID}`, isModerator: true }),
    ]);
    const res = await GET(getRequest(`?token=${CO_MOD_TOKEN}`), ctx());
    expect(res.status).toBe(200);
    const { messages } = await res.json();
    expect(messages[0].mine).toBe(true);
    expect(messages[0].canEdit).toBe(true);
  });

  it('gives an anonymous reader no authorship at all', async () => {
    mockedMessages.mockResolvedValue([messageRow()]);
    const res = await GET(getRequest(), ctx());
    const { messages } = await res.json();
    // Nessun token ⇒ nessun posto: nemmeno il messaggio scritto dallo stesso
    // browser è "suo" lato server.
    expect(messages[0].mine).toBe(false);
    expect(messages[0].canEdit).toBe(false);
    expect(messages[0].myReactions).toEqual([]);
  });
});

describe('GET /api/events/[param]/chat — the raw senderId never ships', () => {
  it('replaces it with a one-way key: a guest id decodes back to the attendee IP', async () => {
    mockedMessages.mockResolvedValue([messageRow()]);
    const res = await GET(getRequest(`?token=${PRIMARY_TOKEN}`), ctx());
    const body = await res.json();
    const payload = JSON.stringify(body);

    expect(body.messages[0]).not.toHaveProperty('senderId');
    expect(body.messages[0].senderKey).toBe(senderColourKey(GUEST_SENDER_ID));
    expect(body.messages[0].senderKey).toMatch(/^[0-9a-f]{16}$/);
    // Il controllo che conta davvero: né l'id grezzo né l'IP che ci sta dentro
    // devono comparire da nessuna parte nella risposta (la export della chat
    // scriverebbe quell'indirizzo in un file scaricabile).
    expect(payload).not.toContain(GUEST_SENDER_ID);
    expect(payload).not.toContain(GUEST_IP);
  });
});

describe('POST /api/events/[param]/chat — write authorization', () => {
  it('rejects a tokenless guest outside the guest window', async () => {
    mockedFindUnique.mockResolvedValue(eventRow({ status: 'PUBLISHED' }));
    const res = await POST(postRequest({ text: 'ciao', guestName: 'Anna' }), ctx());
    expect(res.status).toBe(403);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('rejects an unknown token instead of degrading it to a guest', async () => {
    // Evento LIVE: il ramo ospite accetterebbe. Un token scaduto/estraneo deve
    // fallire rumorosamente, altrimenti nessuno si accorge che è invalido.
    const res = await POST(
      postRequest({ text: 'ciao', guestName: 'Anna' }, 'TOKEN-INVENTATO'),
      ctx(),
    );
    expect(res.status).toBe(403);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('does not return the raw senderId to the guest who just posted', async () => {
    const res = await POST(postRequest({ text: 'ciao', guestName: 'Anna' }), ctx());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).not.toHaveProperty('senderId');
    expect(JSON.stringify(body)).not.toContain(GUEST_IP);
    expect(body.senderKey).toBe(senderColourKey(GUEST_SENDER_ID));
    // Un ospite non è una persona identificata (l'id è base64 di ip:nome e
    // collide dietro un NAT): niente modifica dei propri messaggi.
    expect(body.canEdit).toBe(false);
  });
});

describe('POST /api/events/[param]/chat — self-asserted names', () => {
  it('lets the shared primary link name itself, but never grants it authorship', async () => {
    const res = await POST(
      postRequest({ text: 'via!', displayNameOverride: 'Mario' }, PRIMARY_TOKEN),
      ctx(),
    );
    expect(res.status).toBe(201);
    const data = persistedMessage();
    expect(data.senderId).toBe(`mod-${EVENT_ID}-primary`);
    expect(data.senderName).toBe('Mario'); // il link primario non ha un nome per-persona
    expect(data.isModerator).toBe(true);
    // Posto condiviso ⇒ non è un'identità: la UI non deve offrire la modifica
    // (e il server la rifiuta comunque).
    expect((await res.json()).canEdit).toBe(false);
  });

  it('ignores the typed name for a per-row grant: the DB name is authoritative', async () => {
    // Impersonazione via nome digitato: un relatore/co-moderatore non può
    // firmarsi come qualcun altro, il suo nome lo decide la riga di grant.
    mockedGrantRow.mockResolvedValue({
      id: GRANT_ID,
      eventId: EVENT_ID,
      revokedAt: null,
      role: 'MODERATOR',
      name: 'Mara Rossi',
      email: null,
    });
    const res = await POST(
      postRequest({ text: 'buongiorno', displayNameOverride: 'Il Ministro' }, CO_MOD_TOKEN),
      ctx(),
    );
    expect(res.status).toBe(201);
    const data = persistedMessage();
    expect(data.senderName).toBe('Mara Rossi');
    expect(data.senderName).not.toBe('Il Ministro');
    expect((await res.json()).canEdit).toBe(true);
  });

  it('never auto-attributes the registrant name to a forwarded link (F7)', async () => {
    // Il link personale inoltrato mantiene il posto reg-<id> (analytics e
    // rate-limit restano uniti) ma chi lo apre si chiama come ha digitato: il
    // nome vero della registrante non deve mai finire sotto le parole altrui.
    mockedRegistration.mockResolvedValue({
      id: 'reg-9',
      displayName: 'Alice Bianchi',
      eventId: EVENT_ID,
    });
    mockedOwnedToken.mockResolvedValue(null); // questo browser non si è registrato
    const res = await POST(
      postRequest({ text: 'ciao', displayNameOverride: 'Bob' }, ACCESS_TOKEN),
      ctx(),
    );
    expect(res.status).toBe(201);
    const data = persistedMessage();
    expect(data.senderId).toBe('reg-reg-9');
    expect(data.senderName).toBe('Bob');
    expect(data.senderName).not.toBe('Alice Bianchi');
    expect((await res.json()).canEdit).toBe(false);
  });

  it('gives the registering browser its real name and authorship', async () => {
    mockedRegistration.mockResolvedValue({
      id: 'reg-9',
      displayName: 'Alice Bianchi',
      eventId: EVENT_ID,
    });
    mockedOwnedToken.mockResolvedValue(ACCESS_TOKEN); // cookie event_access firmato
    const res = await POST(
      postRequest({ text: 'ciao', displayNameOverride: 'Bob' }, ACCESS_TOKEN),
      ctx(),
    );
    const data = persistedMessage();
    expect(data.senderName).toBe('Alice Bianchi'); // il nome digitato non prevale
    expect((await res.json()).canEdit).toBe(true);
  });
});
