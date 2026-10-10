/**
 * Quello che il modello linguistico legge per scrivere il resoconto
 * dell'evento (lavoro REPORT, infra/ai/worker): l'evento e le persone che lo
 * presentano, l'agenda con i «d'accordo» e «non d'accordo», la trascrizione
 * (dell'AI o dai sottotitoli live, con i nomi dati dallo staff o da chi ha
 * acconsentito), la chat senza nomi, le domande, i sondaggi pubblicati, le
 * parole, le valutazioni e i commenti del questionario dopo l'evento, e i
 * numeri del portale.
 *
 * Si legge al momento del claim: i commenti arrivati fino a quel momento
 * entrano. Tutto resta nel cluster (vLLM, nessun servizio esterno).
 */
import {
  CAPTIONS_TRANSCRIPT_MODEL,
  registrazionePubblica,
} from '@/lib/captions/transcript';
import { tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import {
  entiEPersonePubblici,
  PERSONE_PUBBLICHE_INCLUDE,
} from '@/lib/events/public-people';
import {
  buildEventFeedbackReport,
  type EventFeedbackReport,
} from '@/lib/feedback/event-feedback-report';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import { markdownToPlainText } from '@/lib/utils/markdown-text';

import type { ReportMetrics } from './types';

/** Quanti messaggi della chat al massimo: oltre, un campione distribuito nel tempo. */
export const MAX_MESSAGGI = 400;
/** Quanti commenti delle valutazioni al massimo. */
export const MAX_COMMENTI = 100;
/** Quanti caratteri di trascrizione al massimo (il worker la riassume a pezzi). */
export const MAX_TRASCRIZIONE = 240_000;

export interface IngressoResoconto {
  language: string;
  event: {
    title: string;
    description: string;
    startsAt: string;
    durationMin: number;
    timezone: string;
    organizations: string[];
    people: Array<{ name: string; role: string; organization: string | null }>;
  };
  agenda: ReportMetrics['agenda'];
  transcript: {
    source: 'ai' | 'live-captions' | null;
    lines: string[];
    truncated: boolean;
  };
  summary: {
    overall: string;
    topics: Array<{ title: string; start: string; summary: string }>;
  } | null;
  chat: {
    total: number;
    messages: Array<{
      at: string;
      role: 'moderator' | 'participant';
      question: boolean;
      text: string;
    }>;
  };
  questions: Array<{
    text: string;
    upvotes: number;
    answered: boolean;
    answer: string | null;
  }>;
  polls: ReportMetrics['polls'];
  words: ReportMetrics['words'];
  feedback: {
    responses: number;
    average: number | null;
    items: Array<{
      prompt: string;
      average: number | null;
      scaleMin: number;
      scaleMax: number;
    }>;
    comments: string[];
  };
  metrics: ReportMetrics;
}

const accorcia = (t: string, max: number) =>
  t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;

/** Un campione distribuito: tutti se sono pochi, altrimenti uno ogni tanti. */
export function campione<T>(righe: readonly T[], max: number): T[] {
  if (righe.length <= max) return [...righe];
  const passo = righe.length / max;
  return Array.from({ length: max }, (_, i) => righe[Math.floor(i * passo)]!);
}

function mmss(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${r}`
    : `${String(m).padStart(2, '0')}:${r}`;
}

interface SegmentoGrezzo {
  start?: number;
  end?: number;
  text?: string;
  speaker?: string | null;
}

/** Un turno piu' lungo si spezza: ogni riga porta il suo minuto. */
const MAX_TURNO = 1500;

/**
 * Un segmento piu' lungo di un turno, in pezzi tra le parole; il minuto di
 * ogni pezzo e' stimato in proporzione, se il segmento dice quando finisce.
 */
function pezziSegmento(testo: string, start: number, end: number | undefined): Array<{ start: number; testo: string }> {
  if (testo.length <= MAX_TURNO) return [{ start, testo }];
  const pezzi: Array<{ start: number; testo: string }> = [];
  let da = 0;
  while (da < testo.length) {
    let a = Math.min(testo.length, da + MAX_TURNO);
    if (a < testo.length) {
      const spazio = testo.lastIndexOf(' ', a);
      if (spazio > da) a = spazio;
    }
    const quota = da / testo.length;
    pezzi.push({
      start: end !== undefined && end > start ? start + (end - start) * quota : start,
      testo: testo.slice(da, a).trim(),
    });
    da = a;
  }
  return pezzi.filter((p) => p.testo);
}

/**
 * Le righe della trascrizione, una per turno di parola: le frasi di seguito
 * della stessa voce si uniscono, fino a MAX_TURNO caratteri. `[MM:SS] Nome: testo`.
 */
export function righeTrascrizione(
  segmenti: readonly SegmentoGrezzo[],
  nomi: ReadonlyMap<string, string>,
  max: number = MAX_TRASCRIZIONE
): { lines: string[]; truncated: boolean } {
  const etichette = new Map<string, string>();
  const nomeDi = (s: string | null | undefined) => {
    if (!s) return 'Voce';
    const noto = nomi.get(s);
    if (noto) return noto;
    if (!etichette.has(s)) etichette.set(s, `Voce ${etichette.size + 1}`);
    return etichette.get(s)!;
  };
  const turni: Array<{ start: number; chi: string; testo: string }> = [];
  for (const s of segmenti) {
    const intero = (s.text ?? '').trim();
    if (!intero) continue;
    const chi = nomeDi(s.speaker);
    for (const { start, testo } of pezziSegmento(intero, s.start ?? 0, s.end)) {
      const ultimo = turni[turni.length - 1];
      if (ultimo && ultimo.chi === chi && ultimo.testo.length + testo.length < MAX_TURNO)
        ultimo.testo += ` ${testo}`;
      else turni.push({ start, chi, testo });
    }
  }
  const lines: string[] = [];
  let caratteri = 0;
  for (const t of turni) {
    const riga = `[${mmss(t.start)}] ${t.chi}: ${t.testo}`;
    if (caratteri + riga.length > max) {
      // Si tiene almeno l'inizio: una trascrizione non resta mai vuota.
      if (lines.length === 0) lines.push(riga.slice(0, max));
      return { lines, truncated: true };
    }
    lines.push(riga);
    caratteri += riga.length + 1;
  }
  return { lines, truncated: false };
}

async function trascrizioneEvento(eventId: string): Promise<{
  source: 'ai' | 'live-captions' | null;
  lines: string[];
  truncated: boolean;
  summary: IngressoResoconto['summary'];
  language: string | null;
}> {
  const id = await registrazionePubblica(eventId, false);
  if (!id)
    return { source: null, lines: [], truncated: false, summary: null, language: null };
  const registrazione = await prisma.recording.findUnique({
    where: { id },
    select: {
      sourceLanguage: true,
      speakers: { select: { diarLabel: true, displayName: true } },
      artifacts: {
        where: { type: { in: ['TRANSCRIPT_JSON', 'SUMMARY_JSON'] } },
        select: { type: true, language: true, inlineBody: true, modelId: true },
      },
    },
  });
  const json = registrazione?.artifacts.find(
    (a) => a.type === 'TRANSCRIPT_JSON' && a.language === null
  );
  if (!registrazione || !json?.inlineBody) {
    return {
      source: null,
      lines: [],
      truncated: false,
      summary: null,
      language: registrazione?.sourceLanguage ?? null,
    };
  }
  let corpo: { segments?: SegmentoGrezzo[]; language?: string } = {};
  try {
    corpo = JSON.parse(tryDecryptPII(json.inlineBody) ?? '{}') as typeof corpo;
  } catch {
    corpo = {};
  }
  const nomi = new Map(
    registrazione.speakers
      .filter((s) => s.displayName)
      .map((s) => [s.diarLabel, s.displayName as string])
  );
  const { lines, truncated } = righeTrascrizione(corpo.segments ?? [], nomi);
  const lingua = registrazione.sourceLanguage ?? corpo.language ?? null;

  // La sintesi gia' fatta dalla pipeline, se c'e': aiuta a tenere il filo
  // degli eventi lunghi.
  let summary: IngressoResoconto['summary'] = null;
  const sintesi = registrazione.artifacts.find(
    (a) => a.type === 'SUMMARY_JSON' && a.language === lingua
  );
  if (sintesi?.inlineBody) {
    try {
      const s = JSON.parse(tryDecryptPII(sintesi.inlineBody) ?? '{}') as {
        overall_summary?: string;
        topics?: Array<{ title?: string; start_mmss?: string; summary?: string }>;
      };
      summary = {
        overall: s.overall_summary ?? '',
        topics: (s.topics ?? []).map((t) => ({
          title: t.title ?? '',
          start: t.start_mmss ?? '',
          summary: t.summary ?? '',
        })),
      };
    } catch {
      summary = null;
    }
  }
  return {
    source: json.modelId === CAPTIONS_TRANSCRIPT_MODEL ? 'live-captions' : 'ai',
    lines,
    truncated,
    summary,
    language: lingua,
  };
}

/** Gli ingressi del resoconto; null se l'evento non c'e'. */
export async function ingressoResoconto(
  eventId: string,
  lingua: string,
  metrics: ReportMetrics,
  valutazioniLette?: EventFeedbackReport
): Promise<IngressoResoconto | null> {
  const evento = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      title: true,
      description: true,
      startsAt: true,
      endsAt: true,
      timezone: true,
      moderatorName: true,
      moderatorPublicListed: true,
      moderatorOrganization: true,
      moderatorOrganizationLogoUrl: true,
      ...PERSONE_PUBBLICHE_INCLUDE,
    },
  });
  if (!evento) return null;

  const [trascrizione, messaggi, domande, valutazioni] = await Promise.all([
    trascrizioneEvento(eventId),
    prisma.chatMessage.findMany({
      where: { eventId, hiddenAt: null, dismissedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true, text: true, isModerator: true, isQuestion: true },
      take: 20_000,
    }),
    prisma.question.findMany({
      where: { eventId, status: { not: 'DISMISSED' } },
      orderBy: { upvoteCount: 'desc' },
      select: { text: true, upvoteCount: true, status: true, answerText: true },
      take: 40,
    }),
    valutazioniLette ?? buildEventFeedbackReport(eventId),
  ]);

  const ora = new Intl.DateTimeFormat('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: evento.timezone || 'Europe/Rome',
  });
  const chat = campione(messaggi, MAX_MESSAGGI)
    .map((m) => ({
      at: ora.format(m.createdAt),
      role: m.isModerator ? ('moderator' as const) : ('participant' as const),
      question: m.isQuestion,
      text: accorcia((tryDecryptPII(m.text) ?? '').replace(/\s+/g, ' ').trim(), 300),
    }))
    .filter((m) => m.text);

  // I commenti scritti: le risposte aperte del questionario e i commenti delle
  // valutazioni a stelle. Senza chi li ha scritti.
  const aperte = new Set(
    valutazioni.items.filter((it) => it.type === 'OPEN_TEXT').map((it) => it.id)
  );
  const commenti = [
    ...valutazioni.responses.flatMap((r) =>
      Object.entries(r.answers)
        .filter(([itemId, a]) => aperte.has(itemId) && a.text)
        .map(([, a]) => a.text as string)
    ),
    ...valutazioni.legacy.entries.map((e) => e.comment ?? '').filter(Boolean),
  ]
    .map((t) => accorcia(t.replace(/\s+/g, ' ').trim(), 400))
    .filter(Boolean)
    .slice(0, MAX_COMMENTI);

  const { enti, persone } = entiEPersonePubblici(evento, tryDecryptPII);
  return {
    language: trascrizione.language ?? lingua,
    event: {
      title: getLocalized(evento.title as LocalizedField, lingua),
      description: accorcia(
        markdownToPlainText(getLocalized(evento.description as LocalizedField, lingua), {
          paragrafi: true,
        }),
        3000
      ),
      startsAt: evento.startsAt.toISOString(),
      durationMin:
        Math.round(metrics.durationSec / 60) ||
        Math.round((evento.endsAt.getTime() - evento.startsAt.getTime()) / 60_000),
      timezone: evento.timezone,
      organizations: enti.map((e) => e.name),
      people: persone.map((p) => ({
        name: p.name,
        role: p.role,
        organization: p.organization,
      })),
    },
    agenda: metrics.agenda,
    transcript: {
      source: trascrizione.source,
      lines: trascrizione.lines,
      truncated: trascrizione.truncated,
    },
    summary: trascrizione.summary,
    chat: { total: messaggi.length, messages: chat },
    questions: domande.map((d) => ({
      text: accorcia(d.text, 400),
      upvotes: d.upvoteCount,
      answered: d.status === 'ANSWERED' || d.status === 'HIGHLIGHTED',
      answer: d.answerText ? accorcia(d.answerText, 600) : null,
    })),
    polls: metrics.polls,
    words: metrics.words,
    feedback: {
      responses: metrics.feedback.responses,
      average: metrics.feedback.average,
      items: metrics.feedback.items.map((it) => ({
        prompt: it.prompt,
        average: it.average,
        scaleMin: it.scaleMin,
        scaleMax: it.scaleMax,
      })),
      comments: commenti,
    },
    metrics,
  };
}
