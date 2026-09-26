/**
 * Simple in-memory rate limiter for API routes.
 *
 * Not suitable for multi-instance deployments — each pod has its own
 * state. Global per-IP limits, where wanted, belong to the ingress
 * (NGINX `limit-*` annotations, off by default in the chart). This
 * in-memory limiter still protects per-user/per-action limits (e.g. Q&A
 * submission cooldowns) where approximate enforcement per pod is
 * acceptable.
 */

import { isIP } from 'node:net';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();
const MAX_STORE_SIZE = 50_000;

const CLEANUP_INTERVAL_MS = 60_000;
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) {
      store.delete(key);
    }
  }
  // Evict oldest entries if store exceeds max size
  if (store.size > MAX_STORE_SIZE) {
    const excess = store.size - MAX_STORE_SIZE;
    const iter = store.keys();
    for (let i = 0; i < excess; i++) {
      const key = iter.next().value;
      if (key) store.delete(key);
    }
  }
}

interface RateLimitOptions {
  /** Maximum number of requests in the window. */
  limit: number;
  /** Window duration in milliseconds. */
  windowMs: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function rateLimit(
  key: string,
  { limit, windowMs }: RateLimitOptions,
): RateLimitResult {
  cleanup();

  const now = Date.now();
  const entry = store.get(key);

  if (!entry || entry.resetAt <= now) {
    const resetAt = now + windowMs;
    store.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt };
  }

  entry.count += 1;

  if (entry.count > limit) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  return {
    allowed: true,
    remaining: limit - entry.count,
    resetAt: entry.resetAt,
  };
}

// ── Indirizzo del client ─────────────────────────────────────────────

/** Chiave condivisa quando l'indirizzo non è determinabile. */
const UNKNOWN_CLIENT = 'unknown';

/** Oltre questo valore `TRUSTED_PROXY_HOPS` è quasi certamente un errore. */
const MAX_TRUSTED_PROXY_HOPS = 10;

let invalidHopsWarned = false;

/**
 * Quante voci di `X-Forwarded-For` l'infrastruttura fidata aggiunge DOPO
 * quella del client, cioè alla sua destra. Si configura con
 * `TRUSTED_PROXY_HOPS`, letta lato server a ogni chiamata.
 *
 * Default 0: la voce più a destra, scritta dall'ingress, è il client. È il
 * caso di ingress-nginx e di Traefik con le impostazioni di fabbrica
 * (sostituiscono l'header con l'indirizzo della connessione) e dell'accesso
 * diretto al Service (port-forward, compose senza proxy), dove il server di
 * Next.js riempie l'header con l'indirizzo del socket se manca.
 *
 * Di norma ogni proxy fidato davanti all'ingress che accoda all'header
 * (bilanciatore, WAF, CDN, reverse proxy dell'ente) aggiunge una voce: +1
 * ciascuno. Fa eccezione l'Application Load Balancer di Google Cloud, anche
 * quando fa da ingress su GKE (classi `gce` e `gce-internal`): accoda due
 * voci, `<client>,<indirizzo del bilanciatore>`, quindi come ingress vale 1
 * e davanti a un ingress che accoda vale 2. Con 0 tutti i client finirebbero
 * nel contatore dell'indirizzo del bilanciatore.
 *
 * Il conteggio parte da 0 come `xff_num_trusted_hops` di Envoy, non da 1
 * come `trust proxy` di Express, che conta anche l'ingress. Un valore troppo
 * alto, con un ingress che accoda, lascia scegliere la chiave al client; uno
 * troppo basso fa condividere a tutti il contatore dell'ultimo proxy.
 *
 * Un valore non valido vale 0: nel dubbio si usa la voce scritta dal proxy
 * più vicino, che il client non può scegliere. Il peggio che succede è che
 * i client dietro lo stesso proxy condividano un contatore.
 */
export function trustedProxyHops(): number {
  const raw = process.env.TRUSTED_PROXY_HOPS?.trim();
  if (!raw) return 0;
  if (/^\d{1,2}$/.test(raw)) {
    const hops = Number(raw);
    if (hops <= MAX_TRUSTED_PROXY_HOPS) return hops;
  }
  if (!invalidHopsWarned) {
    invalidHopsWarned = true;
    console.warn(
      `[rate-limit] TRUSTED_PROXY_HOPS="${raw}" non valido (intero da 0 a ${MAX_TRUSTED_PROXY_HOPS}): uso 0`,
    );
  }
  return 0;
}

