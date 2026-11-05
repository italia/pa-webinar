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

import { getTranslations } from 'next-intl/server';

import { AI_GENERATED_HEADER, AI_GENERATED_HEADER_VALUE } from '@/lib/ai/marking';
import { withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { tryDecryptPII } from '@/lib/crypto/pii';
import { assertPostprodAccessible } from '@/lib/ai/access';
import { LOWCONF_AVG_LOGPROB } from '@/lib/ai/reliability';
import { alignDiarizationToSpeakers } from '@/lib/ai/speaker-align';
import { CAPTIONS_TRANSCRIPT_MODEL, registrazionePubblica } from '@/lib/captions/transcript';
import { endpointConConsenso } from '@/lib/captions/room';
import { regimeConsensoVoce } from '@/lib/ai/voice-consent';
import { defaultLocale, locales } from '@/i18n/config';

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
  /** Trascrizione dai sottotitoli: i tratti di chi non ha dato il consenso. */
  untranscribed?: Array<{ start: number; end: number }>;
  language?: string;
  speakers?: Array<{ diarLabel: string; totalSpeechSec?: number }>;
}

/**
 * I partecipanti del registro di chi parlava il cui nome si puo' mostrare:
 * in un evento in cui il consenso voce per voce e' stato chiesto, solo chi
 * l'ha dato (dall'endpoint al posto, dal posto al consenso, con la versione
 * del testo che vale per l'evento). Negli altri eventi tutti (`null`).
 *
 * La rotta e' pubblica e non si mette in cache, e dopo l'evento la risposta
 * cambia di rado (una cancellazione su richiesta): si tiene per qualche
 * minuto per registrazione, invece di rileggere i consensi a ogni visita.
 */
const NOMI_TTL_MS = 5 * 60_000;
const nomiInCache = new Map<string, { scade: number; ammessi: Set<string> | null }>();

async function partecipantiConNome(
  eventId: string,
  recordingId: string,
  log: Array<{ participantId: string }>,
): Promise<((participantId: string) => boolean) | undefined> {
  const adesso = Date.now();
  let voce = nomiInCache.get(recordingId);
  if (!voce || voce.scade < adesso) {
    const [evento, sito] = await Promise.all([
      prisma.event.findUnique({
        where: { id: eventId },
        select: { multitrackRecordingEnabled: true, captionsTranscriptEnabled: true, liveCaptionsEnabled: true },
      }),
      prisma.siteSetting.findUnique({ where: { id: 'singleton' }, select: { liveCaptionsEnabled: true } }),
    ]);
    const regime = evento ? await regimeConsensoVoce(prisma, eventId, evento, sito ?? {}) : null;
    const ammessi = regime?.chiesto
      ? await endpointConConsenso(eventId, [...new Set(log.map((e) => e.participantId))], regime.versione)
      : null;
    voce = { scade: adesso + NOMI_TTL_MS, ammessi };
    if (nomiInCache.size > 500) nomiInCache.clear();
    nomiInCache.set(recordingId, voce);
  }
  // Senza consenso chiesto, nessun filtro: resta la regola di sempre.
  const { ammessi } = voce;
  return ammessi ? (id) => ammessi.has(id) : undefined;
}

