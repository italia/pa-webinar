/**
 * GET/PUT /api/admin/postprod/recordings/[id]/transcript
 *
 * Admin transcript editor backend.
 *
 *   GET  — return the raw, editable segments (text + diar speaker) of
 *          the recording's TRANSCRIPT_JSON, plus the speaker roster so
 *          the UI can offer a per-segment speaker dropdown. Unlike the
 *          public transcript endpoint this does NOT remap anonymous
 *          speakers to "Partecipante N": the admin needs the raw
 *          diar labels to fix mis-attributions.
 *
 *   PUT  — apply a sparse list of segment edits (corrected text and/or
 *          re-assigned speaker), then:
 *            1. rewrite TRANSCRIPT_JSON (source of truth) — re-encrypt,
 *               recompute content hash + size,
 *            2. regenerate the source-language TRANSCRIPT_VTT from the
 *               same segments so the player overlay matches,
 *            3. recompute every Speaker.totalSpeechSec from the final
 *               speaker assignment.
 *
 * Editing the source transcript does NOT re-run translation/dubbing —
 * those are downstream AI artifacts. The admin must "re-run" the
 * pipeline if they want derived languages refreshed; the UI says so.
 *
 * Auth: admin session cookie (same as the rest of /api/admin/postprod).
 */

import { z } from 'zod';
import { cookies } from 'next/headers';

import { withErrorHandling } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { prisma } from '@/lib/db';
import { conservaOriginali } from '@/lib/ai/original-body';
import { NotFoundError, UnauthorizedError, ValidationError } from '@/lib/errors';
import { encryptPII, tryDecryptPII } from '@/lib/crypto/pii';
import { buildVtt, parseInlineTranscriptJson, sha256Hex } from '@/lib/ai/transcript-format';

export const dynamic = 'force-dynamic';

interface SegmentWord {
  start: number;
  end: number;
  word: string;
  prob?: number;
}

interface Segment {
  start: number;
  end: number;
  text: string;
  speaker?: string | null;
  words?: SegmentWord[];
  [key: string]: unknown;
}

interface TranscriptJson {
  segments?: Segment[];
  language?: string;
  [key: string]: unknown;
}

/** Load the recording + its TRANSCRIPT_JSON / TRANSCRIPT_VTT artifacts. */
async function loadRecording(id: string) {
  return prisma.recording.findUnique({
    where: { id },
    select: {
      id: true,
      // La conservazione dell'originale è per-evento tanto quanto
      // per-registrazione: la pulizia dei dati lavora anche per evento.
      eventId: true,
      sourceLanguage: true,
      durationSec: true,
      speakers: {
        select: {
          id: true,
          diarLabel: true,
          displayName: true,
          totalSpeechSec: true,
        },
      },
      artifacts: {
        where: { type: { in: ['TRANSCRIPT_JSON', 'TRANSCRIPT_VTT', 'WAVEFORM_JSON'] } },
        select: {
          id: true,
          type: true,
          language: true,
          inlineBody: true,
          // Servono a conservare il testo della macchina: si copia com'è,
          // con il suo hash, la sua dimensione e il modello che l'ha prodotto.
          contentHash: true,
          sizeBytes: true,
          modelId: true,
          modelVersion: true,
          revisedAt: true,
          recordingId: true,
        },
      },
    },
  });
}

function parseTranscript(inlineBody: string | null): TranscriptJson {
  return parseInlineTranscriptJson<TranscriptJson>(inlineBody) ?? {};
}

