// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { createHash } from 'crypto';

import type { RichiestaConfermata } from '@/lib/gdpr/confirmation-code';
import { DURATA_CODICE_MINUTI } from '@/lib/gdpr/confirmation-code';
import { liveRedisReady } from '@/lib/live-state/pubsub';
import { getRedis, withDeadline } from '@/lib/redis';

/**
 * Il registro dei codici di conferma emessi (lib/gdpr/confirmation-code), condiviso
 * fra le repliche dell'app in Redis.
 *
 * Il codice resta un HMAC che non si salva: qui si annota solo che per quella
 * richiesta, a quell'ora, un codice e' partito davvero verso l'indirizzo, e quanti
 * tentativi ha avuto. Cosi':
 *  - si tira a indovinare solo un codice che e' stato mandato, cioe' dopo che la
 *    persona ha ricevuto un'email che la avvisa;
 *  - ogni codice ammette `TENTATIVI_PER_CODICE` tentativi in tutto il cluster, e
 *    vale una volta: confermato, l'emissione si chiude;
 *  - i codici mandati a un indirizzo in un'ora si contano in tutto il cluster.
 * Le chiavi sono impronte: niente indirizzi, nomi o codici in Redis.
 *
 * Senza Redis configurato (sviluppo, una replica) il registro sta nella memoria
 * del processo. Con Redis configurato ma irraggiungibile non si emette e non si
 * conferma niente (`nonDisponibile`): meglio un «riprova» che un codice valido su
 * una replica e sconosciuto sulle altre.
 */

export const TENTATIVI_PER_CODICE = 5;
export const CODICI_PER_ORA = 5;

const DURATA_MS = DURATA_CODICE_MINUTI * 60_000;
const ORA_MS = 3_600_000;
const ATTESA_REDIS_MS = 1000;

type Voce = { valore: number; scade: number };
const memoria = new Map<string, Voce>();

function pulisci(adesso: number): void {
  for (const [k, v] of memoria) if (v.scade <= adesso) memoria.delete(k);
}

const impronta = (...parti: Array<string | number>) =>
  createHash('sha256').update(parti.join('\n')).digest('hex');

function chiaveEmissione(r: RichiestaConfermata, emessoIl: number): string {
  return `gdpr:code:${impronta(r.azione, r.emailHash, r.oggetto, r.impronta, emessoIl)}`;
}

/** Redis pronto a rispondere, `null` senza Redis, `false` se non risponde. */
async function redisPronto() {
  const redis = getRedis();
  if (!redis) return null;
  return (await liveRedisReady(ATTESA_REDIS_MS)) ? redis : false;
}

// Incrementa solo una chiave che esiste: un'emissione mai registrata resta assente.
const INCREMENTA_SE_ESISTE = `
if redis.call('EXISTS', KEYS[1]) == 0 then return -1 end
return redis.call('INCR', KEYS[1])`;

// Conta e, al primo, fissa la finestra.
const CONTA_NELLA_FINESTRA = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return n`;

export type Esito = 'ok' | 'troppi' | 'nonDisponibile';

/** Conta un codice mandato a questo indirizzo: oltre `CODICI_PER_ORA` l'ora, no. */
export async function contaInvio(emailHash: string): Promise<Esito> {
  const chiave = `gdpr:code-sent:${impronta(emailHash)}`;
  const redis = await redisPronto();
  if (redis === false) return 'nonDisponibile';
  let n: number;
  if (redis) {
    const r = await withDeadline(
      redis.eval(CONTA_NELLA_FINESTRA, 1, chiave, String(ORA_MS)) as Promise<number>,
      ATTESA_REDIS_MS,
      null
    );
    if (r === null) return 'nonDisponibile';
    n = Number(r);
  } else {
    const adesso = Date.now();
    pulisci(adesso);
    const voce = memoria.get(chiave) ?? { valore: 0, scade: adesso + ORA_MS };
    voce.valore += 1;
    memoria.set(chiave, voce);
    n = voce.valore;
  }
  return n > CODICI_PER_ORA ? 'troppi' : 'ok';
}

/** Annota che il codice di questa richiesta e' partito. */
export async function registraEmissione(
  r: RichiestaConfermata,
  emessoIl: number
): Promise<Exclude<Esito, 'troppi'>> {
  const chiave = chiaveEmissione(r, emessoIl);
  const redis = await redisPronto();
  if (redis === false) return 'nonDisponibile';
  if (redis) {
    const fatto = await withDeadline(
      redis.set(chiave, '0', 'PX', DURATA_MS),
      ATTESA_REDIS_MS,
      null
    );
    return fatto === 'OK' ? 'ok' : 'nonDisponibile';
  }
  const adesso = Date.now();
  pulisci(adesso);
  memoria.set(chiave, { valore: 0, scade: adesso + DURATA_MS });
  return 'ok';
}

export type EsitoTentativo = 'ammesso' | 'sconosciuto' | 'esaurito' | 'nonDisponibile';

/** Conta un tentativo sul codice di questa richiesta, se e' stato mandato. */
export async function contaTentativo(
  r: RichiestaConfermata,
  emessoIl: number
): Promise<EsitoTentativo> {
  const chiave = chiaveEmissione(r, emessoIl);
  const redis = await redisPronto();
  if (redis === false) return 'nonDisponibile';
  let n: number;
  if (redis) {
    const esito = await withDeadline(
      redis.eval(INCREMENTA_SE_ESISTE, 1, chiave) as Promise<number>,
      ATTESA_REDIS_MS,
      null
    );
    if (esito === null) return 'nonDisponibile';
    n = Number(esito);
  } else {
    const adesso = Date.now();
    pulisci(adesso);
    const voce = memoria.get(chiave);
    if (!voce) return 'sconosciuto';
    voce.valore += 1;
    n = voce.valore;
  }
  if (n < 0) return 'sconosciuto';
  return n > TENTATIVI_PER_CODICE ? 'esaurito' : 'ammesso';
}

/** Il codice e' stato usato: non vale piu'. */
export async function chiudiEmissione(
  r: RichiestaConfermata,
  emessoIl: number
): Promise<void> {
  const chiave = chiaveEmissione(r, emessoIl);
  memoria.delete(chiave);
  const redis = await redisPronto();
  if (redis) await withDeadline(redis.del(chiave), ATTESA_REDIS_MS, 0);
}
