/**
 * Il cuore del gateway: le conferenze collegate dal bridge, le voci di
 * ciascuna e le sessioni del motore, sotto un unico governo del carico.
 *
 * Una conferenza è una WebSocket aperta dal bridge. Ogni sorgente audio
 * (un partecipante che parla) diventa una voce: il suo Opus si decodifica a
 * 16 kHz mono, va al motore in una sessione dedicata, e il testo torna al
 * bridge come sottotitolo. Al motore va solo il parlato: con il microfono
 * aperto il bridge manda audio anche nelle pause, e la voce si riconosce
 * sull'energia del segnale (vad.ts). Quando una voce tace oltre
 * `pauseGapMs`, in silenzio o senza pacchetti, la frase si chiude (commit del
 * motore) e il sottotitolo diventa definitivo.
 *
 * Le sessioni del motore sono limitate: oltre il limite restano senza
 * sottotitoli le voci zitte da più tempo. Se il motore resta indietro, il
 * governo del carico riduce il limite o sospende tutto.
 */

import { OpusDecoder } from 'opus-decoder';
import type WebSocket from 'ws';

import { CaptionAssembler, makeRewriter, type CaptionUpdate } from './captions.js';
import type { Config } from './config.js';
import type { ContextProvider, RoomContext } from './context.js';
import { EngineSession } from './engine.js';
import { LoadGovernor, type LoadSnapshot } from './load.js';
import { VoiceDetector } from './vad.js';
import {
  endpointFromTag,
  parseEvent,
  pong,
  primaryLanguage,
  transcriptionResult,
  type IncomingEvent,
} from './mediajson.js';

const RTP_RATE = 48000;
const OUT_RATE = 16000;
/** Audio tenuto da parte mentre la sessione del motore si apre (secondi). */
const MAX_BUFFER_SECONDS = 3;
/** Se il motore non conferma la fine della frase entro questo tempo, la si chiude comunque. */
const ENGINE_RETRY_MS = 2000;
/**
 * Silenzio premesso a ogni tratto. Al motore non arrivano le pause, quindi
 * dopo una pausa la voce arriva "a freddo"; se il parlato comincia nei primi
 * millisecondi, il modello perde la prima parola e per tutta la frase anche
 * maiuscole e punteggiatura (misurato: 25 ms bastano).
 */
const LEAD_IN = Buffer.alloc(Math.round(0.3 * 16000) * 2);
/** L'audio appena prima della soglia: contiene l'attacco della prima sillaba. */
const PRE_ROLL_SECONDS = 0.3;
const MAX_SOCKET_BUFFER = 1 << 20;

interface Stream {
  tag: string;
  endpointId: string;
  channels: number;
  decoder: OpusDecoder<16000> | null;
  /** Il decoder WebAssembly si inizializza in modo asincrono: i pacchetti aspettano qui. */
  decoderReady: boolean;
  waiting: Array<{ timestamp: number; payload: Uint8Array }>;
  engine: EngineSession | null;
  opening: boolean;
  /** La frase è finita mentre la sessione si apriva: si chiude appena il motore ha il suo audio. */
  endAfterOpen: boolean;
  buffered: Buffer[];
  bufferedSeconds: number;
  retryAt: number;
  assembler: CaptionAssembler;
  /** L'ultima volta che la voce ha parlato: decide chi perde la sessione del motore. */
  lastVoiceAt: number;
  vad: VoiceDetector;
  /** Dentro una frase: dal primo frame di voce alla pausa che la chiude. */
  inSpeech: boolean;
  silenceSeconds: number;
  preRoll: Buffer[];
  preRollSeconds: number;
  lastRtp: number | null;
  lastTicks: number;
  speaking: boolean;
  /** Il prossimo audio apre un tratto nuovo del motore: va preceduto da `LEAD_IN`. */
  leadIn: boolean;
  gapTimer: NodeJS.Timeout | null;
  /**
   * Una voce per ogni commit al motore, nell'ordine: il motore risponde a
   * ciascuno con un `completed`. Se tarda oltre `finishTimeoutMs` la frase si
   * chiude comunque e la voce resta segnata come scaduta, così il `completed`
   * che arriva dopo non riapre né spezza la frase successiva.
   */
  pendingCommits: Array<{ timer: NodeJS.Timeout; expired: boolean }>;
  interimTimer: NodeJS.Timeout | null;
  pendingInterim: CaptionUpdate | null;
  lastInterimAt: number;
}

