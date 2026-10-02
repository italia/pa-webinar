import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Apertura del canale live: l'istantanea dei flag si legge dopo l'iscrizione,
 * e un avviso pubblicato mentre la si legge non va perso ne' viene coperto da
 * uno stato piu' vecchio.
 */

type Handler = (env: unknown) => void;
let handler: Handler | null = null;

vi.mock('@/lib/redis', async () => {
  // withDeadline vero: e' la scadenza dell'iscrizione che si mette alla prova.
  const vero = (await vi.importActual('@/lib/redis')) as {
    withDeadline: <T>(op: Promise<T>, ms: number, fallback: T) => Promise<T>;
  };
  return { getRedis: () => ({ status: 'ready' }), withDeadline: vero.withDeadline };
});
vi.mock('@/lib/live-state/pubsub', () => ({
  LIVE_FLAG_FIELDS: ['qaEnabled', 'chatEnabled', 'agendaEnabled', 'wordCloudEnabled', 'recordingEnabled'],
  POKEABLE_PANELS: ['qa', 'polls', 'agenda', 'wordcloud', 'materials'],
  liveRedisReady: vi.fn(async () => true),
  subscribeLiveState: vi.fn(async (_id: string, onMessage: Handler) => {
    handler = onMessage;
    return () => {
      handler = null;
    };
  }),
}));
vi.mock('@/lib/db', () => ({
  prisma: { event: { findFirst: vi.fn(), findUnique: vi.fn() } },
}));

import { prisma } from '@/lib/db';
import { subscribeLiveState } from '@/lib/live-state/pubsub';

import { GET } from './route';

const db = prisma as unknown as {
  event: { findFirst: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
};

const FLAG_SPENTI = {
  qaEnabled: false,
  chatEnabled: true,
  agendaEnabled: false,
  wordCloudEnabled: false,
  recordingEnabled: false,
};

beforeEach(() => {
  handler = null;
  db.event.findFirst.mockResolvedValue({
    id: 'ev-1',
    status: 'LIVE',
    eventType: 'WEBINAR',
    endsAt: new Date(Date.now() + 3600_000),
    postEventPublic: false,
    postEventPublicUntil: null,
    ...FLAG_SPENTI,
  });
});
afterEach(() => vi.clearAllMocks());

async function leggi(
  res: Response,
  quanti: number,
): Promise<Array<{ op: string; flags?: { qaEnabled: boolean }; panel?: string }>> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let testo = '';
  const out: Array<{ op: string; flags?: { qaEnabled: boolean }; panel?: string }> = [];
  while (out.length < quanti) {
    const { value, done } = await reader.read();
    if (done) break;
    testo += dec.decode(value);
    const parti = testo.split('\n\n');
    testo = parti.pop() ?? '';
    for (const p of parti) {
      const riga = p.split('\n').find((l) => l.startsWith('data: '));
      if (riga) out.push(JSON.parse(riga.slice(6)));
    }
  }
  await reader.cancel();
  return out;
}

