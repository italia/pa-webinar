/**
 * Il timer del moderatore: cosa finisce nella cronologia della sala, e lo
 * stato condiviso fra le istanze dell'app. Lo stato del conto alla rovescia
 * vive in Redis (finto, qui) e, senza Redis, nella memoria del processo
 * (vera); il resto si stubba.
 */
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: { event: { findUnique: vi.fn() } },
}));
vi.mock('@/lib/auth/moderator', () => ({
  extractModeratorToken: (req: Request) =>
    req.headers.get('authorization')?.replace(/^Bearer\s+/, '') || null,
  isEventModerator: vi.fn(async (_e: unknown, token: string) => token === 'MOD'),
}));
vi.mock('@/lib/live/actions', () => ({ recordLiveAction: vi.fn(), recordLiveActions: vi.fn() }));

/** Un Redis finto per GET e SET: quello che ogni istanza dell'app vede. */
const { redisFinto } = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    redisFinto: {
      status: 'ready',
      store,
      get: async (key: string) => store.get(key) ?? null,
      set: async (key: string, value: string) => {
        store.set(key, value);
        return 'OK';
      },
    },
  };
});
let redisPresente = false;
vi.mock('@/lib/redis', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getRedis: () => (redisPresente ? redisFinto : null) };
});

import { deleteCache } from '@/lib/cache';
import { prisma } from '@/lib/db';
import { recordLiveAction } from '@/lib/live/actions';

import { GET, POST } from './route';

const EVENT_ID = '55555555-5555-4555-8555-555555555555';
const SLUG = 'evento-di-prova';

