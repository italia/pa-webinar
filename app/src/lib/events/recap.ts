/**
 * Post-event recap.
 *
 * An anonymized, AGGREGATE snapshot of what an event produced — headcount, the
 * top answered questions, published poll results, the most-submitted word-cloud
 * words, and the average feedback. It works for ANY event (recording is not
 * required) because it reuses data the live features already persist.
 *
 * The recap is generated lazily on the first view of the concluded page and
 * PERSISTED on the event (`postEventRecap`) so it survives the retention
 * cleanup, which deletes the raw questions/polls/word-cloud/feedback/
 * registration rows. Nothing here carries a personal identifier: question text
 * is included without its author, votes/words are counts only.
 */

import type { Prisma } from '@prisma/client';

import { tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';

const MAX_QUESTIONS = 5;
const MAX_WORDS = 15;

export interface RecapPoll {
  question: string;
  options: { text: string; votes: number }[];
  totalVotes: number;
}

export interface EventRecap {
  /**
   * 1 = senza `chatQuestions` (snapshot persistiti prima delle domande in chat).
   * Il campo nuovo è OPZIONALE proprio per questo: gli snapshot già scritti
   * restano leggibili senza migrazione né rigenerazione.
   */
  version: 1 | 2;
  generatedAt: string;
  /** Peak concurrent participants during the live event. */
  headcount: number;
  /** Total people who registered. */
  registrations: number;
  /** Top answered/highlighted questions by upvotes — text only, no author. */
  topQuestions: { text: string; upvotes: number }[];
  /**
   * Domande poste in chat, dal più votato. Testo soltanto: niente nome di chi ha
   * chiesto, come per `topQuestions`.
   *
   * Perché stanno QUI e non si leggono dalla chat quando serve: il cleanup GDPR
   * cancella `chat_messages` alla scadenza della retention, quindi una pagina
   * che interrogasse la chat mostrerebbe l'archivio per N giorni e poi lo
   * troverebbe vuoto, senza errori e senza che nessuno se ne accorga. Lo
   * snapshot invece si congela alla prima visita della pagina conclusa, mentre i
   * messaggi ci sono ancora.
   */
  chatQuestions?: { text: string; reactions: number; answered: boolean }[];
  /** Published polls with per-option vote counts. */
  polls: RecapPoll[];
  /** Most-submitted word-cloud words with counts. */
  topWords: { word: string; count: number }[];
  feedback: { average: number | null; count: number };
}

/**
 * A short plain-text summary of the recap for the moderator follow-up email.
 * Locale labels are inlined so this stays a pure, server/edge-safe function
 * (no next-intl dependency). Omits empty sections.
 */
export function formatRecapSummary(recap: EventRecap, locale: 'it' | 'en'): string {
  const L =
    locale === 'it'
      ? {
          participants: 'Partecipanti (picco)',
          registered: 'Registrati',
          questions: 'Domande risposte',
          polls: 'Sondaggi',
          feedback: 'Media feedback',
          responses: 'risposte',
        }
      : {
          participants: 'Participants (peak)',
          registered: 'Registered',
          questions: 'Answered questions',
          polls: 'Polls',
          feedback: 'Average rating',
          responses: 'responses',
        };
  const lines: string[] = [];
  if (recap.headcount > 0) lines.push(`${L.participants}: ${recap.headcount}`);
  if (recap.registrations > 0) lines.push(`${L.registered}: ${recap.registrations}`);
  // Le domande poste in chat contano come domande: per chi legge il riepilogo
  // sono la stessa cosa, cambia solo dove sono state scritte.
  const questionCount = recap.topQuestions.length + (recap.chatQuestions?.length ?? 0);
  if (questionCount > 0) lines.push(`${L.questions}: ${questionCount}`);
  if (recap.polls.length > 0) lines.push(`${L.polls}: ${recap.polls.length}`);
  if (recap.feedback.average != null && recap.feedback.count > 0) {
    lines.push(
      `${L.feedback}: ${recap.feedback.average.toFixed(1)}/5 (${recap.feedback.count} ${L.responses})`,
    );
  }
  return lines.join('\n');
}

/** True when the recap has no content worth showing (empty event). */
export function isRecapEmpty(recap: EventRecap): boolean {
  return (
    recap.headcount === 0 &&
    recap.registrations === 0 &&
    recap.topQuestions.length === 0 &&
    (recap.chatQuestions?.length ?? 0) === 0 &&
    recap.polls.length === 0 &&
    recap.topWords.length === 0 &&
    recap.feedback.count === 0
  );
}

/** Compute the recap from the current raw rows (does not persist). */
export async function buildRecap(eventId: string): Promise<EventRecap> {
  const [event, registrations, questions, polls, words, feedback, chatQuestions] = await Promise.all([
    prisma.event.findUnique({
      where: { id: eventId },
      select: { peakParticipants: true },
    }),
    prisma.registration.count({ where: { eventId } }),
    prisma.question.findMany({
      where: { eventId, status: { in: ['ANSWERED', 'HIGHLIGHTED'] } },
      orderBy: { upvoteCount: 'desc' },
      take: MAX_QUESTIONS,
      select: { text: true, upvoteCount: true },
    }),
    prisma.poll.findMany({
      where: { eventId, status: 'PUBLISHED' },
      orderBy: { createdAt: 'asc' },
      include: { votes: { select: { optionIndex: true } } },
    }),
    prisma.wordCloudSubmission.groupBy({
      by: ['word'],
      where: { round: { eventId } },
      _count: { word: true },
      orderBy: { _count: { word: 'desc' } },
      take: MAX_WORDS,
    }),
    prisma.eventFeedback.aggregate({
      where: { eventId },
      _avg: { rating: true },
      _count: true,
    }),
    // Domande poste in chat. Le scartate NON entrano nell'archivio pubblico —
    // stessa regola del Q&A storico, che pubblicava solo ANSWERED/HIGHLIGHTED:
    // un archivio che mostra "questa non verrà trattata" espone chi ha chiesto.
    // Le nascoste dalla moderazione sono escluse a maggior ragione.
    prisma.chatMessage.findMany({
      where: { eventId, isQuestion: true, hiddenAt: null, dismissedAt: null },
      select: {
        text: true,
        answeredAt: true,
        // Il conteggio, non gli autori delle reazioni: qui non deve entrare
        // nessun identificativo di persona.
        _count: { select: { reactions: true } },
      },
    }),
  ]);

  const recapPolls: RecapPoll[] = polls.map((p) => {
    const optionTexts = Array.isArray(p.options) ? (p.options as string[]) : [];
    const counts = optionTexts.map(() => 0);
    for (const v of p.votes) {
      if (v.optionIndex >= 0 && v.optionIndex < counts.length) {
        counts[v.optionIndex] = (counts[v.optionIndex] ?? 0) + 1;
      }
    }
    return {
      question: p.question,
      options: optionTexts.map((text, i) => ({ text, votes: counts[i] ?? 0 })),
      totalVotes: p.votes.length,
    };
  });

  // Il testo della chat è cifrato a riposo: qui si decifra una volta sola,
  // mentre lo snapshot si forma. L'ordinamento è per reazioni ricevute — è il
  // "voto" che la chat ha già — e si fa in memoria perché le reazioni sono
  // righe, non un contatore denormalizzato come sulle vecchie domande.
  const recapChatQuestions = chatQuestions
    .map((m) => ({
      text: tryDecryptPII(m.text) ?? m.text,
      reactions: m._count.reactions,
      answered: m.answeredAt !== null,
    }))
    .sort((a, b) => b.reactions - a.reactions)
    .slice(0, MAX_QUESTIONS);

  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    headcount: event?.peakParticipants ?? 0,
    registrations,
    topQuestions: questions.map((q) => ({ text: q.text, upvotes: q.upvoteCount })),
    chatQuestions: recapChatQuestions,
    polls: recapPolls,
    topWords: words.map((w) => ({ word: w.word, count: w._count.word })),
    feedback: {
      average: feedback._avg.rating ?? null,
      count: feedback._count,
    },
  };
}

/**
 * Return the persisted recap, generating + persisting it on first call for a
 * concluded event. Idempotent and safe under concurrent first-views (the write
 * is guarded on `postEventRecapAt` still being null). Returns null when there's
 * nothing to build (event missing, not yet ENDED, or a LEGACY import).
 */
export async function ensureEventRecap(eventId: string): Promise<EventRecap | null> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      status: true,
      eventType: true,
      postEventRecap: true,
      postEventRecapAt: true,
    },
  });
  if (!event) return null;
  if (event.postEventRecapAt && event.postEventRecap) {
    return event.postEventRecap as unknown as EventRecap;
  }
  // Only concluded, real events get a recap. LEGACY imports have no live data.
  if (event.status !== 'ENDED' || event.eventType === 'LEGACY') return null;

  const recap = await buildRecap(eventId);
  await prisma.event.updateMany({
    where: { id: eventId, postEventRecapAt: null },
    data: {
      postEventRecap: recap as unknown as Prisma.InputJsonValue,
      postEventRecapAt: new Date(),
    },
  });
  return recap;
}
