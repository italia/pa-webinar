/**
 * GET /api/events/[param]/postprod/transcript
 *
 * Returns the structured transcript JSON (segments, speakers) plus
 * the available subtitle languages. The TranscriptPanel client
 * component uses this to render click-to-seek timestamps with
 * speaker labels resolved via the Speaker mapping.
 *
 * Same access policy as the subtitle endpoint: published-recording
 * only.
 */

import { withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { tryDecryptPII } from '@/lib/crypto/pii';
import { assertPostprodAccessible } from '@/lib/ai/access';
import { alignDiarizationToSpeakers } from '@/lib/ai/speaker-align';

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
  avg_logprob?: number;
  no_speech_prob?: number;
}

interface TranscriptJson {
  segments?: Segment[];
  language?: string;
  speakers?: Array<{ diarLabel: string; totalSpeechSec?: number }>;
}

export const GET = withErrorHandling(async (_request, context) => {
  const { param: slug } = (await (context as { params: Promise<{ param: string }> }).params);

  const { eventId } = await assertPostprodAccessible(slug);

  const recording = await prisma.recording.findFirst({
    where: { eventId, status: { in: ['POSTPROD_DONE', 'POSTPROD_PARTIAL'] } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      sourceLanguage: true,
      pipelineSnapshot: true,
      artifacts: {
        where: {
          type: {
            in: [
              'TRANSCRIPT_JSON',
              'TRANSCRIPT_VTT',
              'TRANSLATION_VTT',
              'SUMMARY_MD',
              'SUMMARY_JSON',
              'TRANSLATION_MD',
              'DUBBED_AUDIO',
            ],
          },
        },
        select: { id: true, type: true, language: true, inlineBody: true, blobKey: true },
      },
      speakers: {
        select: {
          diarLabel: true,
          displayName: true,
          totalSpeechSec: true,
        },
      },
      // ADR-013 Fase 0 — timeline dominant-speaker per auto-nominare i
      // cluster pyannote anonimi (vedi sotto).
      callSession: { select: { dominantSpeakerLog: true } },
    },
  });
  if (!recording) throw new NotFoundError('Transcript');

  const transcriptJson = recording.artifacts.find(
    (a) => a.type === 'TRANSCRIPT_JSON',
  );
  const transcript: TranscriptJson = transcriptJson?.inlineBody
    ? (JSON.parse(tryDecryptPII(transcriptJson.inlineBody) ?? '{}') as TranscriptJson)
    : {};

  // Mapping speaker → label umano. Per gli speaker mappati dall'admin
  // usiamo il displayName. Per i SPEAKER_xx anonimi, sostituiamo con
  // "Partecipante N" ordinato per tempo di parola (top speaker = 1):
  // visivamente molto più gentile di "SPEAKER_03" per il visitatore.
  // L'admin può sempre identificarli a posteriori col mapping; finché
  // non lo fa, "Partecipante" è meglio del diar label crudo.
  // ADR-013 Fase 0: prova ad attribuire i cluster anonimi ai nomi reali
  // usando la timeline del dominant speaker catturata in diretta. Se un
  // cluster pyannote si sovrappone prevalentemente a un partecipante
  // noto, usiamo quel nome invece di "Partecipante N". Best-effort:
  // senza log o senza match si ricade sul fallback numerico.
  const dominantLog = Array.isArray(recording.callSession?.dominantSpeakerLog)
    ? (recording.callSession.dominantSpeakerLog as Array<{
        atMs: number;
        participantId: string;
        displayName?: string;
      }>)
    : [];
  const alignedNames = alignDiarizationToSpeakers(
    (transcript.segments ?? [])
      .filter((s) => s.speaker)
      .map((s) => ({ start: s.start, end: s.end, speaker: s.speaker as string })),
    dominantLog,
  );

  const speakerMap = new Map<string, string>();
  let anonCounter = 0;
  recording.speakers
    .filter((sp) => !sp.displayName)
    .sort((a, b) => (b.totalSpeechSec ?? 0) - (a.totalSpeechSec ?? 0))
    .forEach((sp) => {
      const aligned = alignedNames.get(sp.diarLabel);
      if (aligned) {
        speakerMap.set(sp.diarLabel, aligned);
      } else {
        anonCounter += 1;
        speakerMap.set(sp.diarLabel, `Partecipante ${anonCounter}`);
      }
    });
  for (const sp of recording.speakers) {
    if (sp.displayName) speakerMap.set(sp.diarLabel, sp.displayName);
  }

  // Soglie per il badge "trascrizione meno sicura" nel frontend.
  // Allineate ai filtri di hallucination nel worker (-1.0 / 0.6): un
  // segment con avg_logprob in [-1.0, -0.6] è "borderline" — è stato
  // tenuto perché non sicuro hallucination ma vale la pena segnalarlo
  // al visitatore. > -0.6 è normale.
  const LOWCONF_AVG_LOGPROB = -0.6;

  const segments = (transcript.segments ?? []).map((s) => ({
    start: s.start,
    end: s.end,
    text: s.text,
    speaker: s.speaker ?? null,
    speakerName: s.speaker ? speakerMap.get(s.speaker) ?? null : null,
    words: Array.isArray(s.words)
      ? s.words
          .filter(
            (w): w is SegmentWord =>
              typeof w?.start === 'number' &&
              typeof w?.end === 'number' &&
              typeof w?.word === 'string',
          )
          .map((w) => ({
            start: w.start,
            end: w.end,
            word: w.word,
          }))
      : undefined,
    // Confidence "low" quando Whisper aveva avg_logprob borderline.
    // Esposto come flag boolean per non confondere il client con la
    // semantica del valore raw (log probabilità < 0).
    lowConfidence:
      typeof s.avg_logprob === 'number' && s.avg_logprob < LOWCONF_AVG_LOGPROB,
  }));

  // Available subtitle tracks for the player's track switcher. A
  // subtitle is "available" if a VTT artifact exists for that lang.
  const subtitleTracks = recording.artifacts
    .filter(
      (a) =>
        a.type === 'TRANSCRIPT_VTT' ||
        a.type === 'TRANSLATION_VTT' ||
        a.type === 'SUBTITLE_VTT',
    )
    .filter((a) => a.language)
    .map((a) => a.language!)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .sort();

  // Summaries (inline rendered) — IT default + any translated ones.
  const summaries: Record<string, string> = {};
  // Structured summaries: object {overall_summary, key_decisions[],
  // action_items[], topics[{title, start_mmss, summary}]} per lingua.
  // Permette al frontend di render hero card + topic chips senza
  // ri-parsare markdown.
  const summariesStructured: Record<string, unknown> = {};
  for (const a of recording.artifacts) {
    if (
      (a.type === 'SUMMARY_MD' || a.type === 'TRANSLATION_MD') &&
      a.language &&
      a.inlineBody
    ) {
      const decoded = tryDecryptPII(a.inlineBody);
      if (decoded) summaries[a.language] = decoded;
    } else if (a.type === 'SUMMARY_JSON' && a.language && a.inlineBody) {
      const decoded = tryDecryptPII(a.inlineBody);
      if (decoded) {
        try {
          summariesStructured[a.language] = JSON.parse(decoded);
        } catch {
          // ignora: payload corrotto, il frontend resta sul .md
        }
      }
    }
  }

  // Dubbed audio tracks. Esposti come oggetti `{language, src}` —
  // l'src è il path pubblico del nostro endpoint dubbed-audio che
  // (302 redirect a signed URL del blob, o passthrough inline per file
  // piccoli). Non includiamo direttamente il blobKey/URL signed per
  // gli stessi motivi del subtitle endpoint (CORS, cache, scadenze
  // SAS).
  const dubbedAudio = recording.artifacts
    .filter((a) => a.type === 'DUBBED_AUDIO' && a.language)
    .map((a) => ({
      language: a.language!,
      src: `/api/events/${slug}/postprod/dubbed-audio/${a.language}`,
    }));

  return Response.json({
    recordingId: recording.id,
    sourceLanguage: recording.sourceLanguage ?? transcript.language ?? 'it',
    segments,
    speakers: recording.speakers,
    subtitleTracks,
    summaries,
    summariesStructured,
    dubbedAudio,
    pipelineSnapshot: recording.pipelineSnapshot ?? {},
  });
});
