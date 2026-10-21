// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Un Redis finto, quanto basta per HINCRBY + PEXPIRE in un MULTI e HGETALL.
 * La memoria del processo si svuota a mano per fare la parte di un'altra
 * istanza dell'app.
 */
const { fake } = vi.hoisted(() => {
  const hashes = new Map<string, Map<string, number>>();
  const fake = {
    status: 'ready' as string,
    hashes,
    /** Quando vero, nessun comando risponde. */
    muto: false,
    scadenze: [] as Array<[string, number]>,
    multi() {
      const ops: Array<() => [null, unknown]> = [];
      const chain = {
        hincrby(key: string, field: string, by: number) {
          ops.push(() => {
            let h = hashes.get(key);
            if (!h) {
              h = new Map();
              hashes.set(key, h);
            }
            const n = (h.get(field) ?? 0) + by;
            h.set(field, n);
            return [null, n];
          });
          return chain;
        },
        pexpire(key: string, ms: number) {
          ops.push(() => {
            fake.scadenze.push([key, ms]);
            return [null, 1];
          });
          return chain;
        },
        exec: async () => {
          if (fake.muto) return new Promise<never>(() => {});
          return ops.map((op) => op());
        },
      };
      return chain;
    },
    hgetall: vi.fn(async (key: string): Promise<Record<string, string>> => {
      if (fake.muto) return new Promise<never>(() => {});
      const h = hashes.get(key);
      return h ? Object.fromEntries([...h].map(([k, v]) => [k, String(v)])) : {};
    }),
  };
  return { fake };
});

let redisPresente = true;

vi.mock('@/lib/redis', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getRedis: () => (redisPresente ? fake : null),
  };
});

import { deleteCache } from '@/lib/cache';
import { VALID_EMOJIS } from '@/lib/validation/schemas';

import { contaReazione, leggiReazioni, REACTIONS_TTL_MS } from './reactions-count';

const EVENTO = 'ev-1';

function altraIstanza(): void {
  deleteCache(`reactions:${EVENTO}`);
}

const zeri = () => Object.fromEntries(VALID_EMOJIS.map((e) => [e, 0]));

beforeEach(() => {
  redisPresente = true;
  fake.status = 'ready';
  fake.muto = false;
  fake.hashes.clear();
  fake.scadenze = [];
  fake.hgetall.mockClear();
  altraIstanza();
});

describe('contatori delle reazioni condivisi fra le istanze', () => {
  it('i clic arrivati a istanze diverse si sommano, e ogni istanza legge lo stesso totale', async () => {
    expect(await contaReazione(EVENTO, '👏')).toBe(1);
    altraIstanza();
    expect(await contaReazione(EVENTO, '👏')).toBe(2);
    altraIstanza();
    expect(await contaReazione(EVENTO, '🎉')).toBe(1);
    altraIstanza();
    expect(await leggiReazioni(EVENTO)).toEqual({ ...zeri(), '👏': 2, '🎉': 1 });
    // La scadenza si rinnova a ogni clic.
    expect(fake.scadenze.at(-1)).toEqual([`live:reactions:${EVENTO}`, REACTIONS_TTL_MS]);
  });

  it('un evento senza clic: tutte le emoji della barra, a zero', async () => {
    expect(await leggiReazioni(EVENTO)).toEqual(zeri());
  });

  it('Redis che non risponde: i numeri non tornano a zero, e il clic si conta qui', async () => {
    await contaReazione(EVENTO, '👍');
    await contaReazione(EVENTO, '👍');
    expect((await leggiReazioni(EVENTO))['👍']).toBe(2);

    fake.muto = true;
    vi.useFakeTimers();
    try {
      const lettura = leggiReazioni(EVENTO);
      await vi.advanceTimersByTimeAsync(1500);
      expect((await lettura)['👍']).toBe(2);

      const clic = contaReazione(EVENTO, '👍');
      await vi.advanceTimersByTimeAsync(1500);
      expect(await clic).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('senza Redis conta la memoria del processo, come una replica sola', async () => {
    redisPresente = false;
    expect(await contaReazione(EVENTO, '😮')).toBe(1);
    expect(await contaReazione(EVENTO, '😮')).toBe(2);
    expect(await leggiReazioni(EVENTO)).toEqual({ ...zeri(), '😮': 2 });
    expect(fake.hgetall).not.toHaveBeenCalled();
  });

  it('chi legge riceve una copia: modificarla non tocca i conteggi', async () => {
    redisPresente = false;
    await contaReazione(EVENTO, '❤️');
    const letti = await leggiReazioni(EVENTO);
    letti['❤️'] = 99;
    expect((await leggiReazioni(EVENTO))['❤️']).toBe(1);
  });
});
