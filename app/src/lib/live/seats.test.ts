import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/redis', () => ({
  getRedis: () => null,
  withDeadline: <T,>(op: Promise<T>) => op,
}));

import { claimSeat, readSeats, resetSeatsMemoryForTests } from './seats';

beforeEach(() => resetSeatsMemoryForTests());

describe('posti della chiamata (senza Redis)', () => {
  it('lo stesso posto puo’ ridichiarare il suo endpoint; due posti lo rendono conteso', async () => {
    expect(await claimSeat('e1', 'ab12', { k: 'reg', id: 'r1' })).toBe(true);
    expect(await claimSeat('e1', 'ab12', { k: 'reg', id: 'r1' })).toBe(true);
    // Un altro posto sullo stesso endpoint: conteso, e resta tale.
    expect(await claimSeat('e1', 'ab12', { k: 'reg', id: 'r2' })).toBe(false);
    expect(await readSeats('e1')).toEqual({ ab12: { k: 'conflict' } });
    expect(await claimSeat('e1', 'ab12', { k: 'reg', id: 'r1' })).toBe(false);
    expect(await readSeats('e1')).toEqual({ ab12: { k: 'conflict' } });
  });

  it('gli eventi non si mescolano', async () => {
    await claimSeat('e1', 'ab12', { k: 'grant', id: 'g1' });
    await claimSeat('e2', 'ab12', { k: 'primary' });
    expect(await readSeats('e1')).toEqual({ ab12: { k: 'grant', id: 'g1' } });
    expect(await readSeats('e2')).toEqual({ ab12: { k: 'primary' } });
  });
});
