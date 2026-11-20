// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { createHash } from 'crypto';

import type { RichiestaConfermata } from '@/lib/gdpr/confirmation-code';
import { DURATA_CODICE_MINUTI } from '@/lib/gdpr/confirmation-code';
import { liveRedisReady } from '@/lib/live-state/pubsub';
import { rateLimit } from '@/lib/rate-limit';
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
 *  - ogni codice ammette `TENTATIVI_PER_CODICE` tentativi in tutto il cluster;
 *  - un codice giusto si prende (`prendiEmissione`): solo una richiesta riesce a
 *    toglierlo dal registro, e solo quella fa la modifica. Se la modifica fallisce
 *    il codice torna valido (`restituisciEmissione`);
 *  - i codici mandati a un indirizzo in un'ora si contano in tutto il cluster.
 * Le chiavi sono impronte: niente indirizzi, nomi o codici in Redis. Si usano solo
 * comandi semplici (SET, INCR, PTTL, PEXPIRE, DEL, MULTI), niente script: un Redis
 * gestito che non li ammette non ferma la pagina.
 *
 * Senza Redis configurato (sviluppo, una replica) il registro sta nella memoria
 * del processo. Con Redis configurato ma irraggiungibile non si emette, non si
 * conferma e non si prende niente (`nonDisponibile`): meglio un «riprova» che un
 * codice valido su una replica e sconosciuto sulle altre, o usato due volte. Gli
 * errori di Redis vanno nel log, senza chiavi.
 */

export const TENTATIVI_PER_CODICE = 5;
export const CODICI_PER_ORA = 5;

const DURATA_MS = DURATA_CODICE_MINUTI * 60_000;
const ORA_MS = 3_600_000;
const ATTESA_REDIS_MS = 1000;

/** Le emissioni quando non c'e' Redis: tentativi fatti e scadenza. */
const memoria = new Map<string, { tentativi: number; scade: number }>();

function pulisci(adesso: number): void {
  for (const [k, v] of memoria) if (v.scade <= adesso) memoria.delete(k);
}

const impronta = (...parti: Array<string | number>) =>
  createHash('sha256').update(parti.join('\n')).digest('hex');

function chiaveEmissione(r: RichiestaConfermata, emessoIl: number): string {
  return `gdpr:code:${impronta(r.azione, r.emailHash, r.oggetto, r.impronta, emessoIl)}`;
}

const chiaveInvii = (emailHash: string) => `gdpr:code-sent:${impronta(emailHash)}`;

/** Quanto resta a un codice emesso a quell'ora. */
const restaMs = (emessoIl: number) => emessoIl * 1000 + DURATA_MS - Date.now();

/** Redis pronto a rispondere, `null` senza Redis, `false` se non risponde. */
async function redisPronto() {
  const redis = getRedis();
  if (!redis) return null;
  return (await liveRedisReady(ATTESA_REDIS_MS)) ? redis : false;
}

/** Un comando con la sua scadenza: `null` se Redis rifiuta o non risponde. */
function conScadenza<T>(op: Promise<T>): Promise<T | null> {
  return withDeadline<T | null>(
    op.catch((err: unknown) => {
      // Il messaggio di Redis, mai la chiave: e' gia' un'impronta, ma non serve.
      console.warn(
        '[gdpr/confirmation-store] redis command failed:',
        err instanceof Error ? err.message : String(err)
      );
      return null;
    }),
    ATTESA_REDIS_MS,
    null
  );
}

export type Esito = 'ok' | 'troppi' | 'nonDisponibile';

/**
 * Conta un codice mandato a questo indirizzo: oltre `CODICI_PER_ORA`, no. La
 * finestra riparte a ogni invio: chi insiste aspetta un'ora dall'ultimo.
 */
