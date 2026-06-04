/**
 * Storage path conventions for postprod artifacts.
 *
 * All AI outputs live under a single prefix `postprod/` so the
 * existing recordings reconciliation cron can be cloned 1:1 onto
 * postprod artifacts (orphan sweep, retention).
 *
 * Layout:
 *
 *     postprod/{eventId}/{recordingId}/{runId}/
 *         transcript.raw.json
 *         transcript.{lang}.vtt
 *         transcript.{lang}.txt
 *         summary.{lang}.md
 *         subtitle.{lang}.vtt           // alias of transcript.{lang}.vtt
 *
 * `runId` is the `Recording.runCount` value as a zero-padded string
 * (`001`, `002`, …) so:
 *   - successive re-runs co-exist without overwriting older artifacts,
 *   - lexicographic listing of `postprod/{eventId}/{recordingId}/`
 *     yields runs newest-last,
 *   - the retention cron can prune entire runs by deleting the run
 *     prefix instead of file-by-file.
 *
 * All helpers here are pure string builders. Storage access goes
 * through `StorageProvider` (lib/storage/provider.ts).
 */

import type {
  PostprodArtifactType,
  PostprodJobKind,
} from '@prisma/client';

export const POSTPROD_PREFIX = 'postprod';

/** Format a runId: 1 -> "001", 12 -> "012", 999 -> "999", 1000 -> "1000". */
export function formatRunId(runCount: number): string {
  if (!Number.isInteger(runCount) || runCount < 1) {
    throw new Error(`invalid runCount: ${String(runCount)}`);
  }
  return runCount.toString().padStart(3, '0');
}

export interface PostprodPathInput {
  eventId: string;
  recordingId: string;
  runCount: number;
}

/** Prefix that owns all artifacts for a single run of a recording. */
export function runPrefix(input: PostprodPathInput): string {
  return `${POSTPROD_PREFIX}/${input.eventId}/${input.recordingId}/${formatRunId(
    input.runCount,
  )}`;
}

/** All artifacts ever produced for a recording (across runs). */
export function recordingPrefix(input: {
  eventId: string;
  recordingId: string;
}): string {
  return `${POSTPROD_PREFIX}/${input.eventId}/${input.recordingId}`;
}

/** All postprod artifacts for an event (across recordings + runs). */
export function eventPrefix(eventId: string): string {
  return `${POSTPROD_PREFIX}/${eventId}`;
}

/**
 * Concrete blob keys per artifact type. `lang` is required for VTT/TXT/MD
 * variants. The mapping is intentionally tight: an unknown type throws
 * so callers don't accidentally produce a path the reconciliation cron
 * doesn't recognise.
 */
export function artifactPath(
  input: PostprodPathInput,
  type: PostprodArtifactType,
  language: string | null,
): string {
  const base = runPrefix(input);
  switch (type) {
    case 'TRANSCRIPT_JSON':
      return `${base}/transcript.raw.json`;
    case 'WAVEFORM_JSON':
      return `${base}/waveform.json`;
    case 'TRANSCRIPT_VTT':
      if (!language) throw new Error('TRANSCRIPT_VTT requires a language');
      return `${base}/transcript.${language}.vtt`;
    case 'TRANSCRIPT_TXT':
      if (!language) throw new Error('TRANSCRIPT_TXT requires a language');
      return `${base}/transcript.${language}.txt`;
    case 'SUMMARY_MD':
      if (!language) throw new Error('SUMMARY_MD requires a language');
      return `${base}/summary.${language}.md`;
    case 'SUBTITLE_VTT':
      if (!language) throw new Error('SUBTITLE_VTT requires a language');
      return `${base}/subtitle.${language}.vtt`;
    case 'TRANSLATION_VTT':
      if (!language) throw new Error('TRANSLATION_VTT requires a language');
      return `${base}/transcript.${language}.vtt`;
    case 'TRANSLATION_MD':
      if (!language) throw new Error('TRANSLATION_MD requires a language');
      return `${base}/summary.${language}.md`;
    case 'DUBBED_AUDIO':
      if (!language) throw new Error('DUBBED_AUDIO requires a language');
      // m4a (AAC in MP4 container) — supportato nativamente da
      // HTMLAudioElement in tutti i browser, codec efficiente per
      // parlato (~64 kbps mono basta).
      return `${base}/dubbed.${language}.m4a`;
    case 'DUBBED_VIDEO':
      if (!language) throw new Error('DUBBED_VIDEO requires a language');
      return `${base}/dubbed.${language}.mp4`;
    case 'SUMMARY_JSON':
      if (!language) throw new Error('SUMMARY_JSON requires a language');
      return `${base}/summary.${language}.json`;
    case 'ARCHIVE_MKV':
      // Contenitore multi-traccia (video + N audio + sottotitoli),
      // language-agnostico → nessun suffisso lingua.
      return `${base}/archive.mkv`;
    default: {
      const _exhaustive: never = type;
      throw new Error(`unknown artifact type: ${String(_exhaustive)}`);
    }
  }
}

