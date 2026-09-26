/**
 * Lo stato dei componenti di Jitsi (sala web, Prosody, Jicofo), letto dove
 * girano.
 *
 * Con Jitsi incluso nel chart (e in Docker Compose), l'applicazione riceve gli
 * indirizzi interni dei tre servizi (`JITSI_WEB_INTERNAL_URL`,
 * `PROSODY_INTERNAL_URL`, `JICOFO_HEALTH_URL`) e li interroga direttamente:
 * ognuno ha il suo stato.
 * Interrogare l'indirizzo PUBBLICO della sala dal server dell'applicazione
 * misura altro — il certificato dell'ingresso, la risoluzione del nome, il
 * giro dal cluster verso il proprio bilanciatore — e su un certificato
 * autofirmato o di una CA interna falliva sempre, mentre le conferenze
 * funzionavano.
 *
 * Senza indirizzi interni (un Jitsi esterno) resta la sonda
 * sull'indirizzo pubblico. Lì un errore di certificato o di nome è
 * «degradato» con il codice dell'errore nel dettaglio, mai un'interruzione:
 * dice che il server dell'applicazione non riesce a verificare la sala, non
 * che la sala è giù. Jicofo non ha un indirizzo pubblico: senza il suo
 * indirizzo interno il suo stato è «non monitorato».
 */

import { getPublicEnv } from '@/lib/env';

import { baseUrl, cachedProbe, probeHttp, type ProbeResult } from './probes';

/** Il vocabolario di `/api/status`. */
export type JitsiComponentStatus = 'operational' | 'degraded' | 'outage' | 'unknown';

export interface JitsiComponentHealth {
  status: JitsiComponentStatus;
  responseMs: number | null;
  /** Il motivo, per chi legge: `HTTP 503`, il codice dell'errore, `Not monitored`. */
  details?: string;
  /** Da dove viene l'esito. */
  via: 'internal' | 'public' | 'none';
  /** L'esito viene dall'indirizzo pubblico e fallisce per certificato o nome. */
  publicCheckFailed?: boolean;
}

export interface JitsiHealth {
  /** Il dominio pubblico della sala, come lo vedono i browser. */
  domain: string;
  web: JitsiComponentHealth;
  prosody: JitsiComponentHealth;
  jicofo: JitsiComponentHealth;
}

type Env = Record<string, string | undefined>;

/** Oltre questa latenza un componente che risponde è «rallentato». */
const SLOW_INTERNAL_MS = 1_500;
const SLOW_PUBLIC_MS = 3_000;

const INTERNAL_TIMEOUT_MS = 3_000;
const PUBLIC_TIMEOUT_MS = 5_000;

/** BOSH risponde 200 a un GET; un proxy che accetta solo POST dà 405. */
const BOSH_ACCEPT = (s: number) => (s >= 200 && s < 300) || s === 405;

function publicBase(domain: string): string {
  const protocol = domain.includes('localhost') ? 'http' : 'https';
  return `${protocol}://${domain}`;
}

function fromInternal(result: ProbeResult): JitsiComponentHealth {
  if (result.ok) {
    return {
      status: result.responseMs > SLOW_INTERNAL_MS ? 'degraded' : 'operational',
      responseMs: result.responseMs,
      via: 'internal',
    };
  }
  // Ha risposto con un errore: il servizio c'è, ma non sta bene.
  if (result.failure === 'http') {
    return { status: 'degraded', responseMs: result.responseMs, details: result.code, via: 'internal' };
  }
  return { status: 'outage', responseMs: result.responseMs, details: result.code, via: 'internal' };
}

