/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  MODULO WEBRTC — RICHIEDE UN JITSI REALE. NON È UNIT-TESTABILE.        ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Questo è l'unico modulo "sporco": parla WebRTC, dipende da un browser
 * headless con accesso a `lib-jitsi-meet`, e produce file audio su disco.
 * Tutta la logica determinabile (manifest, paths, offset, upload, firma)
 * vive FUORI da qui (`manifest.ts`, `paths.ts`, `upload.ts`) ed è testata.
 *
 * SCELTA TECNICA (vedi README per il razionale completo):
 *   Chrome headless (Puppeteer) + lib-jitsi-meet servito dal dominio Jitsi,
 *   con cattura per-traccia via `MediaRecorder` (uno per RTCRtpReceiver
 *   audio remoto). Motivi: lib-jitsi-meet è progettato per girare in un
 *   browser (usa API DOM/WebRTC del browser); `node-webrtc`/`werift` non
 *   implementano l'intero stack che lib-jitsi-meet si aspetta (simulcast,
 *   data channels, statistiche) e diventano fragili fra gli upgrade Jitsi.
 *   Chrome headless ci dà lo stesso stack WebRTC che gira in produzione,
 *   esattamente come fa Jibri.
 *
 * Il grosso del lavoro avviene DENTRO la pagina del browser (`page.evaluate`),
 * dove esistono `JitsiMeetJS`, `RTCPeerConnection` e `MediaRecorder`. Da
 * Node orchestriamo solo: avvio browser, iniezione config, raccolta degli
 * eventi (`onTrackChunk`, `onTrackEnded`) e scrittura su disco.
 *
 * Questo file è SCAFFOLDING ben commentato + i punti d'innesto. La
 * connessione end-to-end va validata su un cluster con Jitsi vero (vedi
 * README "cosa NON è testabile in locale").
 */

import { mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';

import puppeteer, { type Browser, type Page } from 'puppeteer';

import { localTrackFilename } from './paths.js';
import type { TrackRecording } from './manifest.js';

export interface CaptureConfig {
  jitsiDomain: string;
  roomName: string;
  /** JWT del portale che ci fa entrare come bot receive-only. */
  jwt: string;
  /** Directory locale dove scrivere i file `.opus`. */
  outputDir: string;
  /** displayName del bot in stanza (es. "📼 Recorder"). */
  botDisplayName?: string;
  /** BOSH/WebSocket service URL. Default: wss://{domain}/xmpp-websocket. */
  serviceUrl?: string;
  /** MUC domain. Default: conference.{domain}. */
  mucDomain?: string;
  /** Chiusura quando la stanza resta senza partecipanti per N secondi
   *  DOPO che almeno un partecipante è stato visto. */
  idleTimeoutSec?: number;
  /** Grace iniziale: quanto attendere l'ARRIVO del primo partecipante prima
   *  di chiudere (il bot può entrare prima dei partecipanti). Default 15min:
   *  evita che il recorder se ne vada se gli utenti tardano. */
  initialGraceSec?: number;
  /** Hard cap di durata della cattura (safety). Default 4h. */
  maxDurationSec?: number;
}

/**
 * Risultato della cattura: lo stato per-traccia che alimenta
 * `buildManifest`. Tutto il timing è epoch ms.
 */
export interface CaptureResult {
  recordings: TrackRecording[];
}

/**
 * Avvia la cattura e si blocca finché l'evento non termina (stanza vuota
 * o segnale di stop). Ritorna lo stato delle tracce per il manifest.
 *
 * ─── Pseudo-flusso (da implementare con Puppeteer su Jitsi reale) ───
 *
 * 1. Lancia Chrome headless con i flag WebRTC tipici di Jibri:
 *      --use-fake-ui-for-media-stream  (nessun device locale: siamo
 *      receive-only, NON pubblichiamo né mic né camera)
 *      --autoplay-policy=no-user-gesture-required
 *      --disable-gpu --no-sandbox (in container)
 *
 * 2. Naviga su una pagina minimale servita dal dominio Jitsi (stessa
 *    origin di lib-jitsi-meet, per CSP/CORS) e inietta uno script che:
 *      a. `JitsiMeetJS.init({ disableAudioLevels: false })`
 *      b. crea la connection con il JWT (`new JitsiMeetJS.JitsiConnection(
 *         appId, jwt, { hosts, serviceUrl })`)
 *      c. su CONNECTION_ESTABLISHED, `initJitsiConference(roomName, {})` —
 *         receive-only perché non crea né pubblica track locali.
 *      d. `conference.setDisplayName(botDisplayName)` e `conference.join(jwt)`.
 *
 * 3. Per ogni `TRACK_ADDED` remoto di tipo 'audio':
 *      - `const pid = track.getParticipantId()` → endpoint id Jitsi
 *      - `const name = conference.getParticipantById(pid)?.getDisplayName()`
 *        → displayName dal JWT del portale (PII, in chiaro nel manifest)
 *      - prendi `track.getOriginalStream()` (MediaStream con la sola
 *        traccia audio di QUEL partecipante) e crea
 *        `new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus',
 *        audioBitsPerSecond: 32000 })`
 *      - `recorder.ondataavailable = e => onTrackChunk(pid, name, chunk)`
 *        (con timestamp epoch alla prima frame → firstFrameAtMs)
 *      - `recorder.start(1000)` (chunk al secondo per offset accurato)
 *
 * 4. Su `TRACK_REMOVED` / `USER_LEFT`: `recorder.stop()` → `onTrackEnded`.
 *
 * 5. Su `CONFERENCE_LEFT` o stanza vuota per > N secondi: chiudi tutto,
 *    flush dei file, risolvi la promise con `recordings`.
 *
 * I `MediaRecorder` vivono nel contesto pagina; i chunk vengono passati a
 * Node via `page.exposeFunction('onTrackChunk', ...)` come base64/Uint8Array
 * e qui sotto li accodiamo sul file della traccia (`TrackWriter`).
 */
export async function captureRoom(config: CaptureConfig): Promise<CaptureResult> {
  await mkdir(config.outputDir, { recursive: true });

  // Writer per-traccia. La chiave `trackFileId` (= `${pid}-${seq}` dalla
  // pagina) è univoca per SESSIONE: un rejoin / mute→unmute dello stesso
  // partecipante crea una NUOVA chiave → un NUOVO file (prima riusava
  // `${pid}.opus` e troncava la sessione precedente: audio perso).
  const writers = new Map<string, TrackWriter>();
  function getOrCreateWriter(trackFileId: string, pid: string, name: string | null): TrackWriter {
    let w = writers.get(trackFileId);
    if (!w) {
      w = new TrackWriter(pid, trackFileId, name, config.outputDir);
      writers.set(trackFileId, w);
    }
    if (name && !w.displayName) w.displayName = name;
    return w;
  }

  const idleTimeoutMs = (config.idleTimeoutSec ?? 90) * 1000;
  const initialGraceMs = (config.initialGraceSec ?? 15 * 60) * 1000;
  const maxDurationMs = (config.maxDurationSec ?? 4 * 3600) * 1000;
  const serviceUrl = config.serviceUrl ?? `wss://${config.jitsiDomain}/xmpp-websocket`;
  const mucDomain = config.mucDomain ?? `conference.${config.jitsiDomain}`;

  // Stesso set di flag WebRTC di Jibri: nessun device locale (siamo
  // receive-only), autoplay senza gesture, no sandbox in container.
  const browser: Browser = await puppeteer.launch({
    headless: true,
    // protocolTimeout:0 disabilita il timeout per-comando CDP. Il bootstrap
    // in-page (`page.evaluate(IN_PAGE_BOOTSTRAP)`) resta volutamente *pending*
    // per TUTTA la sessione (la sua Promise risolve solo dentro `finish()`).
    // Col default 180s Puppeteer abortiva quel callFunctionOn dopo 3 minuti
    // ("Runtime.callFunctionOn timed out") uccidendo il recorder PRIMA di
    // finish()/upload/ingest → zero tracce per qualsiasi sessione reale. 0 = no cap.
    protocolTimeout: 0,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-dev-shm-usage',
    ],
  });

  try {
    const page: Page = await browser.newPage();
    let resolveDone: () => void = () => {};
    const done = new Promise<void>((r) => {
      resolveDone = r;
    });

    // Node ← page bridge. I chunk audio (Blob → base64 in pagina) arrivano
    // qui e vengono appesi al file della traccia.
    await page.exposeFunction(
      'onTrackChunk',
      async (trackKey: string, pid: string, name: string | null, b64: string, nowMs: number) => {
        try {
          await getOrCreateWriter(trackKey, pid, name).appendChunk(Buffer.from(b64, 'base64'), nowMs);
        } catch (e) {
          console.error('[recorder] appendChunk failed', e);
        }
      },
    );
    // Ancora la timeline della traccia all'istante in cui parte il
    // MediaRecorder (origine del file), NON al primo chunk (~1s dopo, con
    // jitter FileReader/IPC): così startOffsetMs (= firstFrame - t0) è
    // accurato e i late-joiner finiscono al tempo assoluto giusto.
    await page.exposeFunction(
      'onTrackStarted',
      (trackKey: string, pid: string, name: string | null, startedAtMs: number) => {
        getOrCreateWriter(trackKey, pid, name).anchor(startedAtMs);
      },
    );
    await page.exposeFunction('onTrackEnded', async (trackKey: string) => {
      await writers.get(trackKey)?.close();
    });
    await page.exposeFunction('onConferenceDone', () => resolveDone());
    await page.exposeFunction('logFromPage', (msg: string) => console.log('[page]', msg));

    // Stessa origin di lib-jitsi-meet (CSP/CORS): carichiamo la pagina del
    // dominio Jitsi e iniettiamo lo script lib-jitsi-meet servito da lì.
    // Chrome headless in pod può lanciare `net::ERR_NETWORK_CHANGED` se la rete
    // del pod (veth/CNI) si assesta DOPO l'avvio del browser: è una race di
    // startup, non un errore reale. Ritenta il caricamento pagina alcune volte
    // con backoff prima di arrendersi (osservato fallire ~1 volta su 2 al boot).
    let gotoErr: unknown;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        await page.goto(`https://${config.jitsiDomain}/`, {
          waitUntil: 'domcontentloaded',
          timeout: 60_000,
        });
        gotoErr = undefined;
        break;
      } catch (e) {
        gotoErr = e;
        console.error(`[recorder] page.goto tentativo ${attempt}/4 fallito: ${String(e)}`);
        await new Promise((r) => setTimeout(r, 2_000 * attempt));
      }
    }
    if (gotoErr) throw gotoErr;
    await page.addScriptTag({ url: `https://${config.jitsiDomain}/libs/lib-jitsi-meet.min.js` });
    // Carichiamo anche il config.js del deployment Jitsi: definisce
    // `window.config` con gli host XMPP reali (es. domain=meet.jitsi,
    // muc=muc.meet.jitsi) e l'endpoint BOSH/WebSocket effettivo. Sintetizzarli
    // dal dominio pubblico è sbagliato (ogni deployment differisce).
    await page.addScriptTag({ url: `https://${config.jitsiDomain}/config.js` });

    // Bootstrap in-page: connessione + conference receive-only + un
    // MediaRecorder per traccia audio remota. Vedi pseudo-flusso sopra.
    await page.evaluate(IN_PAGE_BOOTSTRAP, {
      appId: config.jitsiDomain,
      room: config.roomName.toLowerCase(),
      jwt: config.jwt,
      botName: config.botDisplayName ?? '📼 Recorder',
      serviceUrl,
      mucDomain,
      domain: config.jitsiDomain,
      idleTimeoutMs,
      initialGraceMs,
    });

    // Attendi fine conference o hard-cap di durata.
    await Promise.race([done, new Promise<void>((r) => setTimeout(r, maxDurationMs))]);
  } finally {
    for (const w of writers.values()) {
      await w.close();
    }
    await browser.close();
  }

  return { recordings: Array.from(writers.values()).map((w) => w.toRecording()) };
}

