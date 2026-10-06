import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/redis', () => ({ getRedis: vi.fn(), getRedisSubscriber: vi.fn() }));

import { getRedis, getRedisSubscriber } from '@/lib/redis';

import type { TypingPayload } from './typing';
import { __resetTypingRegistry, publishTyping, subscribeTyping } from './typing-pubsub';

const getRedisMock = getRedis as unknown as ReturnType<typeof vi.fn>;
const getSubMock = getRedisSubscriber as unknown as ReturnType<typeof vi.fn>;

/** Un finto subscriber ioredis: registra i gestori e permette di emettere. */
function fintoSubscriber() {
  const gestori: ((canale: string, payload: string) => void)[] = [];
  return {
    status: 'ready',
    gestori,
    on(evento: string, gestore: (canale: string, payload: string) => void) {
      if (evento === 'message') gestori.push(gestore);
    },
    subscribe: vi.fn(async (_ch: string) => 1),
    unsubscribe: vi.fn(async (_ch: string) => 0),
    emetti(canale: string, payload: string) {
      for (const g of gestori) g(canale, payload);
    },
  };
}

const ANNA: TypingPayload = { senderKey: '0123456789abcdef', senderName: 'Anna' };

beforeEach(() => {
  vi.clearAllMocks();
  __resetTypingRegistry();
});

describe('publishTyping', () => {
  it('pubblica sul canale separato, mai su quello dei messaggi', async () => {
    // Gli stream della versione precedente rimandano come `message` tutto ciò
    // che passa su `chat:<id>`: un avviso lì diventerebbe una bolla vuota.
    const publish = vi.fn().mockResolvedValue(2);
    getRedisMock.mockReturnValue({ status: 'ready', publish });
    await expect(publishTyping({ eventId: 'evt-1', ...ANNA })).resolves.toBe(2);
    expect(publish).toHaveBeenCalledTimes(1);
    const [canale, payload] = publish.mock.calls[0]!;
    expect(canale).toBe('chat-typing:evt-1');
    expect(canale).not.toMatch(/^chat:/);
    expect(JSON.parse(payload as string)).toEqual(ANNA);
  });

  it('senza Redis non pubblica e non solleva', async () => {
    getRedisMock.mockReturnValue(null);
    await expect(publishTyping({ eventId: 'evt-1', ...ANNA })).resolves.toBe(0);
  });

  it('con la connessione non pronta rinuncia invece di accodare', async () => {
    const publish = vi.fn();
    getRedisMock.mockReturnValue({ status: 'reconnecting', publish });
    await expect(publishTyping({ eventId: 'evt-1', ...ANNA })).resolves.toBe(0);
    expect(publish).not.toHaveBeenCalled();
  });

  it('un errore di Redis non risale alla rotta', async () => {
    const publish = vi.fn().mockRejectedValue(new Error('connessione persa'));
    getRedisMock.mockReturnValue({ status: 'ready', publish });
    await expect(publishTyping({ eventId: 'evt-1', ...ANNA })).resolves.toBe(0);
  });
});

describe('subscribeTyping', () => {
  it('senza Redis restituisce un distacco innocuo', async () => {
    getSubMock.mockReturnValue(null);
    const stacca = await subscribeTyping('evt-1', () => {});
    expect(() => stacca()).not.toThrow();
  });

  it('consegna solo gli avvisi del proprio evento, e nessun messaggio di chat', async () => {
    const sub = fintoSubscriber();
    getSubMock.mockReturnValue(sub);
    const ricevuti: TypingPayload[] = [];
    await subscribeTyping('evt-1', (p) => ricevuti.push(p));

    expect(sub.subscribe).toHaveBeenCalledWith('chat-typing:evt-1');
    sub.emetti('chat-typing:evt-2', JSON.stringify(ANNA));
    sub.emetti('chat:evt-1', JSON.stringify(ANNA));
    sub.emetti('chat-typing:evt-1', JSON.stringify(ANNA));

    expect(ricevuti).toEqual([ANNA]);
  });

  it('scarta i payload malformati e toglie i campi sconosciuti', async () => {
    const sub = fintoSubscriber();
    getSubMock.mockReturnValue(sub);
    const ricevuti: TypingPayload[] = [];
    await subscribeTyping('evt-1', (p) => ricevuti.push(p));

    sub.emetti('chat-typing:evt-1', 'non è json');
    sub.emetti('chat-typing:evt-1', JSON.stringify({ senderKey: 'k' }));
    // Un id grezzo pubblicato da chissà chi non deve arrivare al lettore.
    sub.emetti('chat-typing:evt-1', JSON.stringify({ ...ANNA, senderId: 'guest-abc' }));

    expect(ricevuti).toEqual([ANNA]);
  });

  it('registra UN solo ascoltatore anche con molte connessioni', async () => {
    const sub = fintoSubscriber();
    getSubMock.mockReturnValue(sub);
    for (let i = 0; i < 25; i++) await subscribeTyping('evt-1', () => {});
    expect(sub.gestori).toHaveLength(1);
  });

  it('il distacco toglie solo il proprio consumatore; l’ultimo lascia il canale', async () => {
    const sub = fintoSubscriber();
    getSubMock.mockReturnValue(sub);
    const primo: TypingPayload[] = [];
    const secondo: TypingPayload[] = [];
    const staccaPrimo = await subscribeTyping('evt-1', (p) => primo.push(p));
    const staccaSecondo = await subscribeTyping('evt-1', (p) => secondo.push(p));

    staccaPrimo();
    staccaPrimo(); // due volte: innocuo
    sub.emetti('chat-typing:evt-1', JSON.stringify(ANNA));
    expect(primo).toEqual([]);
    expect(secondo).toEqual([ANNA]);
    expect(sub.unsubscribe).not.toHaveBeenCalled();

    staccaSecondo();
    expect(sub.unsubscribe).toHaveBeenCalledWith('chat-typing:evt-1');
    sub.emetti('chat-typing:evt-1', JSON.stringify(ANNA));
    expect(secondo).toEqual([ANNA]);
  });

  it('un consumatore che esplode non impedisce la consegna agli altri', async () => {
    const sub = fintoSubscriber();
    getSubMock.mockReturnValue(sub);
    const ricevuti: TypingPayload[] = [];
    await subscribeTyping('evt-1', () => {
      throw new Error('stream chiuso');
    });
    await subscribeTyping('evt-1', (p) => ricevuti.push(p));
    sub.emetti('chat-typing:evt-1', JSON.stringify(ANNA));
    expect(ricevuti).toEqual([ANNA]);
  });

  it('un’iscrizione fallita non solleva e non lascia il consumatore nel registro', async () => {
    const sub = fintoSubscriber();
    sub.subscribe.mockRejectedValueOnce(new Error('connessione persa'));
    getSubMock.mockReturnValue(sub);
    const ricevuti: TypingPayload[] = [];
    const stacca = await subscribeTyping('evt-1', (p) => ricevuti.push(p));
    expect(() => stacca()).not.toThrow();
    sub.emetti('chat-typing:evt-1', JSON.stringify(ANNA));
    expect(ricevuti).toEqual([]);
  });
});
