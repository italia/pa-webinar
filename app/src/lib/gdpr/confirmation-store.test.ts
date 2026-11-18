// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { randomBytes } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ModuloRedis from '@/lib/redis';

const stato = vi.hoisted(() => ({
  redis: null as null | ReturnType<typeof redisFinto>,
  pronto: true,
}));
// Solo il client finto: `withDeadline` e' quello vero, con la sua scadenza.
vi.mock('@/lib/redis', async (originale) => ({
  ...(await originale<typeof ModuloRedis>()),
  getRedis: () => stato.redis,
}));
vi.mock('@/lib/live-state/pubsub', () => ({ liveRedisReady: async () => stato.pronto }));

import {
  annullaInvio,
  CODICI_PER_ORA,
  contaInvio,
  contaTentativo,
  prendiEmissione,
  registraEmissione,
  restituisciEmissione,
  TENTATIVI_PER_CODICE,
} from './confirmation-store';

/**
 * Un Redis finto con la semantica dei comandi usati: INCR tiene la scadenza di una
 * chiave che c'e', PTTL e' -1 per una chiave senza scadenza, SET NX non tocca una
 * chiave che c'e', MULTI esegue in ordine.
 */
function redisFinto() {
  const dati = new Map<string, { valore: number; scade: number | null }>();
  const r = { dati, guasto: null as 'rifiuta' | 'tace' | null };
  const vivo = (k: string) => {
    const v = dati.get(k);
    if (v && v.scade !== null && v.scade <= Date.now()) dati.delete(k);
    return dati.get(k);
  };
  const esegui = <T>(f: () => T): Promise<T> =>
    r.guasto === 'rifiuta'
      ? Promise.reject(new Error('NOPERM finto'))
      : r.guasto === 'tace'
        ? new Promise<T>(() => {})
        : Promise.resolve(f());
  const comandi = {
    incr: (k: string) => {
      const v = vivo(k) ?? { valore: 0, scade: null };
      v.valore += 1;
      dati.set(k, v);
      return v.valore;
    },
    decr: (k: string) => {
      const v = vivo(k) ?? { valore: 0, scade: null };
      v.valore -= 1;
      dati.set(k, v);
      return v.valore;
    },
    pttl: (k: string) => {
      const v = vivo(k);
      if (!v) return -2;
      return v.scade === null ? -1 : v.scade - Date.now();
    },
    pexpire: (k: string, ms: number) => {
      const v = vivo(k);
      if (!v) return 0;
      v.scade = Date.now() + ms;
      return 1;
    },
    del: (k: string) => (dati.delete(k) ? 1 : 0),
    set: (k: string, valore: string, _px: string, ms: number, nx?: string) => {
      if (nx === 'NX' && vivo(k)) return null;
      dati.set(k, { valore: Number(valore), scade: Date.now() + ms });
      return 'OK';
    },
  };
  const client = {
    ...r,
    incr: (k: string) => esegui(() => comandi.incr(k)),
    decr: (k: string) => esegui(() => comandi.decr(k)),
    del: (k: string) => esegui(() => comandi.del(k)),
    set: (...a: Parameters<typeof comandi.set>) => esegui(() => comandi.set(...a)),
    multi: () => {
      const coda: Array<() => unknown> = [];
      const m = {
        incr: (k: string) => (coda.push(() => comandi.incr(k)), m),
        pttl: (k: string) => (coda.push(() => comandi.pttl(k)), m),
        pexpire: (k: string, ms: number) => (coda.push(() => comandi.pexpire(k, ms)), m),
        exec: () => esegui(() => coda.map((f) => [null, f()] as [null, unknown])),
      };
      return m;
    },
  };
  Object.defineProperty(client, 'guasto', {
    get: () => r.guasto,
    set: (v) => (r.guasto = v),
  });
  return client;
}