function fromPublic(result: ProbeResult): JitsiComponentHealth {
  if (result.ok) {
    return {
      status: result.responseMs > SLOW_PUBLIC_MS ? 'degraded' : 'operational',
      responseMs: result.responseMs,
      via: 'public',
    };
  }
  if (result.failure === 'http') {
    return { status: 'degraded', responseMs: result.responseMs, details: result.code, via: 'public' };
  }
  // Certificato non riconosciuto o nome non risolto dal server
  // dell'applicazione: la sala può funzionare benissimo per i browser.
  if (result.failure === 'tls' || result.failure === 'dns') {
    return {
      status: 'degraded',
      responseMs: result.responseMs,
      details: result.code,
      via: 'public',
      publicCheckFailed: true,
    };
  }
  return { status: 'outage', responseMs: result.responseMs, details: result.code, via: 'public' };
}

async function probeWeb(env: Env, domain: string): Promise<JitsiComponentHealth> {
  const internal = env.JITSI_WEB_INTERNAL_URL;
  if (internal) {
    return fromInternal(
      await probeHttp(`${baseUrl(internal)}/external_api.js`, { timeoutMs: INTERNAL_TIMEOUT_MS }),
    );
  }
  if (!domain) return { status: 'unknown', responseMs: null, details: 'Not configured', via: 'none' };
  return fromPublic(
    await probeHttp(`${publicBase(domain)}/external_api.js`, { timeoutMs: PUBLIC_TIMEOUT_MS }),
  );
}

async function probeProsody(env: Env, domain: string): Promise<JitsiComponentHealth> {
  const internal = env.PROSODY_INTERNAL_URL;
  if (internal) {
    return fromInternal(
      await probeHttp(`${baseUrl(internal)}/http-bind`, {
        timeoutMs: INTERNAL_TIMEOUT_MS,
        accept: BOSH_ACCEPT,
      }),
    );
  }
  if (!domain) return { status: 'unknown', responseMs: null, details: 'Not configured', via: 'none' };
  // BOSH attraverso la sala web: arriva fino a Prosody.
  return fromPublic(
    await probeHttp(`${publicBase(domain)}/http-bind`, {
      timeoutMs: PUBLIC_TIMEOUT_MS,
      accept: BOSH_ACCEPT,
    }),
  );
}

async function probeJicofo(env: Env): Promise<JitsiComponentHealth> {
  const internal = env.JICOFO_HEALTH_URL;
  if (!internal) return { status: 'unknown', responseMs: null, details: 'Not monitored', via: 'none' };
  // /about/health risponde solo con i controlli di salute di Jicofo accesi
  // (spenti nell'immagine ufficiale): /about/version risponde sempre.
  return fromInternal(
    await probeHttp(`${baseUrl(internal)}/about/version`, { timeoutMs: INTERNAL_TIMEOUT_MS }),
  );
}

/**
 * Lo stato dei tre componenti, riusato per qualche secondo
 * (`cachedProbe`): la sala live e le pagine di stato lo chiedono spesso.
 */
export function getJitsiHealth(env: Env = process.env): Promise<JitsiHealth> {
  // Letto a runtime: in notazione puntata il valore resterebbe quello del build.
  const domain = env === process.env
    ? getPublicEnv('NEXT_PUBLIC_JITSI_DOMAIN')
    : (env.NEXT_PUBLIC_JITSI_DOMAIN ?? '');
  const key = [
    'jitsi',
    domain,
    env.JITSI_WEB_INTERNAL_URL ?? '',
    env.PROSODY_INTERNAL_URL ?? '',
    env.JICOFO_HEALTH_URL ?? '',
  ].join('|');
  return cachedProbe(key, async () => {
    const [web, prosody, jicofo] = await Promise.all([
      probeWeb(env, domain),
      probeProsody(env, domain),
      probeJicofo(env),
    ]);
    return { domain, web, prosody, jicofo };
  });
}

/** Il peggiore fra due stati, nell'ordine interruzione > rallentato > operativo > ignoto. */
export function worstJitsiStatus(a: JitsiComponentStatus, b: JitsiComponentStatus): JitsiComponentStatus {
  const rank: Record<JitsiComponentStatus, number> = { outage: 3, degraded: 2, operational: 1, unknown: 0 };
  return rank[a] >= rank[b] ? a : b;
}