/**
 * Codice eseguito DENTRO la pagina del browser (contesto con
 * `JitsiMeetJS`, `MediaRecorder`, `window`). Serializzato da Puppeteer:
 * niente closure su variabili Node, solo il parametro `cfg`. Le funzioni
 * `window.onTrackChunk/onTrackEnded/onConferenceDone/logFromPage` sono
 * quelle esposte da Node.
 *
 * NB: non type-checkabile contro un Jitsi reale — va validato sul cluster.
 */
const IN_PAGE_BOOTSTRAP = (cfg: {
  appId: string;
  room: string;
  jwt: string;
  botName: string;
  serviceUrl: string;
  mucDomain: string;
  domain: string;
  idleTimeoutMs: number;
  initialGraceMs: number;
}): Promise<void> =>
  new Promise<void>((resolve) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const w = window as any;
    const JitsiMeetJS = w.JitsiMeetJS;
    const log = (m: string) => w.logFromPage?.(m);
    if (!JitsiMeetJS) {
      log('lib-jitsi-meet non caricato');
      w.onConferenceDone?.();
      resolve();
      return;
    }

    JitsiMeetJS.init({ disableAudioLevels: true });
    JitsiMeetJS.setLogLevel(JitsiMeetJS.logLevels.ERROR);

    // Usa la config reale del deployment (window.config da config.js); i
    // valori sintetizzati in `cfg` restano solo come fallback.
    const jcfg = w.config ?? {};
    // ESENZIONE RELAY (critico): il recorder è IN-CLUSTER e raggiunge il JVB
    // via pod-IP diretto (host candidates). La config.js servita forza
    // `iceTransportPolicy='relay'` (piano media TURN, necessario ai client
    // ESTERNI dietro firewall), ma per il bot interno instradare il media via
    // coturn PUBBLICO in hairpin NON consegna l'audio in ricezione → 0 tracce
    // (segnalazione OK, media assente). Forziamo ICE 'all' + niente STUN/TURN:
    // il bot usa il path diretto in-cluster, più affidabile ed efficiente.
    jcfg.iceTransportPolicy = 'all';
    jcfg.useStunTurn = false;
    if (jcfg.p2p) jcfg.p2p.iceTransportPolicy = 'all';
    const hosts = jcfg.hosts ?? { domain: cfg.domain, muc: cfg.mucDomain };
    // serviceUrl: preferisci WebSocket, poi BOSH, poi il fallback sintetico.
    const serviceUrl = jcfg.websocket ?? jcfg.bosh ?? cfg.serviceUrl;
    log(`connessione: domain=${hosts.domain} muc=${hosts.muc} svc=${serviceUrl}`);

    const connection = new JitsiMeetJS.JitsiConnection(null, cfg.jwt, {
      hosts,
      serviceUrl,
      clientNode: 'https://jitsi.org/jitsimeet',
    });

    let conference: any = null;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const recorders = new Map<string, { rec: any; key: string }>();
    // Contatore monotono per generare un trackFileId univoco per sessione,
    // robusto a due TRACK_ADDED nello stesso ms (Date.now() poteva collidere).
    let trackSeq = 0;
    // È mai entrato un partecipante? Distingue "stanza ancora vuota all'avvio"
    // (grace lungo: il bot può entrare prima degli utenti) da "tutti usciti
    // dopo l'attività" (idle breve).
    let seenParticipant = false;
    let finishing = false;

    const finish = async (): Promise<void> => {
      if (finishing) return;
      finishing = true;
      if (idleTimer) clearTimeout(idleTimer);
      // Ferma i recorder e ATTENDI l'onstop (che dispatcha l'ultimo
      // dataavailable): senza l'attesa l'ultimo ~1s di audio poteva non
      // essere flushato. + piccola attesa per drenare FileReader/IPC dei
      // chunk finali (best-effort; da validare su Jitsi reale).
      await Promise.all(
        [...recorders.values()].map(
          ({ rec }) =>
            new Promise<void>((res) => {
              if (!rec || rec.state === 'inactive') return res();
              rec.onstop = () => res();
              try {
                rec.stop();
              } catch {
                res();
              }
            }),
        ),
      );
      await new Promise<void>((res) => setTimeout(res, 500));
      for (const { key } of recorders.values()) w.onTrackEnded?.(key);
      try {
        conference?.leave();
        connection.disconnect();
      } catch {
        /* ignore */
      }
      w.onConferenceDone?.();
      resolve();
    };

    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      // Conta i partecipanti REMOTI VISIBILI: getParticipants() esclude il
      // bot stesso e i partecipanti nascosti (focus/jicofo). Usare
      // getParticipantCount()-1 contava il focus → others>0 → l'idle timer
      // non scattava mai e il bot restava in stanza fino a maxDuration (4h).
      const parts: any[] = conference?.getParticipants?.() ?? [];
      const others = parts.filter((p) => !p.isHidden?.()).length;
      if (others > 0) {
        seenParticipant = true;
        return; // c'è qualcuno: nessun timer di chiusura
      }
      // Stanza vuota: grace LUNGO finché non si è mai visto nessuno (attesa
      // dell'arrivo), BREVE dopo che l'evento ha avuto attività.
      void (idleTimer = setTimeout(
        () => void finish(),
        seenParticipant ? cfg.idleTimeoutMs : cfg.initialGraceMs,
      ));
    };

    const onTrackAdded = (track: any) => {
      log(
        `TRACK_ADDED type=${track.getType?.()} local=${track.isLocal?.()} pid=${track.getParticipantId?.()}`,
      );
      if (track.isLocal?.() || track.getType?.() !== 'audio') return;
      seenParticipant = true;
      if (idleTimer) clearTimeout(idleTimer);
      const pid: string = track.getParticipantId?.() ?? 'unknown';
      const name: string | null =
        conference?.getParticipantById?.(pid)?.getDisplayName?.() ?? null;
      // trackFileId univoco per sessione: rejoin/unmute → file distinto.
      const key = `${pid}-${trackSeq++}`;
      // Registra SOLO la audio track di questo partecipante, non l'intero
      // getOriginalStream() (che può contenere altre track, es. video) →
      // garantisce "una voce per file" e nessun cross-content.
      const original: MediaStream = track.getOriginalStream();
      const audioOnly =
        typeof track.getTrack === 'function'
          ? new MediaStream([track.getTrack()])
          : new MediaStream(original.getAudioTracks());
      const stream: MediaStream = audioOnly.getAudioTracks().length
        ? audioOnly
        : original;
      let rec: MediaRecorder;
      try {
        rec = new MediaRecorder(stream, {
          mimeType: 'audio/webm;codecs=opus',
          audioBitsPerSecond: 32000,
        });
      } catch (e) {
        log('MediaRecorder ko: ' + String(e));
        return;
      }
      rec.ondataavailable = (ev: BlobEvent) => {
        if (!ev.data || ev.data.size === 0) return;
        const reader = new FileReader();
        reader.onloadend = () => {
          const res = reader.result as string;
          const b64 = res.slice(res.indexOf(',') + 1);
          w.onTrackChunk?.(key, pid, name, b64, Date.now());
        };
        reader.readAsDataURL(ev.data);
      };
      // Ancora l'origine della traccia ALL'AVVIO del recorder (non al primo
      // chunk, che arriva ~1s dopo con jitter): è il riferimento per gli
      // offset di sincronizzazione dei late-joiner.
      w.onTrackStarted?.(key, pid, name, Date.now());
      // timeslice 3s: a molti speaker concorrenti (es. webinar 50pax) un chunk
      // ogni 1s = un giro IPC pagina→Node per traccia al secondo (qui ×N). 3s
      // riduce ~3× l'overhead IPC/encode; l'offset è ancorato a onTrackStarted
      // (non al primo chunk) e finish() flusha l'ultimo chunk su onstop → nessuna
      // perdita di accuratezza temporale.
      rec.start(3000);
      recorders.set(track.getId?.() ?? key, { rec, key });
      log(`recording audio track key=${key} pid=${pid} name=${name} (recorders=${recorders.size})`);
    };

    const onTrackRemoved = (track: any) => {
      const id = track.getId?.();
      const entry = id ? recorders.get(id) : undefined;
      if (entry) {
        try {
          entry.rec.stop();
        } catch {
          /* ignore */
        }
        w.onTrackEnded?.(entry.key);
        recorders.delete(id);
      }
    };

    const onConferenceJoined = () => {
      log(
        'conference joined: ' + cfg.room +
        ' participants=' + (conference?.getParticipants?.()?.length ?? 0),
      );
      armIdle();
    };

    connection.addEventListener(
      JitsiMeetJS.events.connection.CONNECTION_ESTABLISHED,
      () => {
        // NB: niente `startSilent` — è un'ottimizzazione per client "muti"
        // che può sopprimere la RICEZIONE dell'audio remoto su alcuni
        // bridge. Il recorder è receive-only semplicemente perché non crea
        // né pubblica track locali (nessun getUserMedia, nessun addTrack).
        // Opzioni conference: esenta esplicitamente dal relay anche a livello
        // di conference (oltre al global w.config sopra) per i build che leggono
        // l'iceTransportPolicy dalle opzioni e non dal config globale.
        conference = connection.initJitsiConference(cfg.room, { iceTransportPolicy: 'all' });
        conference.setDisplayName(cfg.botName);
        conference.on(JitsiMeetJS.events.conference.TRACK_ADDED, onTrackAdded);
        conference.on(JitsiMeetJS.events.conference.TRACK_REMOVED, onTrackRemoved);
        conference.on(JitsiMeetJS.events.conference.CONFERENCE_JOINED, onConferenceJoined);
        conference.on(JitsiMeetJS.events.conference.USER_LEFT, armIdle);
        conference.on(JitsiMeetJS.events.conference.USER_JOINED, (id: string) => {
          seenParticipant = true;
          if (idleTimer) clearTimeout(idleTimer);
          log('USER_JOINED ' + id + ' (participants=' + (conference?.getParticipants?.()?.length ?? 0) + ')');
        });
        // Diagnostica salute media (ICE/bridge): se il media non si stabilisce
        // i TRACK_ADDED non arrivano. Logghiamo gli eventi disponibili.
        try {
          conference.on(JitsiMeetJS.events.conference.CONNECTION_INTERRUPTED, () => log('media CONNECTION_INTERRUPTED'));
          conference.on(JitsiMeetJS.events.conference.CONNECTION_RESTORED, () => log('media CONNECTION_RESTORED'));
        } catch { /* eventi non disponibili in questo build */ }
        // Errore di conference (kick, bridge down, ICE failed): NON uscire
        // in silenzio. Logga il motivo così l'operator/portale lo vede; chiude
        // pulito salvando ciò che è stato catturato finora. Un reconnect
        // completo (mantenendo i writer aperti) va validato su Jitsi reale.
        conference.on(
          JitsiMeetJS.events.conference.CONFERENCE_FAILED,
          (err: unknown) => {
            log('conference FAILED: ' + String(err));
            void finish();
          },
        );
        conference.join();
        // Vogliamo l'audio di TUTTI i partecipanti (no last-N sul video,
        // che non ci serve). Best-effort: l'API varia per versione.
        try {
          conference.setReceiverConstraints?.({
            lastN: -1,
            defaultConstraints: { maxHeight: 0 },
          });
        } catch {
          /* versione lib-jitsi-meet senza setReceiverConstraints */
        }
      },
    );
    connection.addEventListener(
      JitsiMeetJS.events.connection.CONNECTION_FAILED,
      () => {
        log('connection failed');
        void finish();
      },
    );
    connection.connect();
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });

