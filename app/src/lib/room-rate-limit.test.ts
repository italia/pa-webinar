import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  limiteDellaSala,
  limiteTokenOspiti,
  moltiplicatoreSala,
} from './room-rate-limit';

afterEach(() => {
  delete process.env.ROOM_RATE_LIMIT_MULTIPLIER;
  delete process.env.GUEST_JWT_RATE_LIMIT_PER_MINUTE;
  vi.restoreAllMocks();
});

describe('limiteDellaSala', () => {
  it('senza variabile i limiti sono quelli scritti nelle rotte', () => {
    expect(moltiplicatoreSala()).toBe(1);
    expect(limiteDellaSala(600)).toBe(600);
  });

  it('per un luogo con il pubblico sullo stesso Wi-Fi li moltiplica tutti', () => {
    process.env.ROOM_RATE_LIMIT_MULTIPLIER = '20';
    expect(limiteDellaSala(600)).toBe(12_000);
    expect(limiteDellaSala(30)).toBe(600);
  });

  it("un valore che non e' un intero positivo vale 1", () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const v of ['1e4', '10k', '6_000', '0', '-2', '2.5', 'molti', ' 3 x']) {
      process.env.ROOM_RATE_LIMIT_MULTIPLIER = v;
      expect(moltiplicatoreSala(), v).toBe(1);
    }
    process.env.ROOM_RATE_LIMIT_MULTIPLIER = ' 7 ';
    expect(moltiplicatoreSala()).toBe(7);
  });

  it('oltre il tetto vale il tetto, anche un numero lunghissimo', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const v of ['150', '1000000', '99999999999999999999']) {
      process.env.ROOM_RATE_LIMIT_MULTIPLIER = v;
      expect(moltiplicatoreSala(), v).toBe(100);
    }
  });
});

describe('limiteTokenOspiti', () => {
  it('120 di base, scalato con la sala', () => {
    expect(limiteTokenOspiti()).toBe(120);
    process.env.ROOM_RATE_LIMIT_MULTIPLIER = '10';
    expect(limiteTokenOspiti()).toBe(1200);
  });

  it("vale com'e', zero compreso; illeggibile vale 120, con un avviso", () => {
    const avviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.GUEST_JWT_RATE_LIMIT_PER_MINUTE = '500';
    expect(limiteTokenOspiti()).toBe(500);
    process.env.GUEST_JWT_RATE_LIMIT_PER_MINUTE = '0';
    expect(limiteTokenOspiti()).toBe(0);
    process.env.GUEST_JWT_RATE_LIMIT_PER_MINUTE = 'tanti';
    expect(limiteTokenOspiti()).toBe(120);
    expect(avviso).toHaveBeenCalledWith(
      expect.stringContaining('GUEST_JWT_RATE_LIMIT_PER_MINUTE')
    );
  });
});
