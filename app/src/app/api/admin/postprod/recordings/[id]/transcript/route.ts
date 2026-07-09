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
        select: { id: true, type: true, language: true, inlineBody: true },
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
  const segments = (transcript.segments ?? []).map((s, index) => ({
    index,
    start: s.start,
    end: s.end,
    text: s.text,
    speaker: s.speaker ?? null,
  }));

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
});

export const PUT = withErrorHandling(async (request, context) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const { id } = await (context as { params: Promise<{ id: string }> }).params;
  const { edits } = bodySchema.parse(await request.json());

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

  await prisma.$transaction(async (tx) => {
    await tx.postprodArtifact.update({
      where: { id: jsonArtifact.id },
      data: {
        inlineBody: encryptPII(newJsonBody),
        contentHash: sha256Hex(newJsonBody),
        sizeBytes: BigInt(Buffer.byteLength(newJsonBody, 'utf8')),
      },
    });

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
    action: 'POSTPROD_TRANSCRIPT_EDIT',
    target: id,
    details: { textChanges, speakerChanges, vttRegenerated: Boolean(vttArtifact) },
  });

  return Response.json({
    ok: true,
    textChanges,
    speakerChanges,
    vttRegenerated: Boolean(vttArtifact),
  });
});
