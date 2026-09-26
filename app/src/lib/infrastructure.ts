import { jvbMaxReplicasFromEnv } from '@/lib/jvb-sizing';
import { resolveProviderType } from '@/lib/storage/provider-type';

/**
 * Lo storage delle registrazioni e' configurato, con la stessa regola della
 * factory che poi ci scrive (lib/storage/provider-type): il tipo esplicito
 * oppure le credenziali del fornitore. Guardare solo RECORDING_STORAGE_TYPE
 * dichiarava «non configurato» un'installazione che si affida al rilevamento
 * automatico, e la sala mostrava la registrazione come mai disponibile.
 */
export function recordingStorageConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return resolveProviderType('recordings', env) !== null;
}

/**
 * Se questa installazione si aspetta Jibri: se la sala e le pagine di stato,
 * quando la sua API di salute non risponde, devono dire «in avvio» e poi «non
 * partito» invece di «non configurato». Vale quando lo storage delle
 * registrazioni è dichiarato con RECORDING_STORAGE_TYPE (e la factory lo
 * risolve): è l'impostazione che accompagna Jibri.
 *
 * Le sole credenziali dello storage non bastano: servono anche al registratore
 * per partecipante e alle pubblicazioni manuali, su installazioni che Jibri non
 * lo hanno. Né basta JIBRI_HEALTH_URL, che il chart imposta a ogni
 * installazione con Jitsi, anche a Jibri spento. Contarle farebbe segnalare, a
 * ogni evento con la registrazione accesa, un registratore degradato e poi
 * «non partito» dove non ce n'è nessuno.
 */
export function jibriRecordingExpected(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const dichiarato = env.RECORDING_STORAGE_TYPE;
  return !!dichiarato && dichiarato !== 'local' && recordingStorageConfigured(env);
}

/**
 * Il nome dello storage delle registrazioni da mostrare accanto a
 * `recordingStorageConfigured()`, con la stessa regola: il valore di
 * RECORDING_STORAGE_TYPE quando e' uno di quelli che la factory riconosce
 * (dice di piu': minio, gcs), altrimenti il fornitore rilevato dalle
 * credenziali, altrimenti il valore grezzo o `not-configured`.
 */
export function recordingStorageLabel(
  env: Record<string, string | undefined> = process.env,
): string {
  const dichiarato = env.RECORDING_STORAGE_TYPE || '';
  const rilevato = resolveProviderType('recordings', env);
  if (!rilevato) return dichiarato || 'not-configured';
  const riconosciuto =
    resolveProviderType('recordings', { RECORDING_STORAGE_TYPE: dichiarato }) !== null;
  return riconosciuto ? dichiarato : rilevato;
}

/**
 * Se i bridge si accendono e si spengono da soli: lo dice JVB_SCALER_ENABLED,
 * che il chart scrive nella ConfigMap dell'applicazione (vero quando rende lo
 * scaler, oppure impostato a mano da chi scala i bridge con un altro
 * strumento). JVB_MAX_REPLICAS non basta: è un tetto, e lo imposta a 1 anche
 * un'installazione con un solo bridge fisso e nessuno scaler.
 */
export function jvbScalerEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.JVB_SCALER_ENABLED === 'true';
}

let jibriAvailable: boolean | null = null;
let jibriCheckExpiry = 0;

export async function isJibriAvailable(): Promise<boolean> {
  if (jibriAvailable !== null && Date.now() < jibriCheckExpiry) {
    return jibriAvailable;
  }

  jibriAvailable = jibriRecordingExpected();
  jibriCheckExpiry = Date.now() + 300_000;

  return jibriAvailable;
}

export type DeploymentMode = 'simple' | 'standard' | 'full' | 'unknown';

/**
 * Il profilo d'installazione. Il chart lo scrive in `DEPLOY_PROFILE` (dal
 * valore `jitsi.mode`); senza (Docker Compose, chart precedenti) si deduce
 * come prima: fuori da Kubernetes è «simple», dentro dipende dal tetto dei
 * bridge — una stima che non distingue un profilo semplice da uno standard.
 */