export const GET = withErrorHandling(async (_request, context) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const { id } = await (context as { params: Promise<{ id: string }> }).params;

  const recording = await loadRecording(id);
  if (!recording) throw new NotFoundError('Recording');

  const jsonArtifact = recording.artifacts.find((a) => a.type === 'TRANSCRIPT_JSON');
  if (!jsonArtifact) {
    // No transcript produced yet (pipeline not run / still processing). Return
    // an OK, empty payload with hasTranscript:false so the editor shows a
    // helpful "not ready" state instead of a 404 that reads as a hard failure.
    return Response.json({
      recordingId: recording.id,
      sourceLanguage: recording.sourceLanguage ?? 'it',
      durationSec: recording.durationSec ?? null,
      segments: [],
      speakers: [],
      waveform: null,
      mediaUrl: `/api/admin/postprod/recordings/${recording.id}/media`,
      hasTranscript: false,
    });
  }

  const transcript = parseTranscript(jsonArtifact.inlineBody);

  // Il testo come l'ha prodotto la macchina, se è stato conservato. Serve a
  // distinguere ciò che ha detto la macchina da ciò che ha corretto una
  // persona: per un verbale pubblico le due cose non possono confondersi.
  const conservato = await prisma.postprodOriginalBody.findUnique({
    where: { artifactId: jsonArtifact.id },
    select: { body: true, capturedAt: true, modelId: true, modelVersion: true },
  });
  const segmentiOriginali = conservato ? (parseTranscript(conservato.body).segments ?? []) : [];
  // Il confronto è per indice, e regge perché la correzione non aggiunge né
  // toglie segmenti. Se i due elenchi hanno lunghezze diverse non si confronta
  // riga per riga: si dichiara la discordanza e basta.
  const confrontabile = conservato !== null && segmentiOriginali.length === (transcript.segments ?? []).length;

  const segments = (transcript.segments ?? []).map((s, index) => {
    const originale = confrontabile ? segmentiOriginali[index] : undefined;
    return {
      index,
      start: s.start,
      end: s.end,
      text: s.text,
      speaker: s.speaker ?? null,
      // Presenti solo dove il testo differisce davvero: un editor che mostra
      // “originale identico” su ogni riga non aiuta a leggere niente.
      originalText: originale && originale.text !== s.text ? originale.text : null,
    };
  });

  // Waveform peaks (optional). Produced by newer worker runs; absent on
  // older recordings, in which case the editor draws a segment-only
  // timeline. Inlined JSON, so no storage fetch.
  let waveform: unknown = null;
  const waveformArtifact = recording.artifacts.find((a) => a.type === 'WAVEFORM_JSON');
  if (waveformArtifact?.inlineBody) {
    const decoded = tryDecryptPII(waveformArtifact.inlineBody);
    if (decoded) {
      try {
        waveform = JSON.parse(decoded);
      } catch {
        // corrupt payload — fall back to no waveform
      }
    }
  }

  return Response.json({
    recordingId: recording.id,
    sourceLanguage: recording.sourceLanguage ?? transcript.language ?? 'it',
    durationSec: recording.durationSec ?? null,
    segments,
    // Raw roster — diar label + (optional) human name. The UI builds
    // the per-segment speaker <select> from this.
    speakers: recording.speakers.map((sp) => ({
      diarLabel: sp.diarLabel,
      displayName: sp.displayName,
    })),
    waveform,
    // Same-origin endpoint that 302s to a short-lived signed URL of the
    // source media, so the editor can play audio + drive the playhead.
    mediaUrl: `/api/admin/postprod/recordings/${recording.id}/media`,
    hasTranscript: true,
    // Stato della versione originale: quando è stata conservata, quale modello
    // l'ha prodotta, e se è confrontabile riga per riga.
    original: conservato
      ? {
          capturedAt: conservato.capturedAt.toISOString(),
          modelId: conservato.modelId,
          modelVersion: conservato.modelVersion,
          comparable: confrontabile,
        }
      : null,
    revisedAt: jsonArtifact.revisedAt?.toISOString() ?? null,
  });
});

const editSchema = z.object({
  index: z.number().int().min(0),
  // Either field may be omitted to leave it unchanged. `text` is
  // trimmed; an empty string is allowed (admin may want to blank a
  // bogus segment) but we keep the segment to preserve indices.
  text: z.string().max(10_000).optional(),
  // null clears the speaker; a string must match an existing diarLabel
  // (validated against the roster below).
  speaker: z.string().max(40).nullable().optional(),
});

const bodySchema = z.object({
  edits: z.array(editSchema).min(1).max(5_000),
  /**
   * Applica le stesse correzioni ANCHE al testo conservato della macchina.
   *
   * Serve per il diritto alla cancellazione: svuotare un segmento nell'editor è
   * oggi l'unico modo per togliere una frase da una trascrizione (la rotta di
   * cancellazione tocca solo le iscrizioni). Conservare l'originale, senza
   * questo, renderebbe quella cancellazione apparente — il testo resterebbe
   * nella copia. Spento di default: una correzione ordinaria NON deve
   * riscrivere ciò che la macchina aveva prodotto, altrimenti le due versioni
   * smettono di essere confrontabili.
   */
  redactOriginal: z.boolean().default(false),
});

