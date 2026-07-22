/**
 * Entrypoint del multitrack recorder (ADR-013, Fase 3).
 *
 * Orchestrazione (tutta logica determinabile è delegata ai moduli puri):
 *   1. legge la config dall'env (solo id + come raggiungere il portale);
 *   2. RECLAMA il work-order dal portale → JWT bot + nome stanza (`claim.ts`);
 *   3. entra nella stanza Jitsi come bot receive-only invisibile e registra
 *      UNA traccia audio per partecipante (`capture.ts` — WebRTC, Jitsi reale);
 *   4. costruisce il manifest `tracks.json` (`manifest.ts` — puro);
 *   5. carica tracce + manifest allo storage (presign per-traccia, `upload.ts`);
 *   6. ingesta al portale (`multitrack-manifest`).
 *
 * Avvio: dall'operator `recorder-controller` (K8s Job o container Docker), che
 * passa solo RECORDING_ID/EVENT_ID + l'accesso al portale. Vedi README.
 */

import { join } from 'node:path';

import { captureRoom, type CaptureConfig } from './capture.js';
import { buildManifest, type ManifestTrack } from './manifest.js';
import { localTrackFilename } from './paths.js';
import { claimWorkOrder } from './claim.js';
import {
  PresignStorageProvider,
  uploadRecording,
  buildIngestBody,
  notifyPortal,
  type LocalTrackFile,
} from './upload.js';

interface RecorderEnv {
  jitsiDomain: string;
  recordingId: string;
  eventId: string;
  portalUrl: string;
  cronApiKey: string;
  outputDir: string;
  /** Credenziali del bot sul dominio nascosto di Prosody. Opzionali: senza,
   *  si entra col JWT del portale (e il bot resta VISIBILE in stanza). */
  xmppUser?: string;
  xmppPassword?: string;
  idleTimeoutSec?: number;
  initialGraceSec?: number;
  maxDurationSec?: number;
}

function readIntEnv(name: string): number | undefined {
  const v = process.env[name];
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`variabile d'ambiente mancante: ${name}`);
  }
  return v;
}

/**
 * JID completo del bot sul dominio nascosto.
 *
 * L'utente arriva dal Secret già usato da Jibri (`JIBRI_RECORDER_USER`, di
 * norma la sola parte locale "recorder") mentre il dominio è un valore del
 * chart: comporli qui evita di duplicare un Secret solo per aggiungere una
 * chiocciola. Un JID già completo passa invariato.
 */
export function recorderJid(
  user: string | undefined,
  domain: string | undefined
): string | undefined {
  const u = user?.trim();
  if (!u) return undefined;
  if (u.includes('@')) return u;
  const d = domain?.trim();
  return d ? `${u}@${d}` : undefined;
}

/**
 * Vale la pena rientrare col JWT del portale?
 *
 * Solo se si era scelto il dominio nascosto E non si e' mai entrati in
 * conferenza. Una stanza rimasta vuota entra e non registra nulla: e' normale,
 * e ritentare la farebbe solo rioccupare, stavolta con un bot visibile.
 */
export function shouldRetryWithJwt(
  joinedConference: boolean,
  xmppUser: string | undefined,
): boolean {
  return !joinedConference && !!xmppUser;
}

function readEnv(): RecorderEnv {
  return {
    jitsiDomain: requireEnv('JITSI_DOMAIN'),
    recordingId: requireEnv('RECORDING_ID'),
    eventId: requireEnv('EVENT_ID'),
    portalUrl: requireEnv('PORTAL_URL').replace(/\/+$/, ''),
    cronApiKey: requireEnv('CRON_API_KEY'),
    outputDir: process.env.OUTPUT_DIR ?? '/recordings',
    // Entrambe o nessuna: una sola delle due è una configurazione a metà, e
    // fallire il login lascerebbe l'evento senza registrazione. Meglio il
    // fallback esplicito sul JWT.
    xmppUser: recorderJid(process.env.JITSI_XMPP_USER, process.env.JITSI_XMPP_DOMAIN),
    xmppPassword: process.env.JITSI_XMPP_PASSWORD || undefined,
    // Quanto il bot resta in stanza vuota prima di chiudere (default 90s in
    // capture.ts). Configurabile per dare tempo ai partecipanti di entrare.
    idleTimeoutSec: readIntEnv('IDLE_TIMEOUT_SEC'),
    // Grace iniziale (stanza ancora vuota, mai visto nessuno) prima di
    // arrendersi: default 15min in capture.ts → spesso spreco perché il
    // controller spawna il recorder solo su evento già LIVE.
    initialGraceSec: readIntEnv('INITIAL_GRACE_SEC'),
    maxDurationSec: readIntEnv('MAX_DURATION_SEC'),
  };
}

/** Mappa una entry del manifest al file locale da caricare. */
function toLocalFile(track: ManifestTrack, outputDir: string): LocalTrackFile {
  return {
    track,
    // File locale per SESSIONE (trackFileId), coerente con capture/manifest.
    localPath: join(outputDir, localTrackFilename(track.trackFileId)),
  };
}

