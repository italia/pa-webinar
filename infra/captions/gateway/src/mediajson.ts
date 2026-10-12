/**
 * Il protocollo tra il bridge Jitsi e il servizio di trascrizione ("mediajson",
 * derivato dal formato di VoxImplant): JSON su WebSocket.
 *
 * Dal bridge arrivano `start` (una volta per sorgente audio), `media` (un
 * pacchetto RTP Opus in base64), `ping` e `session-end`. I campi numerici
 * possono arrivare come stringhe. Verso il bridge vanno `pong` e
 * `transcription-result`, che il bridge inoltra a tutti i partecipanti sul
 * proprio canale: il campo `event` serve al bridge per riconoscerlo, `type`
 * al client Jitsi.
 */

export type IncomingEvent =
  | {
      kind: 'start';
      tag: string;
      endpointId: string;
      encoding: string;
      sampleRate: number;
      channels: number;
    }
  | { kind: 'media'; tag: string; timestamp: number; payload: Uint8Array }
  | { kind: 'ping'; id: number }
  | { kind: 'session-end' }
  | { kind: 'other'; event: string };

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * L'endpoint a cui appartiene una sorgente. Fino a stable-11031 il tag è
 * `<endpointId>-<ssrc>`, dopo è il nome della sorgente (`<endpointId>-a0`):
 * in entrambi i casi l'endpoint è la parte esadecimale iniziale.
 */
export function endpointFromTag(tag: string): string {
  const match = /^([0-9a-fA-F]+)-/.exec(tag);
  return match?.[1] ?? tag;
}

/** Interpreta un messaggio del bridge; `null` se non è JSON valido o manca qualcosa. */
export function parseEvent(text: string): IncomingEvent | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(data) || typeof data.event !== 'string') return null;

  switch (data.event) {
    case 'start': {
      const start = data.start;
      if (!isObject(start) || typeof start.tag !== 'string') return null;
      const format = isObject(start.mediaFormat) ? start.mediaFormat : {};
      const custom = isObject(start.customParameters) ? start.customParameters : {};
      const endpointId =
        typeof custom.endpointId === 'string' && custom.endpointId
          ? custom.endpointId
          : endpointFromTag(start.tag);
      return {
        kind: 'start',
        tag: start.tag,
        endpointId,
        encoding: typeof format.encoding === 'string' ? format.encoding.toLowerCase() : 'opus',
        sampleRate: toNumber(format.sampleRate) ?? 48000,
        channels: toNumber(format.channels) ?? 2,
      };
    }
    case 'media': {
      const media = data.media;
      if (!isObject(media) || typeof media.tag !== 'string' || typeof media.payload !== 'string') {
        return null;
      }
      const timestamp = toNumber(media.timestamp);
      if (timestamp === null) return null;
      return {
        kind: 'media',
        tag: media.tag,
        timestamp,
        payload: new Uint8Array(Buffer.from(media.payload, 'base64')),
      };
    }
    case 'ping': {
      const id = toNumber(data.id);
      return id === null ? null : { kind: 'ping', id };
    }
    case 'session-end':
      return { kind: 'session-end' };
    default:
      return { kind: 'other', event: data.event };
  }
}

export function pong(id: number): string {
  return JSON.stringify({ event: 'pong', id });
}

/** Stabilità dei provvisori: le parole del modello in streaming non cambiano più. */
export const INTERIM_STABILITY = 0.9;

export interface TranscriptionResult {
  messageId: string;
  endpointId: string;
  text: string;
  final: boolean;
  /** Lingua del testo, solo il codice primario ("it"). */
  language: string;
  timestamp: number;
}

export function transcriptionResult(r: TranscriptionResult): string {
  return JSON.stringify({
    event: 'transcription-result',
    type: 'transcription-result',
    message_id: r.messageId,
    participant: { id: r.endpointId },
    is_interim: !r.final,
    ...(r.final ? {} : { stability: INTERIM_STABILITY }),
    transcript: [{ text: r.text }],
    language: r.language,
    timestamp: r.timestamp,
  });
}

/** "it-IT" → "it"; "auto" resta "auto" finché il modello non dice altro. */
export function primaryLanguage(code: string): string {
  return code.split(/[-_]/)[0]?.toLowerCase() || code;
}
