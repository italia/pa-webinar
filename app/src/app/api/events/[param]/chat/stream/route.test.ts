import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Stream della chat: i messaggi arrivano come `event: message`, l'indicatore
 * «sta scrivendo» come `event: typing` senza `id:`. La distinzione è un
 * contratto con i client della versione precedente, che aggiungono alla lista
 * ogni `message` ricevuto: un avviso di digitazione con quel nome diventerebbe
 * una bolla vuota.
 */

type ChatHandler = (envelope: Record<string, unknown>) => void;
type TypingHandler = (payload: { senderKey: string; senderName: string }) => void;

const stato = vi.hoisted(() => ({
  chat: null as ChatHandler | null,
  typing: null as TypingHandler | null,
  staccaChat: vi.fn(),
  staccaTyping: vi.fn(),
}));

vi.mock('@/lib/chat/read-access', () => ({
  authorizeChatRead: vi.fn(async () => ({
    eventId: 'ev-1',
    senderId: null,
    isPerPersonIdentity: false,
  })),
}));
vi.mock('@/lib/chat/pubsub', () => ({
  subscribeChat: vi.fn(async (_id: string, onMessage: ChatHandler) => {
    stato.chat = onMessage;
    return stato.staccaChat;
  }),
}));
vi.mock('@/lib/chat/typing-pubsub', () => ({
  subscribeTyping: vi.fn(async (_id: string, onTyping: TypingHandler) => {
    stato.typing = onTyping;
    return stato.staccaTyping;
  }),
}));

import { ForbiddenError } from '@/lib/errors';
import { authorizeChatRead } from '@/lib/chat/read-access';
import { subscribeChat } from '@/lib/chat/pubsub';
import { subscribeTyping } from '@/lib/chat/typing-pubsub';

import { GET } from './route';

const ctx = () => ({ params: Promise.resolve({ param: 'evento' }) });

function apri(ctrl: AbortController): Promise<Response> {
  return GET(new Request('http://x/api/events/evento/chat/stream', { signal: ctrl.signal }), ctx());
}

/** Legge dallo stream finché non ha `quanti` blocchi SSE che non sono commenti. */
async function blocchi(res: Response, quanti: number): Promise<string[]> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let testo = '';
  const out: string[] = [];
  while (out.length < quanti) {
    const { value, done } = await reader.read();
    if (done) break;
    testo += dec.decode(value);
    const parti = testo.split('\n\n');
    testo = parti.pop() ?? '';
    for (const p of parti) if (!p.startsWith(':')) out.push(p);
  }
  await reader.cancel();
  return out;
}

beforeEach(() => {
  stato.chat = null;
  stato.typing = null;
});
afterEach(() => vi.clearAllMocks());

describe('GET /api/events/[param]/chat/stream', () => {
  it('consegna i messaggi come `message` e l’indicatore come `typing` senza id', async () => {
    const ctrl = new AbortController();
    const res = await apri(ctrl);
    const letti = blocchi(res, 2);
    await vi.waitFor(() => expect(stato.chat && stato.typing).toBeTruthy());

    stato.typing!({ senderKey: '0123456789abcdef', senderName: 'Anna' });
    stato.chat!({ id: 'm-1', senderKey: 'k', senderName: 'Bruno', text: 'ciao' });

    const [typing, message] = await letti;
    ctrl.abort();

    expect(typing).toBe(
      'event: typing\ndata: {"senderKey":"0123456789abcdef","senderName":"Anna"}',
    );
    // Senza `id:` l'avviso non sposta il punto di ripresa dei messaggi.
    expect(typing).not.toMatch(/^id:/m);
    expect(message!.split('\n').slice(0, 2)).toEqual(['id: m-1', 'event: message']);
  });

  it('ascolta l’indicatore sul suo canale, accanto alla chat', async () => {
    const ctrl = new AbortController();
    await apri(ctrl);
    await vi.waitFor(() => expect(subscribeTyping).toHaveBeenCalledWith('ev-1', expect.any(Function)));
    expect(subscribeChat).toHaveBeenCalledWith('ev-1', expect.any(Function));
    ctrl.abort();
  });

  it('alla chiusura stacca entrambe le iscrizioni, una volta sola', async () => {
    const ctrl = new AbortController();
    const res = await apri(ctrl);
    await vi.waitFor(() => expect(stato.chat && stato.typing).toBeTruthy());
    ctrl.abort();
    await res.body!.cancel();
    expect(stato.staccaChat).toHaveBeenCalledTimes(1);
    expect(stato.staccaTyping).toHaveBeenCalledTimes(1);
  });

  it('un client andato via mentre ci si iscriveva non lascia iscrizioni appese', async () => {
    let completaChat: () => void = () => {};
    let completaTyping: () => void = () => {};
    vi.mocked(subscribeChat).mockImplementationOnce(
      () => new Promise((r) => { completaChat = () => r(stato.staccaChat); }),
    );
    vi.mocked(subscribeTyping).mockImplementationOnce(
      () => new Promise((r) => { completaTyping = () => r(stato.staccaTyping); }),
    );
    const ctrl = new AbortController();
    await apri(ctrl);
    ctrl.abort();
    completaTyping();
    completaChat();
    await vi.waitFor(() => {
      expect(stato.staccaChat).toHaveBeenCalledTimes(1);
      expect(stato.staccaTyping).toHaveBeenCalledTimes(1);
    });
  });

  it('un’iscrizione all’indicatore che non arriva non trattiene la chat', async () => {
    vi.mocked(subscribeTyping).mockImplementationOnce(() => new Promise(() => {}));
    const ctrl = new AbortController();
    const res = await apri(ctrl);
    const letti = blocchi(res, 1);
    await vi.waitFor(() => expect(stato.chat).toBeTruthy());
    stato.chat!({ id: 'm-2', senderKey: 'k', senderName: 'Bruno', text: 'ciao' });
    const [message] = await letti;
    ctrl.abort();
    expect(message).toContain('event: message');
  });

  it('senza diritto di lettura non apre lo stream e non si iscrive', async () => {
    vi.mocked(authorizeChatRead).mockRejectedValueOnce(new ForbiddenError('no'));
    const res = await apri(new AbortController());
    expect(res.status).toBe(403);
    expect(subscribeChat).not.toHaveBeenCalled();
    expect(subscribeTyping).not.toHaveBeenCalled();
  });
});