export interface GatewayStatus extends LoadSnapshot {
  engine: 'up' | 'down';
  conferences: number;
  activeStreams: number;
  maxStreams: number;
}

function toPcm16(channels: Float32Array[], samples: number): Buffer {
  const out = Buffer.alloc(samples * 2);
  const n = channels.length || 1;
  for (let i = 0; i < samples; i++) {
    let v = 0;
    for (const ch of channels) v += ch[i] ?? 0;
    v /= n;
    const s = Math.max(-1, Math.min(1, v));
    out.writeInt16LE(Math.round(s < 0 ? s * 32768 : s * 32767), i * 2);
  }
  return out;
}

export class Conference {
  private streams = new Map<string, Stream>();
  private context: RoomContext | null = null;
  private rewrite: (text: string) => string = (t) => t;
  private closed = false;

  constructor(
    private readonly gateway: Gateway,
    private readonly socket: WebSocket,
    readonly meetingId: string,
    private readonly room: string | null,
  ) {}

  private contextTimer: NodeJS.Timeout | null = null;

  async init(): Promise<void> {
    await this.loadContext();
  }

  /**
   * Il contesto si rilegge di continuo: chi modera può accendere o spegnere i
   * sottotitoli dell'evento mentre il bridge resta collegato, e un contesto
   * letto una volta sola terrebbe la stanza muta (o trascritta) per tutta la
   * connessione. Le sessioni del motore già aperte tengono lingua e frasi con
   * cui sono nate; le correzioni valgono subito.
   */
  private async loadContext(): Promise<void> {
    const context = await this.gateway.contexts.get(this.room);
    if (this.closed) return;
    this.context = context;
    this.rewrite = makeRewriter(context.aliases);
    this.contextTimer = setTimeout(
      () => void this.loadContext(),
      context.enabled
        ? this.gateway.config.contextRefreshMs
        : Math.ceil(this.gateway.config.contextRefreshMs / 6),
    );
  }

  get enabled(): boolean {
    return this.context?.enabled !== false;
  }

  get language(): string {
    return this.context?.language ?? this.gateway.config.defaultLanguage;
  }

  streamsList(): Stream[] {
    return [...this.streams.values()];
  }

  handleMessage(text: string): void {
    if (this.closed) return;
    const event = parseEvent(text);
    if (!event) return;
    this.handleEvent(event);
  }

  handleEvent(event: IncomingEvent): void {
    switch (event.kind) {
      case 'ping':
        this.send(pong(event.id));
        break;
      case 'start':
        this.onStart(event.tag, event.endpointId, event.channels, event.encoding);
        break;
      case 'media':
        this.onMedia(event.tag, event.timestamp, event.payload);
        break;
      case 'session-end':
        this.close();
        break;
      default:
        break;
    }
  }

  private newStream(tag: string, endpointId: string, channels: number): Stream {
    return {
      tag,
      endpointId,
      channels: Math.max(1, Math.min(2, channels)),
      decoder: null,
      decoderReady: false,
      waiting: [],
      engine: null,
      opening: false,
      endAfterOpen: false,
      buffered: [],
      bufferedSeconds: 0,
      retryAt: 0,
      assembler: new CaptionAssembler({
        idPrefix: `${tag}-${Date.now().toString(36)}`,
        maxChars: this.gateway.config.maxCaptionChars,
        rewrite: (t) => this.rewrite(t),
      }),
      lastVoiceAt: 0,
      vad: new VoiceDetector({
        minDbfs: this.gateway.config.vadMinDbfs,
        marginDb: this.gateway.config.vadMarginDb,
      }),
      inSpeech: false,
      silenceSeconds: 0,
      preRoll: [],
      preRollSeconds: 0,
      lastRtp: null,
      lastTicks: 0,
      speaking: false,
      leadIn: true,
      gapTimer: null,
      pendingCommits: [],
      interimTimer: null,
      pendingInterim: null,
      lastInterimAt: 0,
    };
  }

