/**
 * Le frasi definitive dei sottotitoli, mandate al portale per la trascrizione
 * dell'evento (Event.captionsTranscriptEnabled).
 *
 * Il gateway non sa chi parla: conosce solo l'endpoint del bridge. E' il
 * portale a decidere, voce per voce, se la frase si tiene (chi ha dato il
 * consenso alla trascrizione dei propri interventi) o se ne resta solo il
 * segno che qualcuno ha parlato. Qui nessun testo viene scritto su disco né
 * nei log.
 *
 * Le frasi partono a blocchi, ogni `flushMs` o quando il blocco e' pieno. Se
 * il portale non risponde si riprovano, fino a un tetto oltre il quale le
 * piu' vecchie si perdono: la sala non deve risentirne.
 */

/** Di quale conferenza: la stanza quando il bridge la passa, la riunione sempre. */
export interface Conferenza {
  room: string | null;
  meetingId: string;
}

export interface CaptionSegment {
  messageId: string;
  endpointId: string;
  text: string;
  /** Assente se il servizio non la sa (o non e' nei limiti del portale). */
  language?: string;
  startedAt: string;
  endedAt: string;
}

/** Quante frasi tenere in attesa al massimo, per stanza. */
const MAX_QUEUED = 500;

export class TranscriptSink {
  private queues = new Map<string, { conferenza: Conferenza; frasi: CaptionSegment[] }>();
  private timer: NodeJS.Timeout | null = null;
  private sending = false;

  constructor(
    private readonly opts: {
      url: string | null;
      token: string | null;
      flushMs?: number;
      batchSize?: number;
      timeoutMs?: number;
      fetchImpl?: typeof fetch;
    },
  ) {}

  get enabled(): boolean {
    return this.opts.url !== null;
  }

  add(conferenza: Conferenza, frase: CaptionSegment): void {
    if (!this.enabled) return;
    // Nei limiti che il portale accetta: una frase fuori misura farebbe
    // rifiutare tutto il blocco (HTTP 400), con le frasi buone che ha accanto.
    const segment = nelleMisure(frase);
    if (!segment) return;
    const chiave = `${conferenza.meetingId}|${conferenza.room ?? ''}`;
    const coda = this.queues.get(chiave) ?? { conferenza, frasi: [] };
    const queue = coda.frasi;
    queue.push(segment);
    if (queue.length > MAX_QUEUED) queue.splice(0, queue.length - MAX_QUEUED);
    this.queues.set(chiave, coda);
    if (queue.length >= (this.opts.batchSize ?? 20)) void this.flush();
    else this.timer ??= setTimeout(() => void this.flush(), this.opts.flushMs ?? 2000);
  }

  /** Manda quello che c'e'; cio' che il portale non prende resta per il giro dopo. */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.sending || !this.opts.url) return;
    this.sending = true;
    try {
      for (const [chiave, { conferenza, frasi: queue }] of [...this.queues]) {
        if (queue.length === 0) {
          this.queues.delete(chiave);
          continue;
        }
        const batch = queue.slice(0, this.opts.batchSize ?? 20);
        const ok = await this.post(conferenza, batch);
        if (!ok) continue;
        queue.splice(0, batch.length);
        if (queue.length === 0) this.queues.delete(chiave);
      }
    } finally {
      this.sending = false;
    }
    if ([...this.queues.values()].some((q) => q.frasi.length > 0)) {
      this.timer ??= setTimeout(() => void this.flush(), this.opts.flushMs ?? 2000);
    }
  }

  private async post(conferenza: Conferenza, segments: CaptionSegment[]): Promise<boolean> {
    try {
      const res = await (this.opts.fetchImpl ?? fetch)(this.opts.url as string, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.opts.token ? { 'x-api-key': this.opts.token } : {}),
        },
        body: JSON.stringify({
          ...(conferenza.room ? { room: conferenza.room } : {}),
          meetingId: conferenza.meetingId,
          segments,
        }),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 5000),
      });
      if (res.ok) return true;
      // Un rifiuto per dati non validi non migliora riprovando. Chiave
      // sbagliata (401, 403) o portale che non conosce ancora la rotta (404,
      // aggiornamento a meta') invece si sistemano: le frasi restano in coda,
      // nei limiti della coda.
      if (res.status >= 400 && res.status < 500 && ![401, 403, 404, 408, 429].includes(res.status)) {
        console.warn(`[captions] trascrizione rifiutata dal portale (HTTP ${res.status}): frasi scartate`);
        return true;
      }
      console.warn(`[captions] trascrizione non consegnata (HTTP ${res.status}), si riprova`);
      return false;
    } catch (err) {
      console.warn(`[captions] trascrizione non consegnata: ${(err as Error).message}, si riprova`);
      return false;
    }
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

/** I limiti della rotta del portale (api/internal/captions/segments). */
const MISURE = { messageId: 80, endpointId: 64, text: 2000, lingua: [2, 8] } as const;

export function nelleMisure(f: CaptionSegment): CaptionSegment | null {
  const text = f.text.trim().slice(0, MISURE.text);
  if (!text || !f.messageId || f.messageId.length > MISURE.messageId) return null;
  if (!f.endpointId || f.endpointId.length > MISURE.endpointId) return null;
  const lingua =
    f.language && f.language.length >= MISURE.lingua[0] && f.language.length <= MISURE.lingua[1]
      ? f.language
      : undefined;
  return { ...f, text, language: lingua };
}

/**
 * L'indirizzo a cui mandare le frasi: quello esplicito, o quello accanto
 * all'indirizzo del contesto (`…/captions/context` → `…/captions/segments`).
 */
export function segmentsUrl(explicit: string | null, contextUrl: string | null): string | null {
  if (explicit) return explicit;
  if (!contextUrl) return null;
  try {
    return new URL('segments', contextUrl).toString();
  } catch {
    return null;
  }
}