describe('GET /api/events/[param]/live/stream', () => {
  it('l’istantanea si legge a iscrizione fatta: un cambio arrivato nel mezzo vince', async () => {
    let rilascia: (v: unknown) => void = () => {};
    db.event.findUnique.mockImplementation(
      () =>
        new Promise((r) => {
          rilascia = r;
        }),
    );
    const ctrl = new AbortController();
    const res = await GET(new Request('http://x/api/events/e/live/stream', { signal: ctrl.signal }), {
      params: Promise.resolve({ param: 'evento' }),
    });
    const letti = leggi(res, 4);
    // Iscritti: mentre si legge l'istantanea un moderatore accende il Q&A.
    await vi.waitFor(() => expect(db.event.findUnique).toHaveBeenCalled());
    handler!({ op: 'flags', flags: { ...FLAG_SPENTI, qaEnabled: true }, ts: 'dopo' });
    // La lettura (iniziata prima del cambio) restituisce lo stato vecchio.
    rilascia({ status: 'LIVE', ...FLAG_SPENTI });

    const msgs = await letti;
    ctrl.abort();
    expect(msgs.map((m) => m.op)).toEqual(['hello', 'flags', 'eventStatus', 'flags']);
    // L'ultimo flag che arriva al client e' quello acceso.
    expect(msgs[3]!.flags!.qaEnabled).toBe(true);
  });

  it('un cambio fatto mentre ci si iscrive arriva comunque: l’istantanea è letta dopo', async () => {
    // L'iscrizione richiede un giro; intanto il moderatore accende il Q&A: il
    // database e' gia' aggiornato e l'avviso e' partito quando nessuno era
    // ancora in ascolto.
    vi.mocked(subscribeLiveState).mockImplementationOnce(async (_id, onMessage) => {
      await new Promise((r) => setTimeout(r, 5));
      handler = onMessage as Handler;
      return () => {
        handler = null;
      };
    });
    db.event.findUnique.mockResolvedValue({ status: 'LIVE', ...FLAG_SPENTI, qaEnabled: true });
    const ctrl = new AbortController();
    const res = await GET(new Request('http://x/api/events/e/live/stream', { signal: ctrl.signal }), {
      params: Promise.resolve({ param: 'evento' }),
    });
    const msgs = await leggi(res, 3);
    ctrl.abort();
    const flags = msgs.filter((m) => m.op === 'flags');
    expect(flags.at(-1)!.flags!.qaEnabled).toBe(true);
  });

  it('con l’iscrizione bloccata, lo stato arriva comunque entro il limite', async () => {
    vi.mocked(subscribeLiveState).mockImplementationOnce(() => new Promise(() => {}));
    db.event.findUnique.mockResolvedValue({ status: 'LIVE', ...FLAG_SPENTI });
    const ctrl = new AbortController();
    const res = await GET(new Request('http://x/api/events/e/live/stream', { signal: ctrl.signal }), {
      params: Promise.resolve({ param: 'evento' }),
    });
    const msgs = await leggi(res, 4);
    ctrl.abort();
    // Il push non c'e' ancora: lo si dice, e lo stato arriva lo stesso.
    expect(msgs.map((m) => m.op)).toEqual(['hello', 'hello', 'flags', 'eventStatus']);
    expect((msgs[1] as unknown as { pushAvailable: boolean }).pushAvailable).toBe(false);
  }, 10_000);

  it('un’iscrizione arrivata oltre il limite riaccende il push', async () => {
    let completa: (fn: () => void) => void = () => {};
    vi.mocked(subscribeLiveState).mockImplementationOnce(
      (_id, onMessage) =>
        new Promise((r) => {
          completa = (fn) => {
            handler = onMessage as Handler;
            r(fn);
          };
        }),
    );
    db.event.findUnique.mockResolvedValue({ status: 'LIVE', ...FLAG_SPENTI });
    const ctrl = new AbortController();
    const res = await GET(new Request('http://x/api/events/e/live/stream', { signal: ctrl.signal }), {
      params: Promise.resolve({ param: 'evento' }),
    });
    const letti = leggi(res, 5);
    await new Promise((r) => setTimeout(r, 3300));
    completa(() => {});
    const msgs = await letti;
    ctrl.abort();
    expect(msgs.map((m) => m.op)).toEqual(['hello', 'hello', 'flags', 'eventStatus', 'hello']);
    expect((msgs[4] as unknown as { pushAvailable: boolean }).pushAvailable).toBe(true);
  }, 10_000);

  it('anche il riallineamento mette da parte gli avvisi arrivati durante la lettura', async () => {
    db.event.findUnique.mockResolvedValueOnce({ status: 'LIVE', ...FLAG_SPENTI });
    const ctrl = new AbortController();
    const res = await GET(new Request('http://x/api/events/e/live/stream', { signal: ctrl.signal }), {
      params: Promise.resolve({ param: 'evento' }),
    });
    const letti = leggi(res, 3 + 2 + 5 + 1);
    await vi.waitFor(() => expect(handler).not.toBeNull());
    await new Promise((r) => setTimeout(r, 20));
    let rilascia: (v: unknown) => void = () => {};
    db.event.findUnique.mockImplementationOnce(() => new Promise((r) => { rilascia = r; }));
    handler!({ op: 'resync' });
    // Durante la lettura del riallineamento il moderatore accende il Q&A.
    handler!({ op: 'flags', flags: { ...FLAG_SPENTI, qaEnabled: true }, ts: 'dopo' });
    await vi.waitFor(() => expect(db.event.findUnique).toHaveBeenCalledTimes(2));
    rilascia({ status: 'LIVE', ...FLAG_SPENTI });
    const msgs = await letti;
    ctrl.abort();
    const flags = msgs.filter((m) => m.op === 'flags');
    expect(flags.at(-1)!.flags!.qaEnabled).toBe(true);
  });

  it('alla riconnessione di Redis rimanda lo stato e fa rileggere ogni pannello', async () => {
    db.event.findUnique.mockResolvedValue({ status: 'LIVE', ...FLAG_SPENTI });
    const ctrl = new AbortController();
    const res = await GET(new Request('http://x/api/events/e/live/stream', { signal: ctrl.signal }), {
      params: Promise.resolve({ param: 'evento' }),
    });
    const letti = leggi(res, 3 + 2 + 5);
    await vi.waitFor(() => expect(handler).not.toBeNull());
    // Dopo l'istantanea: la connessione di ascolto e' tornata.
    await new Promise((r) => setTimeout(r, 20));
    handler!({ op: 'resync' });
    const msgs = await letti;
    ctrl.abort();
    expect(msgs.slice(3).map((m) => m.op)).toEqual(['flags', 'eventStatus', 'poke', 'poke', 'poke', 'poke', 'poke']);
    expect(msgs.slice(5).map((m) => m.panel)).toEqual(['qa', 'polls', 'agenda', 'wordcloud', 'materials']);
  });

  it('un client andato via durante la lettura non lascia il battito acceso', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    let rilascia: (v: unknown) => void = () => {};
    db.event.findUnique.mockImplementation(() => new Promise((r) => { rilascia = r; }));
    const ctrl = new AbortController();
    await GET(new Request('http://x/api/events/e/live/stream', { signal: ctrl.signal }), {
      params: Promise.resolve({ param: 'evento' }),
    });
    // Il client se ne va mentre lo stream sta leggendo lo stato.
    await vi.waitFor(() => expect(db.event.findUnique).toHaveBeenCalled());
    ctrl.abort();
    rilascia({ status: 'LIVE', ...FLAG_SPENTI });
    await new Promise((r) => setTimeout(r, 20));
    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });
});
