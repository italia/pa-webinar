import { describe, it, expect, vi, beforeEach } from 'vitest';

// authorizeChatRead is a pure GATE: it decides may-you-read, then delegates
// who-are-you to resolveTokenSender (covered in sender.test.ts). Mock the three
// collaborators so each test pins one branch of the gate and nothing else.
vi.mock('@/lib/db', () => ({
  prisma: { event: { findFirst: vi.fn() } },
}));
vi.mock('@/lib/chat/sender', () => ({
  resolveTokenSender: vi.fn(),
}));
vi.mock('@/lib/events/join-grant', () => ({
  hasJoinGrant: vi.fn(),
}));

import { resolveTokenSender } from '@/lib/chat/sender';
import { prisma } from '@/lib/db';
import { hasJoinGrant } from '@/lib/events/join-grant';

import { guestChatWindowOpen, authorizeChatRead } from './read-access';

const mockedEvent = prisma.event.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockedSender = resolveTokenSender as unknown as ReturnType<typeof vi.fn>;
const mockedJoinGrant = hasJoinGrant as unknown as ReturnType<typeof vi.fn>;

/**
 * The window in which an anonymous reader may follow the chat. It must stay
 * identical to the guest WRITE branch in the chat POST route — the read side
 * used to have no gate at all, which left every event's transcript (attendee
 * names + free text) fetchable by slug forever.
 */
describe('guestChatWindowOpen', () => {
  const scheduled = (status: string) => ({ status, eventType: 'SCHEDULED' });
  const instant = (status: string) => ({ status, eventType: 'INSTANT' });

  it('opens while the room is live, whatever the event type', () => {
    expect(guestChatWindowOpen(scheduled('LIVE'))).toBe(true);
    expect(guestChatWindowOpen(instant('LIVE'))).toBe(true);
  });

  it('opens during the bridge warm-up of an INSTANT call only', () => {
    // INSTANT rooms are opened by link with no time gate and show the chat while
    // the bridge scales up.
    expect(guestChatWindowOpen(instant('PROVISIONING'))).toBe(true);
    expect(guestChatWindowOpen(instant('IDLE'))).toBe(true);
    // A scheduled event must not: /wake is unauthenticated, so anyone could flip
    // PUBLISHED→PROVISIONING and then read the room anonymously.
    expect(guestChatWindowOpen(scheduled('PROVISIONING'))).toBe(false);
    expect(guestChatWindowOpen(scheduled('IDLE'))).toBe(false);
  });

  it('stays shut before and after the event — including ENDED and ARCHIVED', () => {
    // This is the hole that leaked the DevIt transcript days after the event.
    for (const status of ['DRAFT', 'PUBLISHED', 'ENDED', 'ARCHIVED', 'CANCELLED']) {
      expect(guestChatWindowOpen(scheduled(status)), status).toBe(false);
      expect(guestChatWindowOpen(instant(status)), `INSTANT ${status}`).toBe(false);
    }
  });
});

/**
 * The gate itself. Ogni test qui corrisponde a un modo concreto in cui la
 * cronologia (nomi veri + testo libero) è già uscita, o uscirebbe:
 *   • lettore anonimo su evento concluso  → la falla verificata in prod;
 *   • lettore anonimo su evento con password → "ho l'URL" non basta per entrare
 *     in sala, quindi non deve bastare per leggerne la sala;
 *   • token di un ALTRO evento che degrada a ospite → un token sbagliato
 *     deve fallire rumorosamente, non aprire una porta laterale.
 */