/**
 * Riduce una voce di `X-Forwarded-For` a un indirizzo IP canonico, o null.
 *
 * Accetta le forme che i proxy scrivono davvero: IPv4, IPv6, IPv4 con porta
 * (`198.51.100.7:51234`, come fanno alcuni application gateway) e IPv6 tra
 * quadre con o senza porta (`[2001:db8::1]:443`). Un IPv6 nudo non ha porta:
 * `2001:db8::1:443` è un indirizzo valido e resta com'è. L'IPv4 mappato in
 * IPv6 (`::ffff:192.0.2.1`, tipico dei socket dual-stack) torna IPv4, così lo
 * stesso client non finisce in due contatori. Tutto il resto — `unknown`,
 * identificatori offuscati RFC 7239 (`_hidden`), nomi host, testo arbitrario —
 * è null: una stringa scelta dal client non deve mai diventare una chiave.
 */
function normalizeIp(entry: string): string | null {
  let candidate = entry.trim();
  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(candidate);
  if (bracketed?.[1]) {
    candidate = bracketed[1];
    if (isIP(candidate) !== 6) return null;
  } else {
    const withPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/.exec(candidate);
    if (withPort?.[1]) candidate = withPort[1];
  }
  const version = isIP(candidate);
  if (version === 4) return candidate;
  if (version !== 6) return null;
  const lower = candidate.toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
  if (mapped?.[1] && isIP(mapped[1]) === 4) return mapped[1];
  return lower;
}

/**
 * Indirizzo del client da usare come chiave dei limiti per IP (e nel
 * registro delle azioni di amministrazione).
 *
 * Si legge SOLO `X-Forwarded-For`, contando da destra: ogni proxy aggiunge
 * in coda l'indirizzo da cui ha ricevuto la connessione, quindi le voci a
 * destra le scrivono i proxy fidati e quelle a sinistra le può scrivere
 * chiunque. Con `TRUSTED_PROXY_HOPS = N` (le voci che l'infrastruttura
 * fidata aggiunge dopo quella del client, vedi `trustedProxyHops`) si prende
 * la voce (N+1)-esima da destra: con N = 0 l'ultima, scritta dall'ingress;
 * con N = 1 la penultima, per esempio quella scritta da un bilanciatore
 * davanti all'ingress; e così via. La voce più a sinistra, invece, la sceglie
 * il client ogni volta che l'ingress accoda invece di sostituire (Traefik con
 * `forwardedHeaders.trustedIPs`, ingress-nginx con `use-forwarded-headers` e
 * `compute-full-forwarded-for`, l'Application Load Balancer di Google Cloud):
 * usarla come chiave permetterebbe di aggirare ogni limite ruotando un valore
 * inventato.
 *
 * Se l'header ha meno di N + 1 voci si prende la prima. Con un ingress che
 * sostituisce l'header (ingress-nginx e Traefik di default) l'unica voce è
 * quella scritta dall'ingress, quindi un N più alto del necessario non fa
 * danni. Con un ingress che accoda, invece, N deve corrispondere esattamente
 * alla catena — con un'unità in più la voce scelta è una di quelle scritte
 * dal client — e la catena non deve poter essere scavalcata: una richiesta
 * che arriva all'ingress senza passare dai proxy davanti porta meno voci
 * fidate, e la prima può averla scritta il client.
 *
 * Non si leggono `X-Real-IP`, `CF-Connecting-IP` né `Forwarded`: ingress-nginx
 * lascia passare gli ultimi due come li manda il client, e Traefik fa passare
 * `X-Real-Ip` da una sorgente fidata. Non servono nemmeno come ripiego: il
 * server di Next.js scrive `X-Forwarded-For` con l'indirizzo del socket quando
 * la richiesta non lo porta.
 *
 * Una voce scelta che non è un indirizzo IP dà `unknown`, mai la stringa
 * stessa. **Nota:** tutte le richieste senza indirizzo condividono lo stesso
 * contatore — il modo di fallire più sicuro, perché un attacco a forza bruta
 * non ottiene mai un contatore nuovo, a costo di rallentare anche gli altri.
 *
 * Nessuna configurazione dell'app rende sicuro l'accesso diretto al Service
 * esposto su Internet (NodePort, LoadBalancer sul Service): lì l'header lo
 * scrive per intero il client. Il portale va esposto solo dietro un ingress.
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (!forwarded) return UNKNOWN_CLIENT;
  const entries = forwarded.split(',');
  const index = Math.max(0, entries.length - 1 - trustedProxyHops());
  return normalizeIp(entries[index] ?? '') ?? UNKNOWN_CLIENT;
}