export function deploymentMode(env: Record<string, string | undefined> = process.env): DeploymentMode {
  const dichiarato = env.DEPLOY_PROFILE?.trim().toLowerCase();
  if (dichiarato === 'simple' || dichiarato === 'standard' || dichiarato === 'full') return dichiarato;
  if (env.KUBERNETES_SERVICE_HOST) {
    const maxReplicas = parseInt(env.JVB_MAX_REPLICAS || '0', 10);
    return maxReplicas > 1 ? 'full' : 'standard';
  }
  return 'simple';
}

/**
 * Se il database è quello incluso nell'installazione (il PostgreSQL del chart,
 * il servizio di Docker Compose) o uno esterno. Il chart lo dichiara in
 * `DATABASE_BUNDLED`; senza, lo dice il nome dell'host: un nome di servizio
 * senza dominio che contiene «postgres».
 */
export function databaseBundled(env: Record<string, string | undefined> = process.env): boolean {
  const dichiarato = env.DATABASE_BUNDLED?.trim().toLowerCase();
  if (dichiarato === 'true') return true;
  if (dichiarato === 'false') return false;
  try {
    const host = new URL(env.DATABASE_URL || '').hostname;
    return host.includes('postgres') && !host.includes('.');
  } catch {
    return false;
  }
}

export interface InfrastructureInfo {
  deployment: {
    mode: DeploymentMode;
    /** Dentro un cluster Kubernetes o no (Docker Compose, server singolo). */
    platform: 'kubernetes' | 'other';
    /** La versione del build; vuota quando l'immagine non la dichiara. */
    version: string;
    nodeEnv: string;
  };
  database: {
    type: 'internal' | 'external';
    host: string;
    connected: boolean;
  };
  jitsi: {
    domain: string;
    reachable: boolean;
    /** Il peggiore fra la sala web e Prosody, come li vede /api/status. */
    status: 'operational' | 'degraded' | 'outage' | 'unknown';
    /** Il motivo di un esito non operativo: `HTTP 503`, il codice dell'errore… */
    detail: string | null;
    /** La sola verifica possibile è sull'indirizzo pubblico, e fallisce per certificato o nome. */
    publicCheckFailed: boolean;
    jwtConfigured: boolean;
  };
  jvb: {
    /** Chi accende i bridge: lo scaler, nessuno (bridge fissi), o non si sa. */
    mode: 'scaler' | 'fixed' | 'unmonitored';
    /** Con lo scaler: i bridge che gli eventi chiedono ora. Fissi: quelli previsti. */
    desiredReplicas: number;
    /** I bridge che rispondono; null se non si possono interrogare. */
    runningReplicas: number | null;
    maxReplicas: number;
    preScaleMinutes: number;
    scalerEnabled: boolean;
  };
  jibri: {
    available: boolean;
    storageType: string;
    storageConfigured: boolean;
  };
  email: {
    provider: string;
    configured: boolean;
  };
  storage: {
    recordings: string;
  };
  features: {
    statusPage: boolean;
    guestAccess: boolean;
    metricsEndpoint: boolean;
  };
}

function inferEmailProvider(host: string): string {
  if (!host) return 'none';
  const h = host.toLowerCase();
  if (h.includes('mailgun')) return 'Mailgun';
  if (h.includes('sendgrid')) return 'SendGrid';
  if (h.includes('communication.azure')) return 'Azure Communication Services';
  if (h.includes('ses.')) return 'Amazon SES';
  if (h.includes('mailpit') || h.includes('localhost')) return 'Mailpit (dev)';
  return 'SMTP';
}