describe('authorizeChatRead', () => {
  const EVENT_ID = 'evt-1';
  const event = (over: Partial<Record<string, unknown>> = {}) => ({
    id: EVENT_ID,
    status: 'LIVE',
    eventType: 'SCHEDULED',
    moderatorToken: 'PRIMARY',
    joinPasswordHash: null,
    ...over,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockedEvent.mockResolvedValue(event());
    mockedSender.mockResolvedValue(null);
    mockedJoinGrant.mockResolvedValue(false);
  });

  it('404s on an unknown slug before looking at the token', async () => {
    mockedEvent.mockResolvedValue(null);
    await expect(authorizeChatRead('non-esiste', 'WHATEVER')).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
    expect(mockedSender).not.toHaveBeenCalled();
  });

  it('rejects a tokenless reader once the event is over', async () => {
    // La falla vera: un curl anonimo su un evento ENDED restituiva la
    // trascrizione completa con i nomi dei partecipanti.
    mockedEvent.mockResolvedValue(event({ status: 'ENDED' }));
    await expect(authorizeChatRead('evento', null)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('rejects a tokenless reader before the event starts', async () => {
    mockedEvent.mockResolvedValue(event({ status: 'PUBLISHED' }));
    await expect(authorizeChatRead('evento', null)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('admits a tokenless reader only inside the guest window', async () => {
    await expect(authorizeChatRead('evento', null)).resolves.toEqual({
      eventId: EVENT_ID,
      // Un ospite non ha identità: nessun messaggio è "suo", niente da editare.
      senderId: null,
      isPerPersonIdentity: false,
    });
  });

  it('rejects a tokenless reader on a password-protected LIVE event', async () => {
    // Più stretto del lato scrittura, di proposito: scrivere inietta un
    // messaggio, leggere esfiltra quelli di tutti gli altri.
    mockedEvent.mockResolvedValue(event({ joinPasswordHash: 'hash' }));
    await expect(authorizeChatRead('evento', null)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mockedJoinGrant).toHaveBeenCalledWith(EVENT_ID);
  });

  it('admits a tokenless reader on a password event once the join grant is held', async () => {
    mockedEvent.mockResolvedValue(event({ joinPasswordHash: 'hash' }));
    mockedJoinGrant.mockResolvedValue(true);
    await expect(authorizeChatRead('evento', null)).resolves.toMatchObject({
      eventId: EVENT_ID,
      senderId: null,
    });
  });

  it('rejects a token that resolves to nothing instead of degrading to guest', async () => {
    // Evento LIVE apposta: se il token sconosciuto scivolasse nel ramo ospite
    // la richiesta passerebbe lo stesso, e un token di un altro evento (o
    // revocato) diventerebbe un lasciapassare silenzioso.
    mockedSender.mockResolvedValue(null);
    await expect(authorizeChatRead('evento', 'TOKEN-DI-UN-ALTRO-EVENTO')).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mockedJoinGrant).not.toHaveBeenCalled();
  });

  it('lets a token holder read a concluded event — the moderator archive', async () => {
    // Il gate non deve chiudere fuori chi ha diritto all'archivio post-evento:
    // è la regressione speculare a quella che stiamo prevenendo.
    mockedEvent.mockResolvedValue(event({ status: 'ARCHIVED' }));
    mockedSender.mockResolvedValue({
      eventId: EVENT_ID,
      senderId: `mod-${EVENT_ID}-g-1`,
      senderName: 'Mara',
      isModerator: true,
      isPerPersonIdentity: true,
    });
    await expect(authorizeChatRead('evento', 'CO_MOD')).resolves.toEqual({
      eventId: EVENT_ID,
      senderId: `mod-${EVENT_ID}-g-1`,
      // Propagato tale e quale: è ciò che decide `canEdit` a valle.
      isPerPersonIdentity: true,
    });
  });

  it('lets a token holder skip the join password entirely', async () => {
    mockedEvent.mockResolvedValue(event({ joinPasswordHash: 'hash' }));
    mockedSender.mockResolvedValue({
      eventId: EVENT_ID,
      senderId: 'reg-42',
      senderName: 'Alice',
      isModerator: false,
      isPerPersonIdentity: true,
    });
    await expect(authorizeChatRead('evento', 'ACCESS_TOKEN')).resolves.toMatchObject({
      senderId: 'reg-42',
    });
    // La password è un gate per chi NON ha credenziali; chi ha il token l'ha
    // già superato altrove.
    expect(mockedJoinGrant).not.toHaveBeenCalled();
  });

  it('never leaks a name: the gate only forwards ids and the identity flag', async () => {
    mockedSender.mockResolvedValue({
      eventId: EVENT_ID,
      senderId: `mod-${EVENT_ID}-primary`,
      senderName: 'Segreteria',
      isModerator: true,
      isPerPersonIdentity: false,
    });
    const access = await authorizeChatRead('evento', 'PRIMARY');
    expect(Object.keys(access).sort()).toEqual([
      'eventId',
      'isPerPersonIdentity',
      'senderId',
    ]);
    // Il posto condiviso del link primario non è una persona: chi lo tiene non
    // può riscrivere i messaggi di un altro che tiene lo stesso link.
    expect(access.isPerPersonIdentity).toBe(false);
  });
});
