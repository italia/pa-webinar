/**
 * Una sessione del motore di riconoscimento (NeMo-Speech.cpp, rotta
 * `/v1/audio/transcriptions/realtime`) per una voce.
 *
 * Protocollo del motore: dopo `session.created` si manda un solo
 * `session.update` (lingua, frasi da favorire), poi PCM16 mono a 16 kHz in
 * frame binari. Il motore risponde con `...transcription.delta` (testo solo in
 * coda, con `audio_processed` = secondi elaborati del tratto corrente). Un
 * `input_audio_buffer.commit` chiude il tratto: arrivano `...completed` con il
 * testo intero e `input_audio_buffer.committed`, e il tratto successivo
 * riparte da zero, anche nel conteggio dei secondi.
 *
 * Il ritardo si misura confrontando `audio_processed` con l'istante in cui
 * quell'audio era stato inviato.
 */

import WebSocket from 'ws';

export interface EngineSessionOptions {
  url: string;
  language: string;
  phrases: string[];
  boost: number;
  openTimeoutMs?: number;
}

export interface EngineCallbacks {
  onDelta(text: string, lagMs: number | null): void;
  onCompleted(transcript: string): void;
  onClosed(reason: string): void;
}

const SAMPLE_RATE = 16000;

interface Segment {
  /** Secondi di audio inviati in questo tratto. */
  sent: number;
  /** [fine dell'audio inviato in secondi, istante dell'invio in ms]. */
  marks: Array<[number, number]>;
}

export class EngineSession {
  private ws: WebSocket | null = null;
  private closed = false;
  /** Tratto a cui va l'audio inviato ora. */
  private sending: Segment = { sent: 0, marks: [] };
  /** Tratti chiusi da un commit di cui il motore non ha ancora confermato la fine. */
  private pending: Segment[] = [];

  constructor(
    private readonly opts: EngineSessionOptions,
    private readonly cb: EngineCallbacks,
    private readonly now: () => number = Date.now,
  ) {}

  /** Apre la sessione e la configura; rifiuta se il motore non risponde in tempo. */
  open(): Promise<void> {
    const timeoutMs = this.opts.openTimeoutMs ?? 5000;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.opts.url, { handshakeTimeout: timeoutMs, maxPayload: 1 << 20 });
      this.ws = ws;
      let configured = false;
      const timer = setTimeout(() => {
        if (!configured) {
          ws.terminate();
          reject(new Error('timeout del motore'));
        }
      }, timeoutMs);

      ws.on('message', (data, isBinary) => {
        if (isBinary) return;
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(data.toString()) as Record<string, unknown>;
        } catch {
          return;
        }
        const type = typeof event.type === 'string' ? event.type : '';
        if (!configured) {
          if (type === 'session.created') {
            const session: Record<string, unknown> = {
              sample_rate: SAMPLE_RATE,
              language: this.opts.language,
            };
            if (this.opts.phrases.length > 0 && this.opts.boost > 0) {
              session.speech_contexts = [{ phrases: this.opts.phrases, boost: this.opts.boost }];
            }
            ws.send(JSON.stringify({ type: 'session.update', session }));
          } else if (type === 'session.updated') {
            configured = true;
            clearTimeout(timer);
            resolve();
          } else if (type === 'error') {
            clearTimeout(timer);
            ws.terminate();
            reject(new Error('sessione rifiutata dal motore'));
          }
          return;
        }
        this.handle(type, event);
      });
      ws.on('error', (err) => {
        if (!configured) {
          clearTimeout(timer);
          reject(err);
        }
      });
      ws.on('close', () => {
        clearTimeout(timer);
        if (!configured) {
          reject(new Error('il motore ha chiuso la connessione'));
          return;
        }
        if (!this.closed) {
          this.closed = true;
          this.cb.onClosed('engine-closed');
        }
      });
    });
  }

  private handle(type: string, event: Record<string, unknown>): void {
    if (type.endsWith('transcription.delta')) {
      const text = typeof event.delta === 'string' ? event.delta : '';
      if (!text) return;
      const processed = typeof event.audio_processed === 'number' ? event.audio_processed : null;
      this.cb.onDelta(text, processed === null ? null : this.lagFor(processed));
    } else if (type.endsWith('transcription.completed')) {
      this.cb.onCompleted(typeof event.transcript === 'string' ? event.transcript : '');
    } else if (type === 'input_audio_buffer.committed') {
      this.pending.shift();
    } else if (type === 'error') {
      this.close('engine-error');
    }
  }

  /** Il tratto a cui si riferiscono gli eventi in arrivo: il più vecchio non ancora confermato. */
  private receiving(): Segment {
    return this.pending[0] ?? this.sending;
  }

  /** Ritardo tra l'invio dell'audio fino a `processed` secondi e adesso. */
  lagFor(processed: number): number | null {
    const segment = this.receiving();
    const mark = segment.marks.find(([end]) => end >= processed - 1e-3);
    return mark ? this.now() - mark[1] : null;
  }

  get isOpen(): boolean {
    return !this.closed && this.ws?.readyState === WebSocket.OPEN;
  }

  sendPcm(pcm: Buffer): void {
    if (!this.isOpen || pcm.length === 0) return;
    this.sending.sent += pcm.length / 2 / SAMPLE_RATE;
    this.sending.marks.push([this.sending.sent, this.now()]);
    // Bastano i segni degli ultimi secondi: il ritardo oltre si sospende prima.
    if (this.sending.marks.length > 1500) this.sending.marks.splice(0, 500);
    this.ws?.send(pcm);
  }

  /** Chiude il tratto corrente: il motore manda il testo definitivo e riparte da zero. */
  commit(): void {
    if (!this.isOpen || this.sending.sent === 0) return;
    this.ws?.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    this.pending.push(this.sending);
    this.sending = { sent: 0, marks: [] };
  }

  close(reason = 'closed'): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.ws?.close();
    } catch {
      this.ws?.terminate();
    }
    this.cb.onClosed(reason);
  }
}
