import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/redis', () => ({
  getRedis: vi.fn(),
  getRedisSubscriber: vi.fn(),
}));

import { getRedis, getRedisSubscriber } from '@/lib/redis';

import {
  publishLiveState,
  subscribeLiveState,
  __resetLiveStateRegistry,
  type LiveEnvelope,
} from './pubsub';

const getRedisMock = getRedis as unknown as ReturnType<typeof vi.fn>;
const getSubMock = getRedisSubscriber as unknown as ReturnType<typeof vi.fn>;

/** Un finto subscriber ioredis: registra i gestori e permette di emettere. */
function fintoSubscriber() {
  const gestori: ((canale: string, payload: string) => void)[] = [];
  return {
    canaliSottoscritti: [] as string[],
    gestori,
    on(evento: string, gestore: (canale: string, payload: string) => void) {
      if (evento === 'message') gestori.push(gestore);
    },
    subscribe: vi.fn(async function (this: { canaliSottoscritti: string[] }, ch: string) {
      this.canaliSottoscritti.push(ch);
    }),
    emetti(canale: string, payload: string) {
      for (const g of gestori) g(canale, payload);
    },
  };
}

const FLAGS: LiveEnvelope = {
  op: 'flags',
  flags: {
    qaEnabled: true,
    chatEnabled: true,
    agendaEnabled: true,
    wordCloudEnabled: false,
    recordingEnabled: false,
  },
  ts: '2026-07-27T10:00:00.000Z',
};

describe('publishLiveState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetLiveStateRegistry();
  });

  it('senza Redis non pubblica e non solleva: i pannelli restano sul polling', async () => {
    getRedisMock.mockReturnValue(null);
    await expect(publishLiveState('evt-1', FLAGS)).resolves.toBe(0);
  });

  it('con la connessione non ancora pronta rinuncia invece di accodare', async () => {
    // Il client è configurato per accodare i comandi all'infinito: aspettare qui
    // significherebbe far attendere la mutazione che ha generato l'evento.
    const publish = vi.fn();
    getRedisMock.mockReturnValue({ status: 'connecting', publish });
    await expect(publishLiveState('evt-1', FLAGS)).resolves.toBe(0);
    expect(publish).not.toHaveBeenCalled();
  });

  it('pubblica sul canale dell’evento', async () => {
    const publish = vi.fn().mockResolvedValue(3);
    getRedisMock.mockReturnValue({ status: 'ready', publish });
    await expect(publishLiveState('evt-1', FLAGS)).resolves.toBe(3);
    expect(publish).toHaveBeenCalledWith('live:evt-1', JSON.stringify(FLAGS));
  });

  it('un errore di Redis non risale a chi ha fatto la mutazione', async () => {
    const publish = vi.fn().mockRejectedValue(new Error('connessione persa'));
    getRedisMock.mockReturnValue({ status: 'ready', publish });
    await expect(publishLiveState('evt-1', FLAGS)).resolves.toBe(0);
  });
});

describe('subscribeLiveState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetLiveStateRegistry();
  });

  it('senza Redis restituisce un distacco innocuo', async () => {
    getSubMock.mockReturnValue(null);
    const detach = await subscribeLiveState('evt-1', () => {});
    expect(() => detach()).not.toThrow();
  });

  it('consegna solo i messaggi del proprio evento', async () => {
    const sub = fintoSubscriber();
    getSubMock.mockReturnValue(sub);
    const ricevuti: LiveEnvelope[] = [];
    await subscribeLiveState('evt-1', (e) => ricevuti.push(e));

    sub.emetti('live:evt-2', JSON.stringify(FLAGS));
    sub.emetti('chat:evt-1', JSON.stringify(FLAGS));
    sub.emetti('live:evt-1', JSON.stringify(FLAGS));

    expect(ricevuti).toEqual([FLAGS]);
  });

  it('registra UN solo ascoltatore anche con molte connessioni', async () => {
    // È la ragione per cui questo modulo tiene un registro: lo stream lo apre
    // ogni partecipante, e un gestore per connessione farebbe eseguire N
    // funzioni per messaggio (oltre a far gridare Node alla perdita di memoria).
    const sub = fintoSubscriber();
    getSubMock.mockReturnValue(sub);
    for (let i = 0; i < 25; i++) await subscribeLiveState('evt-1', () => {});
    expect(sub.gestori).toHaveLength(1);
  });

  it('il distacco toglie solo il proprio consumatore', async () => {
    const sub = fintoSubscriber();
    getSubMock.mockReturnValue(sub);
    const primo: LiveEnvelope[] = [];
    const secondo: LiveEnvelope[] = [];
    const staccaPrimo = await subscribeLiveState('evt-1', (e) => primo.push(e));
    await subscribeLiveState('evt-1', (e) => secondo.push(e));

    staccaPrimo();
    sub.emetti('live:evt-1', JSON.stringify(FLAGS));

    expect(primo).toEqual([]);
    expect(secondo).toEqual([FLAGS]);
  });

  it('un payload malformato non interrompe la consegna successiva', async () => {
    const sub = fintoSubscriber();
    getSubMock.mockReturnValue(sub);
    const ricevuti: LiveEnvelope[] = [];
    await subscribeLiveState('evt-1', (e) => ricevuti.push(e));

    sub.emetti('live:evt-1', 'non è json');
    sub.emetti('live:evt-1', JSON.stringify(FLAGS));

    expect(ricevuti).toEqual([FLAGS]);
  });

  it('un consumatore che esplode non impedisce la consegna agli altri', async () => {
    const sub = fintoSubscriber();
    getSubMock.mockReturnValue(sub);
    const ricevuti: LiveEnvelope[] = [];
    await subscribeLiveState('evt-1', () => {
      throw new Error('componente smontato');
    });
    await subscribeLiveState('evt-1', (e) => ricevuti.push(e));

    sub.emetti('live:evt-1', JSON.stringify(FLAGS));

    expect(ricevuti).toEqual([FLAGS]);
  });
});