/** Content-type for an artifact (used to set presigned PUT contentType). */
export function artifactMimeType(type: PostprodArtifactType): string {
  switch (type) {
    case 'TRANSCRIPT_JSON':
    case 'SUMMARY_JSON':
    case 'WAVEFORM_JSON':
      return 'application/json';
    case 'TRANSCRIPT_VTT':
    case 'SUBTITLE_VTT':
    case 'TRANSLATION_VTT':
      return 'text/vtt';
    case 'TRANSCRIPT_TXT':
      return 'text/plain; charset=utf-8';
    case 'SUMMARY_MD':
    case 'TRANSLATION_MD':
      return 'text/markdown; charset=utf-8';
    case 'DUBBED_AUDIO':
      return 'audio/mp4';
    case 'DUBBED_VIDEO':
      return 'video/mp4';
    case 'ARCHIVE_MKV':
      return 'video/x-matroska';
    default: {
      const _exhaustive: never = type;
      throw new Error(`unknown artifact type: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Map a job `kind` (+ payload language) to the artifact types it
 * produces. The orchestrator uses this to generate the upload-targets
 * map handed to the worker on claim.
 */
export interface ExpectedArtifact {
  role: string;
  type: PostprodArtifactType;
  language: string | null;
}

export function expectedArtifactsForJob(
  kind: PostprodJobKind,
  payload: { sourceLanguage?: string; language?: string; targetLanguage?: string },
): ExpectedArtifact[] {
  switch (kind) {
    // TRANSCRIBE (mix Jibri, diarization pyannote) e TRANSCRIBE_MULTITRACK
    // (una traccia per partecipante, merge senza diarization — ADR-013)
    // producono gli stessi artifact: transcript JSON/VTT/TXT nella lingua
    // sorgente. Cambia solo COME il worker li ottiene (diarization vs
    // merge di tracce), non l'output.
    case 'TRANSCRIBE':
    case 'TRANSCRIBE_MULTITRACK': {
      const lang = payload.sourceLanguage ?? 'it';
      return [
        { role: 'transcriptJson', type: 'TRANSCRIPT_JSON', language: null },
        { role: 'transcriptVtt', type: 'TRANSCRIPT_VTT', language: lang },
        { role: 'transcriptTxt', type: 'TRANSCRIPT_TXT', language: lang },
      ];
    }
    case 'SUMMARIZE': {
      const lang = payload.sourceLanguage ?? 'it';
      return [{ role: 'summary', type: 'SUMMARY_MD', language: lang }];
    }
    case 'TRANSLATE': {
      const lang = payload.targetLanguage ?? 'en';
      return [
        { role: 'transcriptVtt', type: 'TRANSLATION_VTT', language: lang },
        { role: 'summary', type: 'TRANSLATION_MD', language: lang },
      ];
    }
    case 'SUBTITLE': {
      const lang = payload.language ?? 'it';
      return [{ role: 'subtitle', type: 'SUBTITLE_VTT', language: lang }];
    }
    case 'DUB': {
      const lang = payload.targetLanguage ?? 'en';
      return [{ role: 'dubbedAudio', type: 'DUBBED_AUDIO', language: lang }];
    }
    case 'ARCHIVE': {
      // Un singolo contenitore MKV multi-traccia, language-agnostico.
      return [{ role: 'archive', type: 'ARCHIVE_MKV', language: null }];
    }
    default: {
      const _exhaustive: never = kind;
      throw new Error(`unknown job kind: ${String(_exhaustive)}`);
    }
  }
}
