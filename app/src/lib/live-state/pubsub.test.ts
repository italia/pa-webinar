import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/redis', async () => {
  // withDeadline vero: l'attesa della connessione e' cio' che si prova.
  const vero = (await vi.importActual('@/lib/redis')) as {
    withDeadline: <T>(op: Promise<T>, ms: number, fallback: T) => Promise<T>;
  };
  return { getRedis: vi.fn(), getRedisSubscriber: vi.fn(), withDeadline: vero.withDeadline };
});

import { getRedis, getRedisSubscriber } from '@/lib/redis';

import {
  publishLiveState,
  subscribeLiveState,
  __resetLiveStateRegistry,
  type LiveEnvelope,
  type LiveStreamEvent,
} from './pubsub';

const getRedisMock = getRedis as unknown as ReturnType<typeof vi.fn>;
const getSubMock = getRedisSubscriber as unknown as ReturnType<typeof vi.fn>;

/** Un finto subscriber ioredis: registra i gestori e permette di emettere. */
function fintoSubscriber(status = 'connecting') {
  const gestori: ((canale: string, payload: string) => void)[] = [];
  const pronti: (() => void)[] = [];
  return {
    status,
    canaliSottoscritti: [] as string[],
    gestori,
    on(evento: string, gestore: (canale: string, payload: string) => void) {
      if (evento === 'message') gestori.push(gestore);
      if (evento === 'ready') pronti.push(gestore as unknown as () => void);
    },
    /** La connessione di ascolto (ri)diventa pronta. */
    pronto() {
      for (const g of pronti) g();
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

  it('con la connessione in apertura aspetta che sia pronta, poi pubblica', async () => {
    // Il client nasce alla prima richiesta: scartare qui perdeva il primo
    // avviso dopo ogni avvio, e chi era in sala non lo riceveva piu'.
    const publish = vi.fn().mockResolvedValue(1);
    let pronto: () => void = () => {};
    const client = {
      status: 'connecting',
      publish,
      once: (_e: string, fn: () => void) => {
        pronto = () => {
          client.status = 'ready';
          fn();
        };
      },
    };
    getRedisMock.mockReturnValue(client);
    const esito = publishLiveState('evt-1', FLAGS);
    expect(publish).not.toHaveBeenCalled();
    pronto();
    await expect(esito).resolves.toBe(1);
    expect(publish).toHaveBeenCalledWith('live:evt-1', JSON.stringify(FLAGS));
  });

  it('se la connessione non arriva in tempo rinuncia invece di accodare', async () => {
    // Il client è configurato per accodare i comandi all'infinito: oltre
    // l'attesa non si pubblica, cosi' nulla resta in coda per sempre.
    vi.useFakeTimers();
    try {
      const publish = vi.fn();
      getRedisMock.mockReturnValue({ status: 'reconnecting', publish, once: () => {} });
      const esito = publishLiveState('evt-1', FLAGS);
      await vi.advanceTimersByTimeAsync(2500);
      await expect(esito).resolves.toBe(0);
      expect(publish).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('pubblica sul canale dell’evento', async () => {
    const publish = vi.fn().mockResolvedValue(3);
    getRedisMock.mockReturnValue({ status: 'ready', publish });
    await expect(publishLiveState('evt-1', FLAGS)).resolves.toBe(3);
    expect(publish).toHaveBeenCalledWith('live:evt-1', JSON.stringify(FLAGS));
  });

  it('molte attese sulla stessa connessione usano un solo ascoltatore', async () => {
    vi.useFakeTimers();
    try {
      const once = vi.fn();
      const client = { status: 'reconnecting', publish: vi.fn(), once };
      getRedisMock.mockReturnValue(client);
      const esiti = Array.from({ length: 15 }, () => publishLiveState('evt-1', FLAGS));
      await vi.advanceTimersByTimeAsync(2500);
      await Promise.all(esiti);
      // Quindici pubblicazioni durante un'interruzione: un ascoltatore, non 15.
      expect(once).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
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
    const ricevuti: LiveStreamEvent[] = [];
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
    const primo: LiveStreamEvent[] = [];
    const secondo: LiveStreamEvent[] = [];
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
    const ricevuti: LiveStreamEvent[] = [];
    await subscribeLiveState('evt-1', (e) => ricevuti.push(e));

    sub.emetti('live:evt-1', 'non è json');
    sub.emetti('live:evt-1', JSON.stringify(FLAGS));

    expect(ricevuti).toEqual([FLAGS]);
  });

  it('un consumatore che esplode non impedisce la consegna agli altri', async () => {
    const sub = fintoSubscriber();
    getSubMock.mockReturnValue(sub);
    const ricevuti: LiveStreamEvent[] = [];
    await subscribeLiveState('evt-1', () => {
      throw new Error('componente smontato');
    });
    await subscribeLiveState('evt-1', (e) => ricevuti.push(e));

    sub.emetti('live:evt-1', JSON.stringify(FLAGS));

    expect(ricevuti).toEqual([FLAGS]);
  });

  it('quando la connessione di ascolto torna, chiede agli stream di riallinearsi', async () => {
    const sub = fintoSubscriber('connecting');
    getSubMock.mockReturnValue(sub);
    const ricevuti: LiveStreamEvent[] = [];
    await subscribeLiveState('evt-1', (e) => ricevuti.push(e));

    sub.pronto(); // prima connessione: niente da recuperare
    expect(ricevuti).toEqual([]);
    sub.pronto(); // riconnessione: quanto pubblicato nel buco è perso
    expect(ricevuti).toEqual([{ op: 'resync' }]);
  });

  it('se la connessione era già pronta, il primo ready è già una riconnessione', async () => {
    const sub = fintoSubscriber('ready');
    getSubMock.mockReturnValue(sub);
    const ricevuti: LiveStreamEvent[] = [];
    await subscribeLiveState('evt-1', (e) => ricevuti.push(e));
    sub.pronto();
    expect(ricevuti).toEqual([{ op: 'resync' }]);
  });

  it('un’iscrizione fallita non lascia il consumatore nel registro', async () => {
    const sub = fintoSubscriber('ready');
    sub.subscribe.mockRejectedValueOnce(new Error('connessione persa'));
    getSubMock.mockReturnValue(sub);
    const ricevuti: LiveStreamEvent[] = [];
    await expect(subscribeLiveState('evt-1', (e) => ricevuti.push(e))).rejects.toThrow();
    sub.emetti('live:evt-1', JSON.stringify(FLAGS));
    sub.pronto();
    expect(ricevuti).toEqual([]);
  });
});