  private onStart(tag: string, endpointId: string, channels: number, encoding: string): void {
    if (encoding !== 'opus') return;
    const existing = this.streams.get(tag);
    if (existing) {
      // Nuovo `start` per la stessa sorgente (cambio di formato): si riparte dal decoder.
      existing.decoder?.free();
      existing.decoder = null;
      existing.decoderReady = false;
      existing.channels = Math.max(1, Math.min(2, channels));
      existing.lastRtp = null;
      return;
    }
    this.streams.set(tag, this.newStream(tag, endpointId, channels));
  }

  private ensureDecoder(stream: Stream): void {
    if (stream.decoder) return;
    const decoder = new OpusDecoder({ channels: stream.channels, sampleRate: OUT_RATE });
    stream.decoder = decoder;
    decoder.ready.then(
      () => {
        if (stream.decoder !== decoder || this.closed) return;
        stream.decoderReady = true;
        const waiting = stream.waiting;
        stream.waiting = [];
        for (const packet of waiting) this.decodeAndFeed(stream, packet.timestamp, packet.payload);
      },
      () => {
        stream.waiting = [];
      },
    );
  }

  private onMedia(tag: string, timestamp: number, payload: Uint8Array): void {
    let stream = this.streams.get(tag);
    if (!stream) {
      stream = this.newStream(tag, endpointFromTag(tag), 2);
      this.streams.set(tag, stream);
    }
    if (!this.enabled || !this.gateway.accepting()) {
      if (stream.engine) this.stopEngine(stream, 'paused');
      return;
    }

    this.ensureDecoder(stream);
    if (!stream.decoderReady) {
      // Tre secondi al massimo: oltre, il decoder non partirà più.
      if (stream.waiting.length < 150) stream.waiting.push({ timestamp, payload });
      return;
    }
    this.decodeAndFeed(stream, timestamp, payload);
  }

  private decodeAndFeed(stream: Stream, timestamp: number, payload: Uint8Array): void {
    const decoder = stream.decoder;
    if (!decoder) return;
    let decoded;
    try {
      decoded = decoder.decodeFrame(payload);
    } catch {
      return;
    }
    if (decoded.samplesDecoded === 0) return;
    const ticks = Math.round((decoded.samplesDecoded / OUT_RATE) * RTP_RATE);

    const chunks: Buffer[] = [];
    if (stream.lastRtp !== null) {
      const gapMs = ((timestamp - stream.lastRtp - stream.lastTicks) / RTP_RATE) * 1000;
      if (gapMs > 0 && gapMs <= this.gateway.config.fillGapMs) {
        chunks.push(Buffer.alloc(Math.round((gapMs / 1000) * OUT_RATE) * 2));
      }
    }
    stream.lastRtp = timestamp;
    stream.lastTicks = ticks;
    chunks.push(toPcm16(decoded.channelData, decoded.samplesDecoded));

    for (const pcm of chunks) this.onPcm(stream, pcm);
    this.armGapTimer(stream);
  }

  /**
   * Al motore va solo il parlato, con un po' di audio prima (l'attacco) e la
   * pausa che chiude la frase. Il silenzio di un microfono aperto non costa
   * CPU e non tiene occupata una sessione.
   */
  private onPcm(stream: Stream, pcm: Buffer): void {
    const seconds = pcm.length / 2 / OUT_RATE;
    if (stream.vad.push(pcm)) {
      stream.lastVoiceAt = this.gateway.now();
      stream.silenceSeconds = 0;
      if (!stream.inSpeech) {
        stream.inSpeech = true;
        for (const before of stream.preRoll) this.feed(stream, before);
        stream.preRoll = [];
        stream.preRollSeconds = 0;
      }
      this.feed(stream, pcm);
      return;
    }
    if (stream.inSpeech) {
      this.feed(stream, pcm);
      stream.silenceSeconds += seconds;
      if (stream.silenceSeconds * 1000 >= this.gateway.config.pauseGapMs) this.endUtterance(stream);
      return;
    }
    stream.preRoll.push(pcm);
    stream.preRollSeconds += seconds;
    while (stream.preRollSeconds > PRE_ROLL_SECONDS && stream.preRoll.length > 1) {
      const dropped = stream.preRoll.shift();
      stream.preRollSeconds -= (dropped?.length ?? 0) / 2 / OUT_RATE;
    }
  }