/**
 * Scrittore di una singola traccia su disco + accumulo dei metadati di
 * timing per il manifest. Questa parte è "quasi pura" (solo I/O file) ma la
 * teniamo nel modulo WebRTC perché la usa solo la cattura; gli unit test
 * coprono `manifest.ts` che consuma il `TrackRecording` prodotto qui.
 */
class TrackWriter {
  readonly participantId: string;
  /** Id univoco della sessione di traccia (rejoin/unmute → file distinto). */
  readonly trackFileId: string;
  displayName: string | null;
  firstFrameAtMs = 0;
  lastFrameAtMs = 0;
  bytesWritten = 0;

  private fileHandle: Awaited<ReturnType<typeof open>> | null = null;
  private readonly path: string;

  constructor(
    participantId: string,
    trackFileId: string,
    displayName: string | null,
    outputDir: string,
  ) {
    this.participantId = participantId;
    this.trackFileId = trackFileId;
    this.displayName = displayName;
    // Nome file per SESSIONE (trackFileId), non per pid: una seconda
    // sessione dello stesso partecipante NON tronca più la prima.
    this.path = join(outputDir, localTrackFilename(trackFileId));
  }

  /**
   * Ancora la timeline della traccia all'istante di avvio del MediaRecorder
   * (origine epoch del file .opus). È il riferimento corretto per
   * `startOffsetMs`: il primo chunk arriva ~1s dopo (recorder.start(1000)) e
   * con jitter, quindi ancorare a quello introdurrebbe skew fra le tracce.
   */
  anchor(startedAtMs: number): void {
    if (this.firstFrameAtMs === 0) this.firstFrameAtMs = startedAtMs;
  }

  async appendChunk(chunk: Buffer, nowMs: number): Promise<void> {
    if (this.fileHandle === null) {
      this.fileHandle = await open(this.path, 'w');
      // Fallback se onTrackStarted non è arrivato (difensivo): usa il primo
      // chunk come origine. In condizioni normali anchor() ha già impostato
      // firstFrameAtMs all'avvio del recorder.
      if (this.firstFrameAtMs === 0) this.firstFrameAtMs = nowMs;
    }
    await this.fileHandle.write(chunk);
    this.bytesWritten += chunk.length;
    this.lastFrameAtMs = nowMs;
  }

  async close(): Promise<void> {
    if (this.fileHandle) {
      await this.fileHandle.close();
      this.fileHandle = null;
    }
  }

  toRecording(): TrackRecording {
    return {
      participantId: this.participantId,
      trackFileId: this.trackFileId,
      displayName: this.displayName,
      firstFrameAtMs: this.firstFrameAtMs,
      lastFrameAtMs: this.lastFrameAtMs,
      bytesWritten: this.bytesWritten,
    };
  }
}
