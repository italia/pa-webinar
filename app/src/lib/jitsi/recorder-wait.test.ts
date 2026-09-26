// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as RedisModule from '@/lib/redis';

/**
 * Un Redis finto, quanto basta per EXPIRE / HMGET / HSETNX / DEL su un hash:
 * tiene i campi e la scadenza su un orologio che il test fa avanzare.
 * `primaDelSecondoGiro` simula un'altra replica che scrive fra il primo e il
 * secondo MULTI della stessa richiesta.
 */
const { fake } = vi.hoisted(() => {
  type Hash = { campi: Map<string, string>; expiresAt: number };
  const store = new Map<string, Hash>();
  const fake = {
    status: 'ready' as string,
    clock: 0,
    store,
    giri: 0,
    primaDelSecondoGiro: null as null | (() => void),
    alive(key: string) {
      const v = store.get(key);
      if (v && v.expiresAt <= fake.clock) store.delete(key);
      return store.get(key);
    },
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    multi() {
      const ops: Array<() => [null, unknown]> = [];
      const chain = {
        expire(key: string, seconds: number) {
          ops.push(() => {
            const v = fake.alive(key);
            if (!v) return [null, 0];
            v.expiresAt = fake.clock + seconds * 1000;
            return [null, 1];
          });
          return chain;
        },
        hmget(key: string, ...campi: string[]) {
          ops.push(() => {
            const v = fake.alive(key);
            return [null, campi.map((c) => v?.campi.get(c) ?? null)];
          });
          return chain;
        },
        hsetnx(key: string, campo: string, valore: string) {
          ops.push(() => {
            let v = fake.alive(key);
            if (!v) {
              v = { campi: new Map(), expiresAt: Number.POSITIVE_INFINITY };
              store.set(key, v);
            }
            if (v.campi.has(campo)) return [null, 0];
            v.campi.set(campo, valore);
            return [null, 1];
          });
          return chain;
        },
        exec: vi.fn(async () => {
          fake.giri += 1;
          if (fake.giri === 2) fake.primaDelSecondoGiro?.();
          return ops.map((op) => op());
        }),
      };
      return chain;
    },
  };
  return { fake };
});

let redisPresente = true;

vi.mock('@/lib/redis', async (importOriginal) => {
  const actual = await importOriginal<typeof RedisModule>();
  return {
    ...actual,
    getRedis: () => (redisPresente ? fake : null),
  };
});

import {
  RECORDER_WAIT_IDLE_SECONDS,
  RECORDER_WAIT_KEY,
  __resetRecorderWait,
  recorderWaitingSince,
} from './recorder-wait';

const MIN = 60_000;

beforeEach(() => {
  __resetRecorderWait();
  fake.store.clear();
  fake.status = 'ready';
  fake.clock = 0;
  fake.giri = 0;
  fake.primaDelSecondoGiro = null;
  redisPresente = true;
  vi.clearAllMocks();
});

async function chiedi(waiting: boolean, now: number, eventi: string[] = ['a']) {
  fake.clock = now;
  return recorderWaitingSince(eventi, waiting, now);
}

/** Come fa la sala: interroga ogni minuto da `da` (escluso) a `a` (incluso) e
 *  restituisce l'ultima risposta. */
async function finoA(da: number, a: number, eventi: string[] = ['a']) {
  let ultima: number | null = null;
  for (let t = da + MIN; t <= a; t += MIN) ultima = await chiedi(true, t, eventi);
  return ultima;
}

function scriviInizi(inizi: Record<string, number>, expiresAt = 60 * MIN) {
  fake.store.set(RECORDER_WAIT_KEY, {
    campi: new Map(Object.entries(inizi).map(([k, v]) => [k, String(v)])),
    expiresAt,
  });
}

