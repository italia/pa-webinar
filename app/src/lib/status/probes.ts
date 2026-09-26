/**
 * Sonde HTTP della pagina di stato, della mappa dell'infrastruttura e del
 * pannello di amministrazione.
 *
 * Due regole valgono per tutte.
 *
 * Una sonda che fallisce dice PERCHÉ: il codice dell'errore di rete (un
 * certificato che il server dell'applicazione non riconosce, un nome che non
 * si risolve, un tempo scaduto) finisce nel dettaglio invece di sparire in un
 * `catch` muto. Chi legge «non disponibile» senza motivo non sa da dove
 * cominciare.
 *
 * Una sonda non si moltiplica con chi guarda: la sala live interroga
 * `/api/status` ogni pochi secondi per ogni partecipante, e le pagine di stato
 * aperte interrogano la mappa. Gli esiti restano in memoria per qualche
 * secondo, e chi arriva mentre una sonda è in volo aspetta quella invece di
 * lanciarne un'altra.
 */

/** Perché una sonda non è andata a buon fine. */
export type ProbeFailure = 'http' | 'tls' | 'dns' | 'timeout' | 'network';

export interface ProbeResult {
  ok: boolean;
  responseMs: number;
  /** Lo stato HTTP, quando il server ha risposto. */
  httpStatus?: number;
  failure?: ProbeFailure;
  /** Il codice leggibile da un operatore: `HTTP 503`, `ENOTFOUND`, `DEPTH_ZERO_SELF_SIGNED_CERT`… */
  code?: string;
}

/** Quanto resta valido l'esito di una sonda. */
export const PROBE_CACHE_TTL_MS = 5_000;

interface CacheEntry {
  createdAt: number;
  promise: Promise<unknown>;
}

const cache = new Map<string, CacheEntry>();

/**
 * L'esito di `fn` sotto la chiave `key`, riusato per `ttlMs`. Chi chiede
 * mentre la sonda è in volo riceve la stessa promessa. Un orologio che torna
 * indietro (i test lo fanno) invalida la voce invece di tenerla per sempre.
 */
export function cachedProbe<T>(key: string, fn: () => Promise<T>, ttlMs = PROBE_CACHE_TTL_MS): Promise<T> {
  const now = Date.now();
  const entry = cache.get(key);
  if (entry && entry.createdAt <= now && now - entry.createdAt < ttlMs) {
    return entry.promise as Promise<T>;
  }
  const promise = fn();
  cache.set(key, { createdAt: now, promise });
  // Una promessa rifiutata non si tiene: la prossima richiesta riprova.
  promise.catch(() => {
    if (cache.get(key)?.promise === promise) cache.delete(key);
  });
  return promise;
}

/** Solo per i test: dimentica gli esiti in memoria. */
export function __resetProbeCache(): void {
  cache.clear();
}

const TLS_CODE = /CERT|SELF_SIGNED|^ERR_TLS|^ERR_SSL|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|HOSTNAME_MISMATCH|ALTNAME/;
const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL', 'EAI_NONAME']);
const TIMEOUT_CODES = new Set(['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT']);

function errorCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && code ? code : undefined;
}

/**
 * Classifica l'errore di un `fetch` di Node. Il codice vero sta nella `cause`
 * (a volte annidata: un errore aggregato di più indirizzi), il nome
 * `TimeoutError` nell'errore di `AbortSignal.timeout`.
 */
export function classifyFetchError(err: unknown): { failure: ProbeFailure; code: string } {
  if (err && typeof err === 'object' && (err as { name?: unknown }).name === 'TimeoutError') {
    return { failure: 'timeout', code: 'TIMEOUT' };
  }
  let code: string | undefined;
  let cur: unknown = err;
  for (let depth = 0; depth < 4 && cur && !code; depth += 1) {
    code = errorCode(cur);
    const cause: unknown = (cur as { cause?: unknown }).cause;
    if (!code && cause && typeof cause === 'object') {
      const errors = (cause as { errors?: unknown }).errors;
      if (Array.isArray(errors) && errors.length > 0) code = errorCode(errors[0]);
    }
    cur = cause;
  }
  if (!code) return { failure: 'network', code: 'FETCH_FAILED' };
  if (TLS_CODE.test(code)) return { failure: 'tls', code };
  if (DNS_CODES.has(code)) return { failure: 'dns', code };
  if (TIMEOUT_CODES.has(code)) return { failure: 'timeout', code };
  return { failure: 'network', code };
}

export interface ProbeOptions {
  timeoutMs?: number;
  method?: 'GET' | 'HEAD';
  /** Quali stati HTTP contano come «risponde». Default: 2xx. */
  accept?: (status: number) => boolean;
}

/** Una richiesta HTTP che non lancia mai: dice com'è andata. */
export async function probeHttp(url: string, opts: ProbeOptions = {}): Promise<ProbeResult> {
  const { timeoutMs = 3_000, method = 'GET', accept = (s: number) => s >= 200 && s < 300 } = opts;
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method,
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
    const responseMs = Date.now() - start;
    // Il corpo non serve: chiuderlo libera la connessione.
    await res.body?.cancel().catch(() => undefined);
    if (accept(res.status)) return { ok: true, responseMs, httpStatus: res.status };
    return { ok: false, responseMs, httpStatus: res.status, failure: 'http', code: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, responseMs: Date.now() - start, ...classifyFetchError(err) };
  }
}

/** Toglie la barra finale da un indirizzo di base. */
export function baseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}
