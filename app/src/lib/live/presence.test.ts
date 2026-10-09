import { beforeEach, describe, expect, it, vi } from 'vitest';

const redis = vi.hoisted(() => {
  // Un Redis finto con soli insiemi ordinati, quanto basta.
  const zset = new Map<string, Map<string, number>>();
  const insieme = (k: string) => {
    let s = zset.get(k);
    if (!s) zset.set(k, (s = new Map()));
    return s;
  };
  const client = {
    status: 'ready',
    pipeline() {
      const ops: Array<() => unknown> = [];
      const p = {
        zadd: (k: string, score: number, m: string) => (ops.push(() => insieme(k).set(m, score)), p),
        zrem: (k: string, m: string) => (ops.push(() => insieme(k).delete(m)), p),
        zremrangebyscore: (k: string, min: number, max: number) => (
          ops.push(() => {
            for (const [m, s] of insieme(k)) if (s >= min && s <= max) insieme(k).delete(m);
          }),
          p
        ),
        zcard: (k: string) => (ops.push(() => insieme(k).size), p),
        expire: () => (ops.push(() => 1), p),
        exec: async () => ops.map((op) => [null, op()]),
      };
      return p;
    },
  };
  return { client, zset };
});
vi.mock('@/lib/redis', () => ({
  getRedis: () => redis.client,
  withDeadline: <T,>(op: Promise<T>) => op,
}));

import { FINESTRA_MS, lasciaPresenza, segnaPresenza } from './presence';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  redis.zset.clear();
  redis.client.status = 'ready';
});

describe('presenze', () => {
  it('conta chi aspetta e chi è in diretta, e passare in diretta toglie dall’attesa', async () => {
    expect(await segnaPresenza('e1', A, 'attesa', 1000)).toEqual({ inDiretta: 0, inAttesa: 1 });
    expect(await segnaPresenza('e1', B, 'attesa', 1000)).toEqual({ inDiretta: 0, inAttesa: 2 });
    expect(await segnaPresenza('e1', A, 'diretta', 2000)).toEqual({ inDiretta: 1, inAttesa: 1 });
  });

  it('chi tace oltre la finestra non conta più', async () => {
    await segnaPresenza('e1', A, 'attesa', 0);
    expect(await segnaPresenza('e1', B, 'attesa', FINESTRA_MS + 1)).toEqual({ inDiretta: 0, inAttesa: 1 });
  });

  it('gli eventi sono separati, e chi lascia esce subito dal conto', async () => {
    await segnaPresenza('e1', A, 'diretta', 1000);
    expect(await segnaPresenza('e2', B, 'attesa', 1000)).toEqual({ inDiretta: 0, inAttesa: 1 });
    await lasciaPresenza('e1', A);
    expect(await segnaPresenza('e1', B, 'attesa', 1000)).toEqual({ inDiretta: 0, inAttesa: 1 });
  });

  it('senza Redis non si sa: null, non zero', async () => {
    redis.client.status = 'connecting';
    expect(await segnaPresenza('e1', A, 'attesa', 1000)).toBeNull();
  });
});