export const PUT = withErrorHandling(async (request, context) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const { id } = await (context as { params: Promise<{ id: string }> }).params;
  const { edits, redactOriginal } = bodySchema.parse(await request.json());

  const recording = await loadRecording(id);
  if (!recording) throw new NotFoundError('Recording');

  const jsonArtifact = recording.artifacts.find((a) => a.type === 'TRANSCRIPT_JSON');
  if (!jsonArtifact) throw new NotFoundError('Transcript');

  const transcript = parseTranscript(jsonArtifact.inlineBody);
  const segments = transcript.segments ?? [];
  if (segments.length === 0) throw new NotFoundError('Transcript segments');

  const validLabels = new Set(recording.speakers.map((sp) => sp.diarLabel));

  // Apply edits in place. Reject out-of-range indices and unknown
  // speaker labels up front so a bad payload mutates nothing.
  let textChanges = 0;
  let speakerChanges = 0;
  for (const edit of edits) {
    if (edit.index >= segments.length) {
      throw new ValidationError(`Segment index out of range: ${edit.index}`);
    }
    if (
      edit.speaker !== undefined &&
      edit.speaker !== null &&
      !validLabels.has(edit.speaker)
    ) {
      throw new ValidationError(`Unknown speaker label: ${edit.speaker}`);
    }
    const seg = segments[edit.index]!;
    if (edit.text !== undefined) {
      const next = edit.text.trim();
      if (next !== seg.text) {
        seg.text = next;
        // Word-level timings no longer match hand-edited text. Drop
        // them so the player doesn't highlight stale word boxes; the
        // segment-level start/end still drive seek + subtitle timing.
        delete seg.words;
        textChanges += 1;
      }
    }
    if (edit.speaker !== undefined) {
      const next = edit.speaker;
      if ((seg.speaker ?? null) !== next) {
        seg.speaker = next;
        speakerChanges += 1;
      }
    }
  }

  if (textChanges === 0 && speakerChanges === 0) {
    return Response.json({ ok: true, textChanges: 0, speakerChanges: 0 });
  }

  // Recompute per-speaker speaking time from the final assignment.
  const speechByLabel = new Map<string, number>();
  for (const seg of segments) {
    if (!seg.speaker) continue;
    const dur = Math.max(0, (Number(seg.end) || 0) - (Number(seg.start) || 0));
    speechByLabel.set(seg.speaker, (speechByLabel.get(seg.speaker) ?? 0) + dur);
  }

  // Serialise the edited transcript and the regenerated source VTT.
  const newJsonBody = JSON.stringify({ ...transcript, segments });
  const speakerNames = new Map<string, string>();
  for (const sp of recording.speakers) {
    if (sp.displayName) speakerNames.set(sp.diarLabel, sp.displayName);
  }
  const newVttBody = buildVtt(segments, speakerNames);

  const vttArtifact = recording.artifacts.find(
    (a) =>
      a.type === 'TRANSCRIPT_VTT' &&
      (a.language === recording.sourceLanguage || a.language === transcript.language),
  );

  // Il testo come l'ha prodotto la macchina, conservato alla PRIMA correzione.
  // Si copia il corpo memorizzato, non quello ricostruito dai segmenti: il
  // ciclo qui sopra scarta i tempi delle parole di ogni segmento riscritto, e
  // una copia ricostruita nascerebbe già priva di ciò che l'originale ha di
  // proprio. Sta dentro la transazione perché o si conservano entrambe le
  // versioni, o non si scrive nulla.
  const artefattiDaConservare = [jsonArtifact, ...(vttArtifact ? [vttArtifact] : [])].map((a) => ({
    id: a.id,
    recordingId: a.recordingId,
    type: a.type,
    language: a.language,
    inlineBody: a.inlineBody,
    contentHash: a.contentHash,
    sizeBytes: a.sizeBytes,
    modelId: a.modelId,
    modelVersion: a.modelVersion,
  }));

  await prisma.$transaction(async (tx) => {
    const originaliConservati = await conservaOriginali(
      tx,
      artefattiDaConservare,
      recording.eventId,
    );
    void originaliConservati;

    await tx.postprodArtifact.update({
      where: { id: jsonArtifact.id },
      data: {
        inlineBody: encryptPII(newJsonBody),
        contentHash: sha256Hex(newJsonBody),
        sizeBytes: BigInt(Buffer.byteLength(newJsonBody, 'utf8')),
        // Da qui in poi questa versione è rivista da una persona.
        revisedAt: new Date(),
      },
    });

    // Cancellazione di un contenuto, non correzione: le stesse modifiche vanno
    // applicate anche al testo conservato, altrimenti quella cancellazione
    // sarebbe apparente — la frase resterebbe nella copia della macchina.
    if (redactOriginal) {
      const conservati = await tx.postprodOriginalBody.findMany({
        where: {
          artifactId: { in: [jsonArtifact.id, ...(vttArtifact ? [vttArtifact.id] : [])] },
        },
        select: { id: true, artifactId: true, body: true },
      });

      const originaleJson = conservati.find((o) => o.artifactId === jsonArtifact.id);
      if (originaleJson) {
        const originale = parseTranscript(originaleJson.body);
        const segmentiOriginali = originale.segments ?? [];
        for (const edit of edits) {
          const seg = segmentiOriginali[edit.index];
          if (!seg || edit.text === undefined) continue;
          seg.text = edit.text.trim();
          // Come per la versione rivista: i tempi delle singole parole non
          // corrispondono più a un testo riscritto a mano.
          delete seg.words;
        }
        const corpo = JSON.stringify({ ...originale, segments: segmentiOriginali });
        await tx.postprodOriginalBody.update({
          where: { id: originaleJson.id },
          data: {
            body: encryptPII(corpo),
            contentHash: sha256Hex(corpo),
            sizeBytes: BigInt(Buffer.byteLength(corpo, 'utf8')),
          },
        });

        const originaleVtt = conservati.find(
          (o) => vttArtifact && o.artifactId === vttArtifact.id,
        );
        if (originaleVtt) {
          // I sottotitoli conservati si ricostruiscono dagli stessi segmenti
          // redatti: tempi e struttura restano quelli della macchina, il testo
          // tolto sparisce anche da qui.
          const vtt = buildVtt(segmentiOriginali, speakerNames);
          await tx.postprodOriginalBody.update({
            where: { id: originaleVtt.id },
            data: {
              body: encryptPII(vtt),
              contentHash: sha256Hex(vtt),
              sizeBytes: BigInt(Buffer.byteLength(vtt, 'utf8')),
            },
          });
        }
      }
    }

    if (vttArtifact) {
      await tx.postprodArtifact.update({
        where: { id: vttArtifact.id },
        data: {
          inlineBody: encryptPII(newVttBody),
          contentHash: sha256Hex(newVttBody),
          sizeBytes: BigInt(Buffer.byteLength(newVttBody, 'utf8')),
        },
      });
    }

    // Update Speaker.totalSpeechSec only where the assignment changed
    // the number. Speakers with no segments after the edit go to 0.
    for (const sp of recording.speakers) {
      const next = Math.round(speechByLabel.get(sp.diarLabel) ?? 0);
      if (next !== sp.totalSpeechSec) {
        await tx.speaker.update({
          where: { id: sp.id },
          data: { totalSpeechSec: next },
        });
      }
    }
  });

  await logAdminAction({
    request,
    action: redactOriginal ? 'POSTPROD_TRANSCRIPT_REDACT' : 'POSTPROD_TRANSCRIPT_EDIT',
    target: id,
    details: {
      textChanges,
      speakerChanges,
      vttRegenerated: Boolean(vttArtifact),
      // Una redazione tocca anche il testo conservato: va distinta nel
      // registro, perché è l'unica azione che cancella davvero del contenuto.
      redactOriginal,
    },
  });

  return Response.json({
    ok: true,
    textChanges,
    speakerChanges,
    vttRegenerated: Boolean(vttArtifact),
  });
});
