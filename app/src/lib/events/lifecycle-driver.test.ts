/**
 * Chi conduce il ciclo di vita: lo scaler, se il suo battito c'è; altrimenti
 * il giro a bridge fisso. Il ripiego senza Redis è JVB_SCALER_ENABLED.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const redis = vi.hoisted(() => ({
  client: null as null | { exists: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> },
}));
vi.mock('@/lib/redis', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getRedis: () => redis.client };
});

import {
  SCALER_HEARTBEAT_KEY,
  SCALER_HEARTBEAT_TTL_SECONDS,
  __resetScalerDriverCache,
  recordScalerHeartbeat,
  scalerDriverActive,
} from './lifecycle-driver';

beforeEach(() => {
  __resetScalerDriverCache();
  redis.client = { exists: vi.fn(), set: vi.fn().mockResolvedValue('OK') };
});

describe('scalerDriverActive', () => {
  it('vero con il battito dello scaler in Redis', async () => {
    redis.client!.exists.mockResolvedValue(1);
    expect(await scalerDriverActive({})).toBe(true);
    expect(redis.client!.exists).toHaveBeenCalledWith(SCALER_HEARTBEAT_KEY);
  });

  it('falso senza battito, anche se JVB_SCALER_ENABLED è vero (KEDA non conduce nulla)', async () => {
    redis.client!.exists.mockResolvedValue(0);
    expect(await scalerDriverActive({ JVB_SCALER_ENABLED: 'true' })).toBe(false);
  });

  it('senza Redis decide JVB_SCALER_ENABLED', async () => {
    redis.client = null;
    expect(await scalerDriverActive({ JVB_SCALER_ENABLED: 'true' })).toBe(true);
    __resetScalerDriverCache();
    expect(await scalerDriverActive({})).toBe(false);
  });

  it('con Redis in errore decide JVB_SCALER_ENABLED', async () => {
    redis.client!.exists.mockRejectedValue(new Error('down'));
    expect(await scalerDriverActive({ JVB_SCALER_ENABLED: 'true' })).toBe(true);
  });

  it('con Redis che non risponde non resta appeso: dopo un secondo vale il ripiego', async () => {
    vi.useFakeTimers();
    try {
      redis.client!.exists.mockReturnValue(new Promise(() => {}));
      const esito = scalerDriverActive({});
      await vi.advanceTimersByTimeAsync(1000);
      expect(await esito).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('tiene il risultato qualche secondo: la sala d\'attesa interroga spesso', async () => {
    redis.client!.exists.mockResolvedValue(1);
    await scalerDriverActive({});
    await scalerDriverActive({});
    expect(redis.client!.exists).toHaveBeenCalledTimes(1);
  });
});

describe('recordScalerHeartbeat', () => {
  it('scrive il battito con la sua scadenza', async () => {
    await recordScalerHeartbeat();
    expect(redis.client!.set).toHaveBeenCalledWith(
      SCALER_HEARTBEAT_KEY,
      expect.any(String),
      'EX',
      SCALER_HEARTBEAT_TTL_SECONDS,
    );
  });

  it('dura più di un giro dello scaler (2 minuti)', () => {
    expect(SCALER_HEARTBEAT_TTL_SECONDS).toBeGreaterThan(120);
  });

  it('un errore di Redis non si propaga', async () => {
    redis.client!.set.mockRejectedValue(new Error('down'));
    await expect(recordScalerHeartbeat()).resolves.toBeUndefined();
  });

  it('senza Redis non fa nulla', async () => {
    redis.client = null;
    await expect(recordScalerHeartbeat()).resolves.toBeUndefined();
  });
});