  private feed(stream: Stream, pcm: Buffer): void {
    if (stream.engine?.isOpen) {
      if (stream.leadIn) {
        stream.engine.sendPcm(LEAD_IN);
        stream.leadIn = false;
      }
      stream.engine.sendPcm(pcm);
      stream.speaking = true;
      return;
    }
    // Sessione in apertura (o da aprire): si tiene l'inizio della frase.
    stream.buffered.push(pcm);
    stream.bufferedSeconds += pcm.length / 2 / OUT_RATE;
    while (stream.bufferedSeconds > MAX_BUFFER_SECONDS && stream.buffered.length > 0) {
      const dropped = stream.buffered.shift();
      stream.bufferedSeconds -= (dropped?.length ?? 0) / 2 / OUT_RATE;
    }
    if (!stream.opening && this.gateway.now() >= stream.retryAt && this.gateway.admit(stream, this)) {
      void this.openEngine(stream);
    }
  }

  private async openEngine(stream: Stream): Promise<void> {
    stream.opening = true;
    const context = this.context;
    const session = new EngineSession(
      {
        url: this.gateway.config.engineUrl,
        language: context?.language ?? this.gateway.config.defaultLanguage,
        phrases: context?.phrases ?? [],
        boost: this.gateway.config.boost,
      },
      {
        onDelta: (text, lagMs) => {
          if (lagMs !== null) this.gateway.governor.recordLag(lagMs);
          this.deliver(stream, stream.assembler.push(text));
        },
        onCompleted: (transcript) => {
          const pending = stream.pendingCommits.shift();
          if (pending) clearTimeout(pending.timer);
          // Già chiusa allo scadere dell'attesa: il testo arrivato tardi non
          // deve riaprire la frase né chiudere a metà quella successiva.
          if (pending?.expired) return;
          this.deliver(stream, stream.assembler.finish(transcript));
        },
        onClosed: () => {
          if (stream.engine === session) stream.engine = null;
          stream.speaking = false;
          this.deliver(stream, stream.assembler.finish());
          this.gateway.released();
        },
      },
      this.gateway.now,
    );
    try {
      await session.open();
    } catch (err) {
      stream.opening = false;
      stream.endAfterOpen = false;
      stream.retryAt = this.gateway.now() + ENGINE_RETRY_MS;
      this.gateway.released();
      this.gateway.engineFailed((err as Error).message);
      return;
    }
    stream.opening = false;
    const endNow = stream.endAfterOpen;
    stream.endAfterOpen = false;
    this.gateway.engineOpened();
    if (this.closed || !this.gateway.accepting()) {
      session.close('closed');
      return;
    }
    stream.engine = session;
    stream.leadIn = true;
    for (const pcm of stream.buffered) this.feed(stream, pcm);
    if (stream.buffered.length > 0) stream.speaking = true;
    stream.buffered = [];
    stream.bufferedSeconds = 0;
    if (endNow) this.endUtterance(stream);
  }

  /** Senza pacchetti per `pauseGapMs` (microfono spento, o silenzio scartato dal client) la frase si chiude. */
  private armGapTimer(stream: Stream): void {
    if (stream.gapTimer) clearTimeout(stream.gapTimer);
    stream.gapTimer = setTimeout(() => {
      stream.gapTimer = null;
      this.endUtterance(stream);
    }, this.gateway.config.pauseGapMs);
  }

  private endUtterance(stream: Stream): void {
    stream.inSpeech = false;
    stream.silenceSeconds = 0;
    if (stream.opening) {
      // La frase è nel buffer: si chiude appena il motore l'ha ricevuta.
      if (stream.buffered.length > 0) stream.endAfterOpen = true;
      return;
    }
    stream.buffered = [];
    stream.bufferedSeconds = 0;
    if (!stream.engine || !stream.speaking) return;
    stream.speaking = false;
    stream.engine.commit();
    stream.leadIn = true;
    const pending: { timer: NodeJS.Timeout; expired: boolean } = {
      expired: false,
      timer: setTimeout(() => {
        pending.expired = true;
        this.deliver(stream, stream.assembler.finish());
      }, this.gateway.config.finishTimeoutMs),
    };
    stream.pendingCommits.push(pending);
  }

  stopEngine(stream: Stream, reason: string): void {
    const engine = stream.engine;
    stream.engine = null;
    stream.speaking = false;
    engine?.close(reason);
  }