describe('orologio dell’attesa del registratore', () => {
  it('l’inizio resta quello della prima richiesta finché si aspetta', async () => {
    expect(await chiedi(true, 1_000)).toBe(1_000);
    // Chi aspetta interroga ogni pochi secondi: qui ogni due minuti basta.
    for (let t = 2 * MIN; t <= 20 * MIN; t += 2 * MIN) {
      expect(await chiedi(true, 1_000 + t)).toBe(1_000);
    }
  });

  it('l’inizio scritto da un’altra replica vale per tutte', async () => {
    scriviInizi({ a: 500 });
    expect(await chiedi(true, 2 * MIN)).toBe(500);
  });

  it('se un’altra replica scrive fra i due giri, vale il suo inizio', async () => {
    fake.primaDelSecondoGiro = () => scriviInizi({ a: 700 });
    expect(await chiedi(true, 2 * MIN)).toBe(700);
    expect(fake.store.get(RECORDER_WAIT_KEY)?.campi.get('a')).toBe('700');
  });

  it('quando l’attesa finisce il segnaposto si cancella e la prossima riparte da zero', async () => {
    await chiedi(true, 1_000);
    expect(await chiedi(false, 5 * MIN)).toBeNull();
    expect(fake.del).toHaveBeenCalledWith(RECORDER_WAIT_KEY);
    expect(await chiedi(true, 6 * MIN)).toBe(6 * MIN);
  });

  it('un’attesa che nessuno guarda da qualche minuto non si eredita', async () => {
    await chiedi(true, 1_000);
    const dopo = 1_000 + (RECORDER_WAIT_IDLE_SECONDS + 1) * 1000;
    expect(await chiedi(true, dopo)).toBe(dopo);
  });

  it('un evento nuovo non eredita l’attesa di uno concluso da poco', async () => {
    // L'evento «a» aspetta da 20 minuti, poi finisce e nessuno interroga più:
    // il segnaposto non è ancora scaduto quando parte l'evento «b».
    const t0 = 1_000;
    await chiedi(true, t0, ['a']);
    expect(await finoA(t0, t0 + 20 * MIN, ['a'])).toBe(t0);
    expect(await chiedi(true, t0 + 23 * MIN, ['b'])).toBe(t0 + 23 * MIN);
    expect(await finoA(t0 + 23 * MIN, t0 + 30 * MIN, ['b'])).toBe(t0 + 23 * MIN);
  });

  it('un evento che si aggiunge a un’attesa in corso ne eredita l’inizio', async () => {
    const t0 = 1_000;
    await chiedi(true, t0, ['a']);
    await finoA(t0, t0 + 9 * MIN, ['a']);
    expect(await finoA(t0 + 9 * MIN, t0 + 12 * MIN, ['a', 'b'])).toBe(t0);
    // Finito «a», «b» continua dall'inizio che aveva ereditato.
    expect(await finoA(t0 + 12 * MIN, t0 + 20 * MIN, ['b'])).toBe(t0);
  });

  it('un inizio nel futuro (orologi un po’ sfasati) vale come adesso', async () => {
    scriviInizi({ a: 10 * MIN }, 20 * MIN);
    expect(await chiedi(true, 9 * MIN)).toBe(9 * MIN);
  });

  it('senza Redis vale l’orologio in memoria, con le stesse regole', async () => {
    redisPresente = false;
    expect(await chiedi(true, 1_000)).toBe(1_000);
    expect(await chiedi(true, 4 * MIN)).toBe(1_000);
    expect(await chiedi(false, 5 * MIN)).toBeNull();
    expect(await chiedi(true, 6 * MIN)).toBe(6 * MIN);
    const dopo = 6 * MIN + (RECORDER_WAIT_IDLE_SECONDS + 1) * 1000;
    expect(await chiedi(true, dopo)).toBe(dopo);
    // Evento nuovo dopo uno concluso: da zero; evento aggiunto: eredita.
    expect(await chiedi(true, dopo + 3 * MIN, ['b'])).toBe(dopo + 3 * MIN);
    expect(await chiedi(true, dopo + 4 * MIN, ['b', 'c'])).toBe(dopo + 3 * MIN);
    expect(await chiedi(true, dopo + 5 * MIN, ['c'])).toBe(dopo + 3 * MIN);
  });

  it('con Redis non pronto non lo interroga e usa l’orologio in memoria', async () => {
    fake.status = 'reconnecting';
    expect(await chiedi(true, 1_000)).toBe(1_000);
    expect(await chiedi(true, 2 * MIN)).toBe(1_000);
    expect(fake.store.size).toBe(0);
  });

  it('se Redis smette di rispondere, la replica dà ancora l’inizio letto da Redis', async () => {
    // Questa replica ha visto la prima richiesta a 5 minuti; l'attesa, scritta
    // da un'altra replica, è cominciata prima.
    scriviInizi({ a: 1_000 });
    expect(await chiedi(true, 5 * MIN)).toBe(1_000);
    expect(await finoA(5 * MIN, 12 * MIN)).toBe(1_000);
    fake.status = 'connecting';
    const giriPrima = fake.giri;
    expect(await finoA(12 * MIN, 16 * MIN)).toBe(1_000);
    expect(fake.giri).toBe(giriPrima);
  });
});