export async function getInfrastructureInfo(): Promise<InfrastructureInfo> {
  // Import dinamici: questo modulo lo importano anche superfici leggere (la
  // sala live, la disponibilità della registrazione) che non devono tirarsi
  // dietro database, impostazioni e sonde.
  const [
    { prisma },
    { getSettings },
    { getPublicEnv },
    { getJitsiHealth, worstJitsiStatus },
    bridge,
    { readJvbSnapshot },
  ] = await Promise.all([
    import('@/lib/db'),
    import('@/lib/settings'),
    import('@/lib/env'),
    import('@/lib/status/jitsi-health'),
    import('@/lib/status/bridge'),
    import('@/lib/jvb-snapshot'),
  ]);

  let dbHost = '';
  try {
    dbHost = new URL(process.env.DATABASE_URL || '').hostname;
  } catch {
    // invalid URL
  }

  let dbConnected = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbConnected = true;
  } catch {
    // can't connect
  }

  const settings = await getSettings();
  const mode = bridge.bridgeMode();
  const [jitsi, demand, colibri, snapshot] = await Promise.all([
    getJitsiHealth(),
    mode === 'scaler' ? bridge.loadJvbDemand(settings, new Date()) : Promise.resolve(null),
    mode === 'unmonitored' ? Promise.resolve(null) : bridge.fetchColibriStats(),
    mode === 'scaler' ? readJvbSnapshot() : Promise.resolve(null),
  ]);

  // La sala è raggiungibile se lo sono la pagina web e Prosody (BOSH).
  const jitsiStatus = worstJitsiStatus(jitsi.web.status, jitsi.prosody.status);
  const jitsiDetail =
    [jitsi.web, jitsi.prosody].find((c) => c.status !== 'operational' && c.details)?.details ?? null;
  const bridgeAnswers = colibri !== null && colibri.healthy !== false;
  // Con lo scaler il tetto; senza, il numero di bridge fissi (il chart lo
  // scrive nella stessa variabile).
  const maxReplicas = jvbMaxReplicasFromEnv();
  let desiredReplicas = 0;
  let runningReplicas: number | null = null;
  if (mode === 'scaler') {
    desiredReplicas = demand?.desired ?? 0;
    runningReplicas = snapshot ? snapshot.ready : bridgeAnswers ? 1 : 0;
  } else if (mode === 'fixed') {
    desiredReplicas = maxReplicas;
    runningReplicas = bridgeAnswers ? 1 : 0;
  }

  const smtpHost = process.env.SMTP_HOST || '';
  const storageType = recordingStorageLabel();

  return {
    deployment: {
      mode: deploymentMode(),
      platform: process.env.KUBERNETES_SERVICE_HOST ? 'kubernetes' : 'other',
      version: getPublicEnv('NEXT_PUBLIC_BUILD_VERSION'),
      nodeEnv: process.env.NODE_ENV || 'development',
    },
    database: {
      type: databaseBundled() ? 'internal' : 'external',
      host: dbHost,
      connected: dbConnected,
    },
    jitsi: {
      domain: jitsi.domain,
      reachable: jitsiStatus === 'operational' || jitsiStatus === 'degraded',
      status: jitsiStatus,
      detail: jitsiDetail,
      publicCheckFailed: !!(jitsi.web.publicCheckFailed || jitsi.prosody.publicCheckFailed),
      jwtConfigured: !!(process.env.JITSI_JWT_SECRET || process.env.JWT_SECRET),
    },
    jvb: {
      mode,
      desiredReplicas,
      runningReplicas,
      maxReplicas,
      preScaleMinutes: settings.jvbPreScaleMinutes ?? 10,
      scalerEnabled: mode === 'scaler',
    },
    jibri: {
      available: await isJibriAvailable(),
      storageType,
      storageConfigured: jibriRecordingExpected(),
    },
    email: {
      provider: inferEmailProvider(smtpHost),
      configured: !!smtpHost,
    },
    storage: {
      recordings: storageType,
    },
    features: {
      statusPage: settings.statusPageEnabled !== false,
      guestAccess: getPublicEnv('NEXT_PUBLIC_GUEST_ACCESS') !== 'false',
      metricsEndpoint: process.env.METRICS_ENABLED !== 'false',
    },
  };
}