  /** Chiude le sessioni delle voci zitte da più di `idleMs`, anche con il microfono aperto. */
  sweepIdle(idleMs: number): void {
    const now = this.gateway.now();
    for (const stream of this.streams.values()) {
      if (stream.engine && !stream.inSpeech && now - stream.lastVoiceAt > idleMs) this.stopEngine(stream, 'idle');
    }
  }

  private deliver(stream: Stream, updates: CaptionUpdate[]): void {
    for (const update of updates) {
      if (update.final) {
        if (stream.pendingInterim?.messageId === update.messageId) {
          stream.pendingInterim = null;
          if (stream.interimTimer) clearTimeout(stream.interimTimer);
          stream.interimTimer = null;
        }
        this.sendResult(stream, update);
        continue;
      }
      const now = this.gateway.now();
      const wait = this.gateway.config.interimIntervalMs - (now - stream.lastInterimAt);
      if (wait <= 0 && !stream.interimTimer) {
        stream.lastInterimAt = now;
        this.sendResult(stream, update);
      } else {
        stream.pendingInterim = update;
        stream.interimTimer ??= setTimeout(() => {
          stream.interimTimer = null;
          const pending = stream.pendingInterim;
          stream.pendingInterim = null;
          if (pending) {
            stream.lastInterimAt = this.gateway.now();
            this.sendResult(stream, pending);
          }
        }, Math.max(0, wait));
      }
    }
  }

  private sendResult(stream: Stream, update: CaptionUpdate): void {
    if (!update.text) return;
    this.send(
      transcriptionResult({
        messageId: update.messageId,
        endpointId: stream.endpointId,
        text: update.text,
        final: update.final,
        language: primaryLanguage(this.language),
        timestamp: this.gateway.now(),
      }),
    );
  }

  private send(text: string): void {
    if (this.closed || this.socket.readyState !== this.socket.OPEN) return;
    // Un bridge che non legge più non deve far crescere la memoria.
    if (this.socket.bufferedAmount > MAX_SOCKET_BUFFER) return;
    this.socket.send(text);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.contextTimer) clearTimeout(this.contextTimer);
    for (const stream of this.streams.values()) {
      for (const t of [stream.gapTimer, stream.interimTimer]) if (t) clearTimeout(t);
      for (const pending of stream.pendingCommits) clearTimeout(pending.timer);
      stream.pendingCommits = [];
      this.stopEngine(stream, 'session-end');
      stream.decoder?.free();
      stream.decoder = null;
    }
    this.streams.clear();
    this.gateway.unregister(this);
    try {
      this.socket.close(1000);
    } catch {
      this.socket.terminate();
    }
  }
}

export class Gateway {
  readonly governor: LoadGovernor;
  private conferences = new Set<Conference>();
  private engineUp = true;
  private snapshot: LoadSnapshot;
  private timers: NodeJS.Timeout[] = [];

  constructor(
    readonly config: Config,
    readonly contexts: ContextProvider,
    readonly now: () => number = Date.now,
  ) {
    this.governor = new LoadGovernor({
      maxStreams: config.maxStreams,
      degradeLagMs: config.degradeLagMs,
      pauseLagMs: config.pauseLagMs,
      pauseCooldownMs: config.pauseCooldownMs,
      maxPauseMs: config.maxPauseMs,
      now,
    });
    this.snapshot = this.governor.evaluate();
  }

  start(): void {
    this.timers.push(setInterval(() => this.tick(), 1000));
    // Ogni 10 s se il motore risponde, ogni 2 s se non risponde: tornato su,
    // i sottotitoli devono ripartire subito, non al controllo successivo.
    let elapsed = 0;
    this.timers.push(
      setInterval(() => {
        elapsed += 2000;
        if (!this.engineUp || elapsed >= 10_000) {
          elapsed = 0;
          void this.checkEngine();
        }
      }, 2000),
    );
    void this.checkEngine();
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    for (const conference of [...this.conferences]) conference.close();
  }

  async attach(socket: WebSocket, meetingId: string, room: string | null): Promise<Conference> {
    const conference = new Conference(this, socket, meetingId, room);
    this.conferences.add(conference);
    // I messaggi che arrivano mentre si chiede il contesto non vanno persi.
    const queued: string[] = [];
    let ready = false;
    socket.on('message', (data, isBinary) => {
      if (isBinary) return;
      const text = data.toString();
      if (ready) conference.handleMessage(text);
      else queued.push(text);
    });
    socket.on('close', () => conference.close());
    socket.on('error', () => conference.close());
    await conference.init();
    ready = true;
    // Se il bridge ha chiuso mentre si leggeva il contesto, handleMessage
    // scarta tutto: nessuna voce né decoder su una conferenza già chiusa.
    for (const text of queued) conference.handleMessage(text);
    return conference;
  }

