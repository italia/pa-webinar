// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Un Redis finto, quanto basta per GET e SET con scadenza. La memoria del
 * processo si svuota a mano per fare la parte di un'altra istanza dell'app,
 * che non ha mai visto il comando.
 */
const { fake } = vi.hoisted(() => {
  const store = new Map<string, string>();
  const fake = {
    status: 'ready' as string,
    store,
    /** Quando vero, GET e SET non rispondono mai. */
    muto: false,
    get: vi.fn(async (key: string): Promise<string | null> => {
      if (fake.muto) return new Promise<string | null>(() => {});
      return store.get(key) ?? null;
    }),
    set: vi.fn(
      async (key: string, value: string, _px: string, _ms: number): Promise<string> => {
        if (fake.muto) return new Promise<string>(() => {});
        store.set(key, value);
        return 'OK';
      }
    ),
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

import { leggiTimer, scriviTimer, TIMER_TTL_MS, type TimerState } from './timer-state';

const EVENTO = 'ev-1';

const inCorso: TimerState = {
  active: true,
  duration: 300,
  remaining: 300,
  visible: true,
  startedAt: 1_700_000_000_000,
  pausedAt: null,
};

/** Dimentica la memoria del processo: come chiedere a un'altra istanza. */
function altraIstanza(): void {
  deleteCache(`timer:${EVENTO}`);
}

beforeEach(() => {
  redisPresente = true;
  fake.status = 'ready';
  fake.muto = false;
  fake.store.clear();
  fake.get.mockClear();
  fake.set.mockClear();
  altraIstanza();
});

describe('timer degli interventi condiviso fra le istanze', () => {
  it('il comando dato a un’istanza si legge da un’altra', async () => {
    await scriviTimer(EVENTO, inCorso);
    altraIstanza();
    expect(await leggiTimer(EVENTO)).toEqual(inCorso);
    expect(fake.set).toHaveBeenCalledWith(
      `live:timer:${EVENTO}`,
      JSON.stringify(inCorso),
      'PX',
      TIMER_TTL_MS
    );
  });

  it('se Redis non ha il timer, non c’è: la memoria vecchia di un’istanza non lo fa ricomparire', async () => {
    await scriviTimer(EVENTO, inCorso);
    fake.store.clear(); // scaduto, o mai scritto da nessuno
    expect(await leggiTimer(EVENTO)).toBeNull();
    // E la memoria si allinea: anche senza Redis, dopo, resta spento.
    redisPresente = false;
    expect(await leggiTimer(EVENTO)).toBeNull();
  });

  it('una riga illeggibile vale come nessun timer', async () => {
    fake.store.set(`live:timer:${EVENTO}`, '{"active":"si"}');
    expect(await leggiTimer(EVENTO)).toBeNull();
    fake.store.set(`live:timer:${EVENTO}`, 'non json');
    expect(await leggiTimer(EVENTO)).toBeNull();
  });

  it('Redis che non risponde: vale l’ultimo stato noto a questa istanza, non un timer spento', async () => {
    await scriviTimer(EVENTO, inCorso);
    fake.muto = true;
    vi.useFakeTimers();
    try {
      const lettura = leggiTimer(EVENTO);
      await vi.advanceTimersByTimeAsync(1500);
      expect(await lettura).toEqual(inCorso);
    } finally {
      vi.useRealTimers();
    }
  });

  it('chi legge riceve una copia: modificarla non tocca lo stato', async () => {
    redisPresente = false;
    await scriviTimer(EVENTO, inCorso);
    const letto = await leggiTimer(EVENTO);
    letto!.visible = false;
    expect((await leggiTimer(EVENTO))?.visible).toBe(true);
  });

  it('senza Redis vale la memoria del processo, come una replica sola', async () => {
    redisPresente = false;
    expect(await leggiTimer(EVENTO)).toBeNull();
    await scriviTimer(EVENTO, inCorso);
    expect(await leggiTimer(EVENTO)).toEqual(inCorso);
    expect(fake.get).not.toHaveBeenCalled();
    expect(fake.set).not.toHaveBeenCalled();
  });
});
