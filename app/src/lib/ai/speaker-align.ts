/**
 * ADR-013 Fase 0 — allineamento diarization pyannote ↔ timeline dominant-speaker.
 *
 * pyannote produce cluster acustici anonimi (`SPEAKER_00`, `SPEAKER_01`, …).
 * Jitsi, durante l'evento, conosce la verità di base: chi era il dominant
 * speaker e quando. Catturiamo quella timeline (vedi `jitsi-room.tsx` +
 * `/api/events/[param]/speaker-events`) e la usiamo qui per dare un nome
 * reale a ogni cluster, senza mapping manuale.
 *
 * Logica PURA (niente IO/DB): testabile in isolamento.
 */

/** Segmento di trascrizione attribuito a un cluster pyannote. */
export interface DiarizationSegment {
  /** inizio in secondi dall'avvio della registrazione */
  start: number;
  /** fine in secondi dall'avvio della registrazione */
  end: number;
  /** etichetta del cluster pyannote, es. "SPEAKER_00" */
  speaker: string;
}

/** Evento dominant-speaker catturato dall'IFrame API Jitsi. */
export interface SpeakerLogEntry {
  /** millisecondi dall'avvio della sessione (t0 = join) */
  atMs: number;
  /** endpoint id Jitsi del partecipante diventato dominante */
  participantId: string;
  /** displayName del partecipante (PII), se noto al momento dell'evento */
  displayName?: string;
}

/**
 * Intervallo temporale (in millisecondi) in cui un dato partecipante è stato
 * il dominant speaker. La timeline grezza è una sequenza di "cambi": ogni
 * entry resta dominante finché non arriva l'entry successiva.
 */
interface DominantInterval {
  startMs: number;
  endMs: number;
  participantId: string;
  displayName?: string;
}

/**
 * Converte la timeline grezza (lista di cambi) in intervalli `[start, end)`.
 * L'ultimo intervallo si estende fino a `+Infinity`: l'ultimo dominant
 * speaker resta tale fino a fine registrazione (non sappiamo quando smette,
 * ma sappiamo che era l'ultimo a parlare).
 */
function toIntervals(log: SpeakerLogEntry[]): DominantInterval[] {
  // Ordina per timestamp: l'ingest è append-only e dovrebbe già essere
  // ordinato, ma batch/retry potrebbero arrivare fuori sequenza.
  const sorted = [...log].sort((a, b) => a.atMs - b.atMs);

  const intervals: DominantInterval[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i]!;
    const next = sorted[i + 1];
    intervals.push({
      startMs: entry.atMs,
      endMs: next ? next.atMs : Number.POSITIVE_INFINITY,
      participantId: entry.participantId,
      displayName: entry.displayName,
    });
  }
  return intervals;
}

/** Sovrapposizione (in ms) tra due intervalli `[aStart,aEnd)` e `[bStart,bEnd)`. */
function overlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  const lo = Math.max(aStart, bStart);
  const hi = Math.min(aEnd, bEnd);
  return Math.max(0, hi - lo);
}

/**
 * Per ogni cluster pyannote calcola quale partecipante era dominante per più
 * tempo durante i segmenti di quel cluster, e ritorna la mappa
 * `diarLabel → displayName` del partecipante "best match".
 *
 * - I segmenti pyannote sono in secondi; la timeline è in millisecondi →
 *   convertiamo i segmenti in ms per il calcolo dell'overlap.
 * - Se il log è vuoto, ritorna una mappa vuota (nessuna attribuzione).
 * - Se per un cluster nessun partecipante ha overlap > 0 (nessun dominant
 *   speaker chiaro), il cluster viene omesso dalla mappa.
 * - Il best match richiede un displayName noto: un partecipante senza nome
 *   (solo endpoint id) non produce un'etichetta umana, quindi non vince.
 */
export function alignDiarizationToSpeakers(
  segments: DiarizationSegment[],
  log: SpeakerLogEntry[],
): Map<string, string> {
  const result = new Map<string, string>();
  if (log.length === 0 || segments.length === 0) {
    return result;
  }

  const intervals = toIntervals(log);

  // Raggruppa i segmenti per cluster pyannote.
  const byCluster = new Map<string, DiarizationSegment[]>();
  for (const seg of segments) {
    const list = byCluster.get(seg.speaker);
    if (list) {
      list.push(seg);
    } else {
      byCluster.set(seg.speaker, [seg]);
    }
  }

  for (const [diarLabel, segs] of byCluster) {
    // Accumula i ms di sovrapposizione per ogni partecipante.
    const scoreByParticipant = new Map<string, number>();
    // Tieni il displayName noto per ciascun participantId.
    const nameByParticipant = new Map<string, string>();

    for (const seg of segs) {
      const segStartMs = seg.start * 1000;
      const segEndMs = seg.end * 1000;
      for (const iv of intervals) {
        const ov = overlapMs(segStartMs, segEndMs, iv.startMs, iv.endMs);
        if (ov <= 0) continue;
        scoreByParticipant.set(
          iv.participantId,
          (scoreByParticipant.get(iv.participantId) ?? 0) + ov,
        );
        if (iv.displayName) {
          nameByParticipant.set(iv.participantId, iv.displayName);
        }
      }
    }

    // Best match: partecipante con più ms di overlap che ABBIA un displayName.
    let bestName: string | undefined;
    let bestScore = 0;
    for (const [participantId, score] of scoreByParticipant) {
      const name = nameByParticipant.get(participantId);
      if (!name) continue; // senza nome non possiamo etichettare
      if (score > bestScore) {
        bestScore = score;
        bestName = name;
      }
    }

    if (bestName) {
      result.set(diarLabel, bestName);
    }
  }

  return result;
}