const richiesta = () => ({
  azione: 'cancel' as const,
  emailHash: randomBytes(32).toString('hex'),
  oggetto: 'r1',
  impronta: '',
});
const ADESSO = () => Math.floor(Date.now() / 1000);

beforeEach(() => {
  stato.redis = null;
  stato.pronto = true;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe.each([
  ['nella memoria del processo, senza Redis', () => null],
  ['in Redis', redisFinto],
])('il registro dei codici %s', (_nome, crea) => {
  beforeEach(() => {
    stato.redis = crea() as never;
  });

  it('un codice mai mandato e’ sconosciuto, e non lascia traccia', async () => {
    expect((await contaTentativo(richiesta(), ADESSO())).esito).toBe('sconosciuto');
    if (stato.redis) expect(stato.redis.dati.size).toBe(0);
  });

  it('un codice mandato ammette i suoi tentativi, poi e’ esaurito', async () => {
    const r = richiesta();
    const t = ADESSO();
    expect(await registraEmissione(r, t)).toBe('ok');
    for (let i = 1; i <= TENTATIVI_PER_CODICE; i++) {
      expect(await contaTentativo(r, t)).toEqual({ esito: 'ammesso', tentativi: i });
    }
    expect((await contaTentativo(r, t)).esito).toBe('esaurito');
    // Un'altra ora di emissione e' un altro codice.
    expect((await contaTentativo(r, t + 1)).esito).toBe('sconosciuto');
  });

  it('si prende una volta sola, e restituito torna valido', async () => {
    const r = richiesta();
    const t = ADESSO();
    await registraEmissione(r, t);
    expect(await prendiEmissione(r, t)).toBe(true);
    expect(await prendiEmissione(r, t)).toBe(false);
    expect((await contaTentativo(r, t)).esito).toBe('sconosciuto');
    await restituisciEmissione(r, t, 2);
    expect(await contaTentativo(r, t)).toEqual({ esito: 'ammesso', tentativi: 3 });
  });

  it('conta i codici mandati a un indirizzo, senza quelli non partiti', async () => {
    const { emailHash } = richiesta();
    for (let i = 0; i < CODICI_PER_ORA; i++)
      expect(await contaInvio(emailHash)).toBe('ok');
    if (stato.redis) {
      await annullaInvio(emailHash);
      expect(await contaInvio(emailHash)).toBe('ok');
    }
    expect(await contaInvio(emailHash)).toBe('troppi');
  });
});

describe('con Redis configurato che non risponde', () => {
  it.each(['rifiuta', 'tace'] as const)(
    'se %s, non emette, non conferma e non prende niente',
    async (guasto) => {
      const redis = redisFinto();
      stato.redis = redis as never;
      const r = richiesta();
      const t = ADESSO();
      await registraEmissione(r, t);
      redis.guasto = guasto;
      expect(await contaInvio(r.emailHash)).toBe('nonDisponibile');
      expect(await registraEmissione(r, t)).toBe('nonDisponibile');
      expect((await contaTentativo(r, t)).esito).toBe('nonDisponibile');
      expect(await prendiEmissione(r, t)).toBe('nonDisponibile');
    },
    5000
  );

  it('se la connessione non e’ pronta, lo stesso', async () => {
    stato.redis = redisFinto() as never;
    stato.pronto = false;
    const r = richiesta();
    expect(await contaInvio(r.emailHash)).toBe('nonDisponibile');
    expect(await registraEmissione(r, 1)).toBe('nonDisponibile');
    expect((await contaTentativo(r, 1)).esito).toBe('nonDisponibile');
  });

  it('le chiavi non portano indirizzi o codici in chiaro', async () => {
    const redis = redisFinto();
    stato.redis = redis as never;
    const r = richiesta();
    await registraEmissione(r, ADESSO());
    await contaInvio(r.emailHash);
    for (const k of redis.dati.keys()) {
      expect(k).toMatch(/^gdpr:code(-sent)?:[0-9a-f]{64}$/);
      expect(k).not.toContain(r.emailHash);
    }
  });
});