export async function contaInvio(emailHash: string): Promise<Esito> {
  const redis = await redisPronto();
  if (redis === false) return 'nonDisponibile';
  if (!redis) {
    const rl = rateLimit(chiaveInvii(emailHash), {
      limit: CODICI_PER_ORA,
      windowMs: ORA_MS,
    });
    return rl.allowed ? 'ok' : 'troppi';
  }
  const chiave = chiaveInvii(emailHash);
  const esito = await conScadenza(
    redis.multi().incr(chiave).pexpire(chiave, ORA_MS).exec()
  );
  const [errore, valore] = esito?.[0] ?? [new Error('mancante'), null];
  if (errore) return 'nonDisponibile';
  return Number(valore) > CODICI_PER_ORA ? 'troppi' : 'ok';
}

/** Un invio contato che poi non e' partito non resta nel conto. */
export async function annullaInvio(emailHash: string): Promise<void> {
  const redis = await redisPronto();
  if (redis) await conScadenza(redis.decr(chiaveInvii(emailHash)));
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
    const fatto = await conScadenza(redis.set(chiave, '0', 'PX', DURATA_MS));
    return fatto === 'OK' ? 'ok' : 'nonDisponibile';
  }
  const adesso = Date.now();
  pulisci(adesso);
  memoria.set(chiave, { tentativi: 0, scade: adesso + DURATA_MS });
  return 'ok';
}

export type EsitoTentativo = 'ammesso' | 'sconosciuto' | 'esaurito' | 'nonDisponibile';

/**
 * Conta un tentativo sul codice di questa richiesta, se e' stato mandato.
 * `tentativi`: quanti, questo compreso.
 */
export async function contaTentativo(
  r: RichiestaConfermata,
  emessoIl: number
): Promise<{ esito: EsitoTentativo; tentativi: number }> {
  const chiave = chiaveEmissione(r, emessoIl);
  const redis = await redisPronto();
  if (redis === false) return { esito: 'nonDisponibile', tentativi: 0 };
  let tentativi: number;
  if (redis) {
    // INCR tiene la scadenza di una chiave che c'era; una chiave che nasce qui non
    // ne ha (PTTL -1): l'emissione non c'era, e la chiave nuova se ne va subito.
    const esito = await conScadenza(redis.multi().incr(chiave).pttl(chiave).exec());
    if (!esito || esito.some(([errore]) => errore))
      return { esito: 'nonDisponibile', tentativi: 0 };
    if (Number(esito[1]![1]) < 0) {
      await conScadenza(redis.del(chiave));
      return { esito: 'sconosciuto', tentativi: 0 };
    }
    tentativi = Number(esito[0]![1]);
  } else {
    const adesso = Date.now();
    pulisci(adesso);
    const voce = memoria.get(chiave);
    if (!voce) return { esito: 'sconosciuto', tentativi: 0 };
    voce.tentativi += 1;
    tentativi = voce.tentativi;
  }
  return { esito: tentativi > TENTATIVI_PER_CODICE ? 'esaurito' : 'ammesso', tentativi };
}

/**
 * Prende il codice per la modifica: vero solo per la richiesta che lo toglie dal
 * registro. Due richieste con lo stesso codice giusto non fanno la modifica due
 * volte.
 */
export async function prendiEmissione(
  r: RichiestaConfermata,
  emessoIl: number
): Promise<boolean | 'nonDisponibile'> {
  const chiave = chiaveEmissione(r, emessoIl);
  const redis = await redisPronto();
  if (redis === false) return 'nonDisponibile';
  if (redis) {
    const tolte = await conScadenza(redis.del(chiave));
    return tolte === null ? 'nonDisponibile' : tolte === 1;
  }
  return memoria.delete(chiave);
}

/**
 * La modifica non e' andata a buon fine: il codice torna valido per il tempo che
 * gli resta, con i tentativi gia' fatti.
 */
export async function restituisciEmissione(
  r: RichiestaConfermata,
  emessoIl: number,
  tentativi: number
): Promise<void> {
  const resta = restaMs(emessoIl);
  if (resta <= 0) return;
  const chiave = chiaveEmissione(r, emessoIl);
  const redis = await redisPronto();
  if (redis) {
    await conScadenza(redis.set(chiave, String(tentativi), 'PX', resta, 'NX'));
  } else if (redis === null) {
    memoria.set(chiave, { tentativi, scade: Date.now() + resta });
  }
}