export async function main(): Promise<void> {
  const env = readEnv();

  // ── 1-2. Claim del work-order (JWT bot + stanza) ──
  const wo = await claimWorkOrder({
    portalUrl: env.portalUrl,
    cronApiKey: env.cronApiKey,
    recordingId: env.recordingId,
  });
  console.log(
    `[recorder] work-order: room=${wo.roomName} event=${wo.eventId} ` +
      `recording=${wo.recordingId}`
  );

  const captureConfig: CaptureConfig = {
    jitsiDomain: env.jitsiDomain,
    roomName: wo.roomName,
    jwt: wo.jwt,
    xmppUser: env.xmppPassword ? env.xmppUser : undefined,
    xmppPassword: env.xmppUser ? env.xmppPassword : undefined,
    outputDir: env.outputDir,
    // Wiring delle env di timing (erano parse-ate ma scartate qui → i default
    // hardcoded in capture.ts vincevano sempre, rendendo la config operatore
    // silenziosamente morta).
    idleTimeoutSec: env.idleTimeoutSec,
    initialGraceSec: env.initialGraceSec,
    maxDurationSec: env.maxDurationSec,
  };

  // ── 3. Cattura WebRTC (blocca fino a fine evento) ──
  let { recordings, joinedConference } = await captureRoom(captureConfig);

  // Rete di sicurezza, e sta QUI di proposito.
  //
  // Il bot entra sul dominio nascosto di Prosody per essere invisibile in
  // sala. Quell'autenticazione può essere rifiutata — password rigenerata da un
  // helm upgrade, allowlist del MUC assente o scritta male — e allora l'evento
  // resterebbe senza audio: irripetibile, e scoperto solo a cose fatte. In quel
  // caso si rientra col JWT del portale: il bot torna VISIBILE in stanza, che è
  // un difetto estetico, non una perdita.
  //
  // La condizione è «non siamo MAI entrati in conferenza», non «zero tracce»:
  // una stanza rimasta vuota è normale e non va ritentata. E il controllo è
  // qui, a sessione conclusa, non dentro il gestore di eventi della pagina:
  // là non si distingue un login rifiutato da una linea caduta a metà evento, e
  // una riconnessione dopo quaranta minuti avrebbe fatto ricomparire il bot
  // davanti a tutti i partecipanti, a registrazione in corso.
  if (shouldRetryWithJwt(joinedConference, captureConfig.xmppUser)) {
    console.warn(
      '[recorder] mai entrati in conferenza col login sul dominio nascosto — ' +
        'riprovo col JWT del portale (il bot sara VISIBILE in stanza)'
    );
    const retry = await captureRoom({
      ...captureConfig,
      xmppUser: undefined,
      xmppPassword: undefined,
    });
    recordings = retry.recordings;
    joinedConference = retry.joinedConference;
  }

  // ── 4. Manifest (puro) ──
  const manifest = buildManifest({
    eventId: env.eventId,
    recordingId: env.recordingId,
    roomName: wo.roomName,
    recordings,
  });
  console.log(`[recorder] manifest: ${manifest.tracks.length} tracce`);

  // Nessuna traccia (stanza vuota o cattura non riuscita): niente da
  // caricare né da ingestare. Usciamo puliti — l'ingest rifiuterebbe un
  // array vuoto (422) e non avrebbe senso accodare la pipeline.
  if (manifest.tracks.length === 0) {
    console.warn('[recorder] nessuna traccia catturata — niente upload/ingest');
    return;
  }

  // ── 5. Upload tracce + manifest (presign per-traccia) ──
  const provider = new PresignStorageProvider({
    uploadUrlEndpoint: `${env.portalUrl}/api/internal/recorder-upload-url`,
    recordingId: env.recordingId,
    cronApiKey: env.cronApiKey,
  });
  const files = manifest.tracks.map((t) => toLocalFile(t, env.outputDir));
  // `uploadedManifest` contiene SOLO le tracce realmente salite (tolleranza
  // parziale): è quello da ingestare, così il portale non referenzia blob
  // mancanti.
  const {
    uploaded,
    trackSizes,
    manifest: uploadedManifest,
    failed,
  } = await uploadRecording(provider, { manifest, files });
  console.log(
    `[recorder] upload completato (${uploaded} tracce, ${failed.length} fallite, provider=${provider.name})`
  );
  if (failed.length > 0) {
    console.warn(`[recorder] tracce NON caricate (saltate): ${failed.join(', ')}`);
  }

  // Tutte le tracce fallite: niente da ingestare (l'ingest rifiuterebbe un
  // array vuoto e non avrebbe senso accodare la pipeline).
  if (uploadedManifest.tracks.length === 0) {
    console.warn('[recorder] nessuna traccia caricata con successo — niente ingest');
    return;
  }

  // ── 6. Ingest al portale (POST /api/internal/multitrack-manifest) ──
  await notifyPortal(buildIngestBody(uploadedManifest, trackSizes), {
    ingestUrl: `${env.portalUrl}/api/internal/multitrack-manifest`,
    cronApiKey: env.cronApiKey,
  });
  console.log('[recorder] portale notificato (multitrack-manifest)');
}

// Esegui solo se invocato direttamente (non quando importato dai test).
// In ESM controlliamo che questo modulo sia il main entry confrontando l'URL.
const isMain =
  typeof process.argv[1] === 'string' && import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  main()
    .then(() => {
      // Uscita esplicita: Puppeteer/Chrome può lasciare handle aperti che
      // tengono vivo l'event loop anche dopo browser.close(), impedendo al
      // processo di terminare → il Job resterebbe Running fino ad
      // activeDeadlineSeconds. Forziamo l'exit a lavoro completato.
      process.exit(0);
    })
    .catch((err) => {
      console.error('[recorder] errore fatale:', err);
      process.exit(1);
    });
}