  unregister(conference: Conference): void {
    this.conferences.delete(conference);
  }

  /** Si accetta audio solo se il motore risponde e la trascrizione non è sospesa. */
  accepting(): boolean {
    return this.snapshot.state === 'ok' || this.snapshot.state === 'degraded';
  }

  private activeEngines(): number {
    let n = 0;
    for (const c of this.conferences) {
      for (const s of c.streamsList()) if (s.engine || s.opening) n += 1;
    }
    return n;
  }

  /**
   * Una voce chiede una sessione del motore. Sotto il limite la ottiene;
   * sopra, la ottiene al posto della voce zitta da più tempo, se ce n'è una
   * che non parla da almeno `pauseGapMs`.
   */
  admit(stream: { lastVoiceAt: number }, _conference: Conference): boolean {
    if (!this.accepting()) return false;
    if (this.activeEngines() < this.snapshot.streamLimit) return true;
    const victim = this.leastRecent(
      (s) => s !== stream && !s.inSpeech && this.now() - s.lastVoiceAt >= this.config.pauseGapMs,
    );
    if (!victim) return false;
    victim.conference.stopEngine(victim.stream, 'evicted');
    return true;
  }

  private leastRecent(
    filter: (s: Stream) => boolean,
  ): { conference: Conference; stream: Stream } | null {
    let best: { conference: Conference; stream: Stream } | null = null;
    for (const conference of this.conferences) {
      for (const stream of conference.streamsList()) {
        if (!stream.engine || !filter(stream)) continue;
        if (!best || stream.lastVoiceAt < best.stream.lastVoiceAt) best = { conference, stream };
      }
    }
    return best;
  }

  /** Una sessione del motore si è chiusa: nulla da fare, il conteggio è sempre ricalcolato. */
  released(): void {}

  engineFailed(message: string): void {
    console.warn(`[captions] sessione del motore non aperta: ${message}`);
    void this.checkEngine();
  }

  /** Una sessione aperta prova che il motore risponde, senza aspettare il controllo periodico. */
  engineOpened(): void {
    if (this.engineUp) return;
    this.engineUp = true;
    this.governor.setEngineAvailable(true);
  }

  tick(): void {
    const before = this.snapshot.state;
    this.snapshot = this.governor.evaluate();
    if (this.snapshot.state !== before) {
      console.log(
        `[captions] stato ${before} → ${this.snapshot.state}` +
          (this.snapshot.reason ? ` (${this.snapshot.reason})` : ''),
      );
    }
    if (!this.accepting()) {
      for (const c of this.conferences) for (const s of c.streamsList()) if (s.engine) c.stopEngine(s, 'paused');
    } else {
      // Limite ridotto: si chiudono le sessioni in eccesso, partendo dalle voci zitte da più tempo.
      let excess = this.activeEngines() - this.snapshot.streamLimit;
      while (excess > 0) {
        const victim = this.leastRecent(() => true);
        if (!victim) break;
        victim.conference.stopEngine(victim.stream, 'limit');
        excess -= 1;
      }
    }
    for (const c of this.conferences) c.sweepIdle(this.config.idleCloseMs);
  }

  async checkEngine(): Promise<void> {
    let up = false;
    try {
      const res = await fetch(this.config.engineHealthUrl, { signal: AbortSignal.timeout(3000) });
      up = res.ok;
    } catch {
      up = false;
    }
    if (up !== this.engineUp) {
      console.log(`[captions] motore ${up ? 'raggiungibile' : 'non raggiungibile'}`);
    }
    this.engineUp = up;
    this.governor.setEngineAvailable(up);
  }

  status(): GatewayStatus {
    let streams = 0;
    for (const c of this.conferences) for (const s of c.streamsList()) if (s.engine) streams += 1;
    return {
      ...this.snapshot,
      engine: this.engineUp ? 'up' : 'down',
      conferences: this.conferences.size,
      activeStreams: streams,
      maxStreams: this.config.maxStreams,
    };
  }
}
