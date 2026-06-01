/**
 * GET /api/events/[param]/postprod/download/[file]
 *
 * Download endpoints per gli artifact postprod. Restituisce sempre un
 * file scaricabile (Content-Disposition: attachment) con il nome
 * corretto. I formati supportati:
 *
 *   - `transcript.txt`     — testo piatto, una riga per segmento,
 *                            prefissato dal timestamp [hh:mm:ss].
 *   - `transcript.srt`     — SubRip (numerazione + range temporale).
 *   - `transcript.vtt`     — passa-attraverso del SUBTITLE_VTT/
 *                            TRANSCRIPT_VTT (stessa logica della route
 *                            /subtitle/[lang], qui per riusare la
 *                            stessa entry-point pubblica).
 *   - `summary.md`         — markdown della sintesi (SUMMARY_MD /
 *                            TRANSLATION_MD).
 *
 * La query string `?lang=xx` seleziona la lingua; se omessa si usa
 * la sourceLanguage del recording.
 *
 * Access control: stesso gating di `assertPostprodAccessible`. Niente
 * autenticazione esplicita — l'API è pubblica per recording
 * pubblicate, esattamente come il subtitle endpoint.
 */

import { withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { tryDecryptPII } from '@/lib/crypto/pii';
import { assertPostprodAccessible } from '@/lib/ai/access';

export const dynamic = 'force-dynamic';

interface Segment {
  start: number;
  end: number;
  text: string;
  speaker?: string | null;
}

interface TranscriptJson {
  segments?: Segment[];
  language?: string;
}

type DownloadFormat = 'transcript.txt' | 'transcript.srt' | 'summary.md';

const ALLOWED_FILES = new Set<DownloadFormat>([
  'transcript.txt',
  'transcript.srt',
  'summary.md',
]);

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** hh:mm:ss for the .txt preview. */
function fmtTs(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** SRT timestamp: hh:mm:ss,mmm. */
function fmtSrtTs(seconds: number): string {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const ms = Math.round((total - Math.floor(total)) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

function toTxt(segments: Segment[], speakerMap: Map<string, string>): string {
  const lines: string[] = [];
  for (const seg of segments) {
    const speaker = seg.speaker
      ? speakerMap.get(seg.speaker) ?? seg.speaker
      : null;
    const tag = speaker ? ` ${speaker}:` : '';
    lines.push(`[${fmtTs(seg.start)}]${tag} ${seg.text.trim()}`);
  }
  return lines.join('\n') + '\n';
}

function toSrt(segments: Segment[], speakerMap: Map<string, string>): string {
  const out: string[] = [];
  let i = 1;
  for (const seg of segments) {
    const speaker = seg.speaker
      ? speakerMap.get(seg.speaker) ?? seg.speaker
      : null;
    const text = speaker ? `<i>${speaker}:</i> ${seg.text.trim()}` : seg.text.trim();
    out.push(String(i));
    out.push(`${fmtSrtTs(seg.start)} --> ${fmtSrtTs(seg.end)}`);
    out.push(text);
    out.push('');
    i += 1;
  }
  return out.join('\n');
}

function sanitizeFilename(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'transcript';
}

export const GET = withErrorHandling(async (request, context) => {
  const { param: slug, file } = await (context as {
    params: Promise<{ param: string; file: string }>;
  }).params;

  if (!ALLOWED_FILES.has(file as DownloadFormat)) {
    throw new ValidationError(`Unsupported download format: ${file}`);
  }
  const fmt = file as DownloadFormat;

  // Access policy: same as the sibling transcript / subtitle endpoints
  // (kill-switch + recordingPublished + postEventPublic + window).
  const { eventId } = await assertPostprodAccessible(slug);

  const url = new URL(request.url);
  const requestedLang = (url.searchParams.get('lang') ?? '').toLowerCase().trim();

  const recording = await prisma.recording.findFirst({
    where: {
      eventId,
      status: { in: ['POSTPROD_DONE', 'POSTPROD_PARTIAL'] },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      sourceLanguage: true,
      artifacts: {
        select: {
          type: true,
          language: true,
          inlineBody: true,
        },
      },
      speakers: {
        select: { diarLabel: true, displayName: true },
      },
    },
  });
  if (!recording) throw new NotFoundError('Postprod');

  const lang = requestedLang || recording.sourceLanguage || 'it';
  const safeSlug = sanitizeFilename(slug);

  const speakerMap = new Map<string, string>();
  for (const sp of recording.speakers) {
    if (sp.displayName) speakerMap.set(sp.diarLabel, sp.displayName);
  }

  if (fmt === 'summary.md') {
    // Prefer the exact-language summary; fallback alla source lang
    // se la traduzione richiesta non esiste — non leakeremo un altro
    // contenuto, è solo la stessa sintesi nella lingua sorgente.
    const candidate =
      recording.artifacts.find(
        (a) =>
          (a.type === 'SUMMARY_MD' || a.type === 'TRANSLATION_MD') &&
          a.language === lang,
      ) ??
      recording.artifacts.find(
        (a) =>
          (a.type === 'SUMMARY_MD' || a.type === 'TRANSLATION_MD') &&
          a.language === recording.sourceLanguage,
      );
    if (!candidate?.inlineBody) throw new NotFoundError('Summary');
    const body = tryDecryptPII(candidate.inlineBody);
    if (!body) throw new NotFoundError('Summary');

    return new Response(body, {
      status: 200,
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename="${safeSlug}-summary.${candidate.language ?? lang}.md"`,
        'cache-control': 'private, max-age=60',
      },
    });
  }

  // transcript.txt / transcript.srt — derivati dal TRANSCRIPT_JSON
  // della source language. Se è stata richiesta una lingua tradotta
  // possiamo usare la VTT corrispondente (non la JSON, che esiste solo
  // per la sorgente) — per il txt/srt servono i segmenti puri.
  let segments: Segment[] = [];
  let effectiveLang = recording.sourceLanguage ?? lang;

  if (!requestedLang || requestedLang === recording.sourceLanguage) {
    const json = recording.artifacts.find((a) => a.type === 'TRANSCRIPT_JSON');
    if (json?.inlineBody) {
      const decoded = tryDecryptPII(json.inlineBody);
      if (decoded) {
        try {
          const parsed = JSON.parse(decoded) as TranscriptJson;
          segments = parsed.segments ?? [];
        } catch {
          // fall through — vuoto produce 404
        }
      }
    }
  } else {
    // Parsing VTT della lingua tradotta. Cattura solo cue-blocks
    // base; sufficient per il nostro formato Piper/whisper.
    const vtt = recording.artifacts.find(
      (a) =>
        (a.type === 'TRANSLATION_VTT' ||
          a.type === 'TRANSCRIPT_VTT' ||
          a.type === 'SUBTITLE_VTT') &&
        a.language === lang,
    );
    const body = vtt?.inlineBody ? tryDecryptPII(vtt.inlineBody) : null;
    if (body) {
      segments = parseVtt(body);
      effectiveLang = lang;
    }
  }

  if (segments.length === 0) throw new NotFoundError('Transcript');

  if (fmt === 'transcript.txt') {
    const body = toTxt(segments, speakerMap);
    return new Response(body, {
      status: 200,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'content-disposition': `attachment; filename="${safeSlug}-transcript.${effectiveLang}.txt"`,
        'cache-control': 'private, max-age=60',
      },
    });
  }

  // transcript.srt
  const body = toSrt(segments, speakerMap);
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/x-subrip; charset=utf-8',
      'content-disposition': `attachment; filename="${safeSlug}-subtitles.${effectiveLang}.srt"`,
      'cache-control': 'private, max-age=60',
    },
  });
});

/**
 * VTT → segments parser. Conservativo: salta WEBVTT header, NOTE
 * blocks, identifier lines, e accetta i timestamp HH:MM:SS.mmm e
 * MM:SS.mmm. Non tenta di gestire styling complesso (cue settings,
 * voice tags) — il nostro pipeline produce VTT minimale.
 */
function parseVtt(text: string): Segment[] {
  const out: Segment[] = [];
  const lines = text.replace(/\r/g, '').split('\n');
  let i = 0;
  // skip WEBVTT header
  if (lines[0]?.startsWith('WEBVTT')) i += 1;
  while (i < lines.length) {
    const line = lines[i]!.trim();
    if (!line || line.startsWith('NOTE')) {
      i += 1;
      continue;
    }
    // optional identifier; if next line looks like a timestamp,
    // current line is the id. If current line itself has -->, treat
    // it as the timestamp.
    let timestampLine = line;
    if (!line.includes('-->') && lines[i + 1]?.includes('-->')) {
      i += 1;
      timestampLine = lines[i]!.trim();
    }
    const m = /^(\d{2}:)?(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}:)?(\d{2}):(\d{2})\.(\d{3})/.exec(
      timestampLine,
    );
    if (!m) {
      i += 1;
      continue;
    }
    const startH = m[1] ? parseInt(m[1], 10) : 0;
    const start = startH * 3600 + parseInt(m[2]!, 10) * 60 + parseInt(m[3]!, 10) + parseInt(m[4]!, 10) / 1000;
    const endH = m[5] ? parseInt(m[5], 10) : 0;
    const end = endH * 3600 + parseInt(m[6]!, 10) * 60 + parseInt(m[7]!, 10) + parseInt(m[8]!, 10) / 1000;
    i += 1;
    const textLines: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== '') {
      textLines.push(lines[i]!);
      i += 1;
    }
    out.push({
      start,
      end,
      text: textLines.join(' ').replace(/<[^>]+>/g, '').trim(),
    });
    i += 1;
  }
  return out;
}
