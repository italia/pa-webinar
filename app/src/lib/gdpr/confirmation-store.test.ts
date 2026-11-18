// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { randomBytes } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const stato = vi.hoisted(() => ({
  redis: null as null | Record<string, unknown>,
  pronto: true,
}));
vi.mock('@/lib/redis', () => ({
  getRedis: () => stato.redis,
  withDeadline: <T>(op: Promise<T>) => op,
}));
vi.mock('@/lib/live-state/pubsub', () => ({ liveRedisReady: async () => stato.pronto }));

import {
  chiudiEmissione,
  CODICI_PER_ORA,
  contaInvio,
  contaTentativo,
  registraEmissione,
  TENTATIVI_PER_CODICE,
} from './confirmation-store';

/** Un Redis finto con le sole operazioni del registro, e i due script. */
function redisFinto() {
  const dati = new Map<string, number>();
  return {
    dati,
    set: vi.fn(async (k: string, v: string) => {
      dati.set(k, Number(v));
      return 'OK';
    }),
    del: vi.fn(async (k: string) => (dati.delete(k) ? 1 : 0)),
    eval: vi.fn(async (script: string, _n: number, k: string) => {
      if (script.includes('EXISTS')) {
        if (!dati.has(k)) return -1;
      }
      const n = (dati.get(k) ?? 0) + 1;
      dati.set(k, n);
      return n;
    }),
  };
}

const richiesta = () => ({
  azione: 'cancel' as const,
  emailHash: randomBytes(32).toString('hex'),
  oggetto: 'r1',
  impronta: '',
});

beforeEach(() => {
  stato.redis = null;
  stato.pronto = true;
});

describe.each([
  ['nella memoria del processo, senza Redis', () => null],
  ['in Redis', redisFinto],
])('il registro dei codici %s', (_nome, crea) => {
  beforeEach(() => {
    stato.redis = crea();
  });

  it('un codice mai mandato e’ sconosciuto', async () => {
    expect(await contaTentativo(richiesta(), 1_700_000_000)).toBe('sconosciuto');
  });

  it('un codice mandato ammette i suoi tentativi, poi e’ esaurito', async () => {
    const r = richiesta();
    expect(await registraEmissione(r, 1_700_000_000)).toBe('ok');
    for (let i = 0; i < TENTATIVI_PER_CODICE; i++) {
      expect(await contaTentativo(r, 1_700_000_000)).toBe('ammesso');
    }
    expect(await contaTentativo(r, 1_700_000_000)).toBe('esaurito');
    // Un'altra ora di emissione e' un altro codice.
    expect(await contaTentativo(r, 1_700_000_001)).toBe('sconosciuto');
  });

  it('chiuso, un codice non vale piu’', async () => {
    const r = richiesta();
    await registraEmissione(r, 1_700_000_000);
    await chiudiEmissione(r, 1_700_000_000);
    expect(await contaTentativo(r, 1_700_000_000)).toBe('sconosciuto');
  });

  it('conta i codici mandati a un indirizzo', async () => {
    const { emailHash } = richiesta();
    for (let i = 0; i < CODICI_PER_ORA; i++)
      expect(await contaInvio(emailHash)).toBe('ok');
    expect(await contaInvio(emailHash)).toBe('troppi');
  });
});

describe('con Redis configurato ma irraggiungibile', () => {
  it('non emette e non conferma niente', async () => {
    stato.redis = redisFinto();
    stato.pronto = false;
    const r = richiesta();
    expect(await contaInvio(r.emailHash)).toBe('nonDisponibile');
    expect(await registraEmissione(r, 1)).toBe('nonDisponibile');
    expect(await contaTentativo(r, 1)).toBe('nonDisponibile');
  });

  it('le chiavi non portano indirizzi o codici in chiaro', async () => {
    const redis = redisFinto();
    stato.redis = redis;
    const r = richiesta();
    await registraEmissione(r, 1_700_000_000);
    await contaInvio(r.emailHash);
    for (const k of redis.dati.keys()) {
      expect(k).toMatch(/^gdpr:code(-sent)?:[0-9a-f]{64}$/);
      expect(k).not.toContain(r.emailHash);
    }
  });
});