const mockedEvent = prisma.event.findUnique as unknown as ReturnType<typeof vi.fn>;
const ctx = () => ({ params: Promise.resolve({ param: SLUG }) });
let ipSeq = 0;
const post = (body: unknown, token = 'MOD') =>
  new Request(`https://webinar.gov.it/api/events/${SLUG}/timer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      // Un indirizzo per richiesta: il tetto per IP non e' l'oggetto di questi test.
      'x-forwarded-for': `192.0.2.${++ipSeq % 250}`,
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

/** Dimentica la memoria di questo processo: come rispondesse un'altra istanza. */
const altraIstanza = () => deleteCache(`timer:${EVENT_ID}`);

beforeEach(() => {
  vi.clearAllMocks();
  redisPresente = false;
  redisFinto.store.clear();
  altraIstanza();
  mockedEvent.mockResolvedValue({ id: EVENT_ID });
});

describe('POST /api/events/[slug]/timer — cronologia', () => {
  it('avviare registra la durata in secondi', async () => {
    const res = await POST(post({ action: 'start', duration: 120 }), ctx());
    expect(res.status).toBe(200);
    expect(recordLiveAction).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      kind: 'timer.started',
      actor: 'moderator',
      data: { durationSec: 120 },
    });
  });

  it('fermare un timer che corre registra lo stop, una volta sola', async () => {
    await POST(post({ action: 'start', duration: 120 }), ctx());
    vi.mocked(recordLiveAction).mockClear();

    await POST(post({ action: 'pause' }), ctx());
    expect(recordLiveAction).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      kind: 'timer.stopped',
      actor: 'moderator',
    });

    // Gia' in pausa: azzerarlo non ferma niente di nuovo.
    vi.mocked(recordLiveAction).mockClear();
    await POST(post({ action: 'reset' }), ctx());
    expect(recordLiveAction).not.toHaveBeenCalled();
  });

  it('azzerare un timer che corre registra lo stop', async () => {
    await POST(post({ action: 'start', duration: 60 }), ctx());
    vi.mocked(recordLiveAction).mockClear();
    await POST(post({ action: 'reset' }), ctx());
    expect(recordLiveAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'timer.stopped' }),
    );
  });

  it('azzerare un timer mai partito, o cambiarne la visibilita’, non registra niente', async () => {
    await POST(post({ action: 'reset' }), ctx());
    await POST(post({ action: 'visibility', visible: false }), ctx());
    expect(recordLiveAction).not.toHaveBeenCalled();
  });

  it('riprendere dalla pausa tiene la durata impostata e registra la ripresa', async () => {
    await POST(post({ action: 'start', duration: 600 }), ctx());
    await POST(post({ action: 'pause' }), ctx());
    vi.mocked(recordLiveAction).mockClear();

    const res = await POST(post({ action: 'resume' }), ctx());
    const body = await res.json();
    expect(body.duration).toBe(600);
    expect(body.paused).toBe(false);
    expect(recordLiveAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'timer.started', data: { durationSec: 600, resumed: true } }),
    );

    // Già in corso: riprendere di nuovo non fa niente.
    vi.mocked(recordLiveAction).mockClear();
    await POST(post({ action: 'resume' }), ctx());
    expect(recordLiveAction).not.toHaveBeenCalled();
  });

  it('allo zero resta acceso per mostrare «Tempo scaduto», poi si spegne', async () => {
    vi.useFakeTimers();
    try {
      await POST(post({ action: 'start', duration: 10 }), ctx());
      vi.advanceTimersByTime(12_000);
      let body = await (await GET(post({}), ctx())).json();
      expect(body).toMatchObject({ active: true, remaining: 0 });
      expect(typeof body.serverNow).toBe('string');

      vi.advanceTimersByTime(30_000);
      body = await (await GET(post({}), ctx())).json();
      expect(body.active).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('senza moderazione: niente', async () => {
    const res = await POST(post({ action: 'start', duration: 60 }, 'ALTRO'), ctx());
    expect(res.status).toBe(403);
    expect(recordLiveAction).not.toHaveBeenCalled();
  });
});

describe('/api/events/[slug]/timer — più istanze dell’app', () => {
  beforeEach(() => {
    redisPresente = true;
  });

  it('avviato su un’istanza, si legge acceso da un’altra', async () => {
    await POST(post({ action: 'start', duration: 120 }), ctx());
    altraIstanza();
    const body = await (await GET(post({}), ctx())).json();
    expect(body).toMatchObject({ active: true, duration: 120, visible: true, paused: false });
    expect(body.remaining).toBeGreaterThan(115);
  });

  it('messo in pausa da un’istanza e ripreso da un’altra: la durata resta, e la ripresa finisce in cronologia', async () => {
    await POST(post({ action: 'start', duration: 600 }), ctx());
    altraIstanza();
    await POST(post({ action: 'pause' }), ctx());
    altraIstanza();
    let body = await (await GET(post({}), ctx())).json();
    expect(body).toMatchObject({ active: true, paused: true, duration: 600 });

    altraIstanza();
    vi.mocked(recordLiveAction).mockClear();
    body = await (await POST(post({ action: 'resume' }), ctx())).json();
    expect(body).toMatchObject({ active: true, paused: false, duration: 600 });
    expect(recordLiveAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'timer.started', data: { durationSec: 600, resumed: true } }),
    );
  });

  it('azzerato da un’istanza, nessuna lo vede più correre', async () => {
    await POST(post({ action: 'start', duration: 300 }), ctx());
    // Questa istanza ha letto il timer acceso...
    expect((await (await GET(post({}), ctx())).json()).active).toBe(true);
    // ...un'altra lo azzera: la prima lo rilegge spento, non dalla sua memoria.
    await altraIstanzaCheAzzera();
    const body = await (await GET(post({}), ctx())).json();
    expect(body).toMatchObject({ active: false, remaining: 300 });
  });

  it('la lettura non riscrive lo stato: lo scaduto si spegne senza toccare Redis', async () => {
    vi.useFakeTimers();
    try {
      await POST(post({ action: 'start', duration: 10 }), ctx());
      const scritto = redisFinto.store.get(`live:timer:${EVENT_ID}`);
      vi.advanceTimersByTime(45_000);
      const body = await (await GET(post({}), ctx())).json();
      expect(body.active).toBe(false);
      expect(redisFinto.store.get(`live:timer:${EVENT_ID}`)).toBe(scritto);
    } finally {
      vi.useRealTimers();
    }
  });
});

/** Un azzeramento arrivato a un'altra istanza: scrive solo in Redis. */
async function altraIstanzaCheAzzera(): Promise<void> {
  const prima = redisFinto.store.get(`live:timer:${EVENT_ID}`);
  const stato = JSON.parse(prima!) as Record<string, unknown>;
  redisFinto.store.set(
    `live:timer:${EVENT_ID}`,
    JSON.stringify({ ...stato, active: false, remaining: stato.duration, startedAt: null, pausedAt: null }),
  );
}