export const GET = withErrorHandling(async (request, context) => {
  const { param: slug } = (await (context as { params: Promise<{ param: string }> }).params);

  const { eventId, ambito, soloSottotitoli } = await assertPostprodAccessible(slug);

  // Prima la trascrizione AI, poi quella dai sottotitoli (lib/captions/transcript).
  const scelta = await registrazionePubblica(eventId, soloSottotitoli);
  if (!scelta) throw new NotFoundError('Transcript');
  const recording = await prisma.recording.findUnique({
    where: { id: scelta },
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
        select: {
          id: true,
          type: true,
          language: true,
          inlineBody: true,
          blobKey: true,
          revisedAt: true,
          modelId: true,
          original: { select: { id: true } },
        },
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
  // Pubblicata la sola trascrizione (o pipeline spenta): niente sintesi,
  // traduzioni, sottotitoli e doppiaggio, che accompagnano il video.
  if (ambito !== 'tutto') {
    recording.artifacts = recording.artifacts.filter(
      (a) => a.type === 'TRANSCRIPT_JSON' && a.language === null,
    );
  }

  const transcriptJson = recording.artifacts.find(
    (a) => a.type === 'TRANSCRIPT_JSON',
  );
  const transcript: TranscriptJson = transcriptJson?.inlineBody
    ? (JSON.parse(tryDecryptPII(transcriptJson.inlineBody) ?? '{}') as TranscriptJson)
    : {};

  // Mapping speaker → label umano. Per gli speaker mappati dall'admin
  // usiamo il displayName. Per i SPEAKER_xx anonimi, sostituiamo con
  // «Partecipante N» (tradotto) ordinato per tempo di parola (top speaker = 1):
  // visivamente molto più gentile di "SPEAKER_03" per il visitatore.
  // L'admin può sempre identificarli a posteriori col mapping; finché
  // non lo fa, "Partecipante" è meglio del diar label crudo.
  // ADR-013 Fase 0: prova ad attribuire i cluster anonimi ai nomi reali
  // usando la timeline del dominant speaker catturata in diretta. Se un
  // cluster pyannote si sovrappone prevalentemente a un partecipante
  // noto, usiamo quel nome invece di "Partecipante N". Best-effort:
  // senza log o senza match si ricade sul fallback numerico. In un evento
  // che chiede il consenso voce per voce, il nome solo di chi l'ha dato.
  const dominantLog = Array.isArray(recording.callSession?.dominantSpeakerLog)
    ? (recording.callSession.dominantSpeakerLog as Array<{
        atMs: number;
        participantId: string;
        displayName?: string;
      }>)
    : [];
  // Il registro serve solo per le voci che nessuno ha nominato: senza, non
  // si legge niente (la rotta e' pubblica e non si mette in cache).
  const daNominare = recording.speakers.some((sp) => !sp.displayName);
  const alignedNames =
    daNominare && dominantLog.length > 0
      ? alignDiarizationToSpeakers(
          (transcript.segments ?? [])
            .filter((s) => s.speaker)
            .map((s) => ({ start: s.start, end: s.end, speaker: s.speaker as string })),
          dominantLog,
          await partecipantiConNome(eventId, recording.id, dominantLog),
        )
      : new Map<string, string>();

  // L'etichetta delle voci senza nome, nella lingua della pagina che chiede:
  // si carica solo se c'e' una voce da etichettare.
  const richiesta = new URL(request.url).searchParams.get('locale') ?? defaultLocale;
  const lingua = (locales as readonly string[]).includes(richiesta) ? richiesta : defaultLocale;
  const tVoci = daNominare ? await getTranslations({ locale: lingua, namespace: 'postprod' }) : null;

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
        speakerMap.set(sp.diarLabel, tVoci ? tVoci('anonymousSpeaker', { n: anonCounter }) : sp.diarLabel);
      }
    });
  for (const sp of recording.speakers) {
    if (sp.displayName) speakerMap.set(sp.diarLabel, sp.displayName);
  }

  // Soglia per il badge "trascrizione meno sicura" nel frontend.
  // Importata da lib/ai/reliability così questo pannello e quello di
  // affidabilità admin concordano su cosa è "borderline" (un unico -0.6).
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

  // Marcatura AI Act art. 50 leggibile da macchina, e se una persona ha
  // corretto la trascrizione o una sintesi dopo la generazione automatica.
  // Solo il Markdown: e' cio' che il pannello mostra. Il JSON strutturato si
  // riscrive a ogni salvataggio dell'editor anche quando il testo non cambia.
  const revisedSummaries = recording.artifacts
    .filter(
      (a) =>
        (a.type === 'SUMMARY_MD' || a.type === 'TRANSLATION_MD') && (!!a.revisedAt || !!a.original),
    )
    .map((a) => a.language)
    .filter((l): l is string => !!l);

  return Response.json({
    aiGenerated: true,
    // Da dove viene la trascrizione: la pipeline AI o i sottotitoli automatici
    // della diretta (lib/captions/transcript), che il pannello dichiara diversi.
    source: transcriptJson?.modelId === CAPTIONS_TRANSCRIPT_MODEL ? 'live-captions' : 'ai',
    revised: {
      transcript: !!transcriptJson?.revisedAt || !!transcriptJson?.original,
      summaries: [...new Set(revisedSummaries)],
    },
    recordingId: recording.id,
    sourceLanguage: recording.sourceLanguage ?? transcript.language ?? 'it',
    segments,
    untranscribed: Array.isArray(transcript.untranscribed)
      ? transcript.untranscribed.filter(
          (v) => typeof v?.start === 'number' && typeof v?.end === 'number',
        )
      : [],
    speakers: recording.speakers,
    subtitleTracks,
    summaries,
    summariesStructured,
    dubbedAudio,
    pipelineSnapshot: recording.pipelineSnapshot ?? {},
  }, {
    headers: {
      [AI_GENERATED_HEADER]: AI_GENERATED_HEADER_VALUE,
      // Chi la riceve dipende dalla richiesta (lib/recording/audience).
      'Cache-Control': 'private, no-store',
    },
  });
});
