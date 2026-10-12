/**
 * I numeri del resoconto dell'evento, calcolati dal portale: le statistiche
 * della scheda Statistiche (lib/analytics/event-stats), l'agenda con i
 * «d'accordo» e «non d'accordo» dei partecipanti, le valutazioni del
 * questionario dopo l'evento.
 *
 * Niente che identifichi una persona: conteggi, medie, testi di sondaggi,
 * domande e parole gia' pubblici nel riepilogo dell'evento. Restano quando la
 * pulizia toglie i dati da cui vengono.
 */
import { statisticheEvento, type StatisticheEvento } from '@/lib/analytics/event-stats';
import { prisma } from '@/lib/db';
import {
  buildEventFeedbackReport,
  type EventFeedbackReport,
} from '@/lib/feedback/event-feedback-report';

import type { ReportMetrics } from './types';

export interface VoceAgenda {
  label: string;
  status: string;
  plannedMinutes: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
  agree: number;
  disagree: number;
}

const pct = (n: number, d: number): number | null =>
  d > 0 ? Math.round((n / d) * 100) : null;

/** Il testo di una domanda del questionario nella lingua del resoconto. */
function inLingua(
  campo: Record<string, string> | null | undefined,
  lingua: string
): string {
  if (!campo) return '';
  return campo[lingua] ?? campo.it ?? Object.values(campo)[0] ?? '';
}

export interface ConteggioDomande {
  total: number;
  answered: number;
  /**
   * Le domande del pubblico in chat, scartate comprese: sono nel conto della
   * chat delle statistiche e se ne tolgono, contate o no come domande.
   */
  inChat: number;
}

/**
 * Le domande dell'evento: quelle fatte in chat dal pubblico e quelle del Q&A
 * separato, per gli eventi che lo usavano. Le nascoste e le scartate dalla
 * moderazione non contano, come nel riepilogo e negli ingressi del modello.
 */
export async function contaDomande(eventId: string): Promise<ConteggioDomande> {
  const delPubblico = { eventId, isQuestion: true, hiddenAt: null, isModerator: false };
  const inChat = { ...delPubblico, dismissedAt: null };
  const [qa, qaRisposte, chat, chatRisposte, chatTutte] = await Promise.all([
    prisma.question.count({ where: { eventId, status: { not: 'DISMISSED' } } }),
    prisma.question.count({ where: { eventId, status: { in: ['ANSWERED', 'HIGHLIGHTED'] } } }),
    prisma.chatMessage.count({ where: inChat }),
    prisma.chatMessage.count({ where: { ...inChat, answeredAt: { not: null } } }),
    prisma.chatMessage.count({ where: delPubblico }),
  ]);
  return { total: qa + chat, answered: qaRisposte + chatRisposte, inChat: chatTutte };
}

/** Dai dati gia' letti ai numeri del resoconto. Pura: si prova senza database. */
export function componiMetriche(
  s: StatisticheEvento,
  agenda: readonly VoceAgenda[],
  valutazioni: Pick<EventFeedbackReport, 'items' | 'responses' | 'legacy'>,
  domande: ConteggioDomande,
  lingua: string
): ReportMetrics {
  const voti = s.polls.reduce((t, p) => t + p.totalVotes, 0);
  const parole = s.topWords.reduce((t, w) => t + w.count, 0);
  const risposte = valutazioni.responses.length + valutazioni.legacy.count;
  return {
    version: 1,
    durationSec: s.durationSec,
    attendance: {
      registered: s.attendance.registered,
      joined: s.attendance.joined,
      peak: s.attendance.peakParticipants,
      conversionPct: s.attendance.conversionPct,
      avgDwellSec: s.attendance.avgDwellSec,
      retentionPct: s.attendance.retentionPct,
    },
    participation: {
      interactions: s.interactions.total,
      activePeople: s.interactions.distinctInteractors,
      // Il picco conta le persone in sala nello stesso momento: chi e' passato
      // in tempi diversi puo' essere di piu'. Le persone attive sono comunque
      // persone presenti.
      activePct: pct(
        s.interactions.distinctInteractors,
        Math.max(
          s.attendance.joined,
          s.attendance.peakParticipants,
          s.interactions.distinctInteractors
        )
      ),
      // Le domande fatte in chat si contano come domande, non due volte.
      chatMessages: Math.max(0, s.chat.byAudience - domande.inChat),
      questions: domande.total,
      pollVotes: voti,
      words: parole,
      reactions: s.reactions.total,
      handRaises: s.handRaises.total,
      attention: s.attention.score,
    },
    timeline: {
      bucketSec: s.timeline.bucketSec,
      peakIndex: s.timeline.peakIndex,
      buckets: s.timeline.buckets.map((b) => ({
        offsetSec: b.startOffsetSec,
        label: b.label,
        chat: b.chat,
        questions: b.question + b.upvote,
        polls: b.poll,
        words: b.word,
        reactions: b.reaction,
        total: b.total,
      })),
    },
    agenda: agenda.map((a) => ({
      label: a.label,
      status: a.status,
      plannedMinutes: a.plannedMinutes,
      actualMinutes:
        a.startedAt && a.completedAt
          ? Math.max(
              0,
              Math.round((a.completedAt.getTime() - a.startedAt.getTime()) / 60_000)
            )
          : null,
      agree: a.agree,
      disagree: a.disagree,
    })),
    polls: s.polls.map((p) => ({
      question: p.question,
      options: p.options.map((o) => ({ text: o.text, votes: o.votes })),
      totalVotes: p.totalVotes,
    })),
    words: s.topWords.slice(0, 30).map((w) => ({ word: w.word, count: w.count })),
    questions: {
      total: domande.total,
      answered: domande.answered,
      top: s.qa.topQuestions
        .slice(0, 5)
        .map((q) => ({ text: q.text, upvotes: q.upvotes })),
    },
    feedback: {
      responses: risposte,
      average: s.feedback.average,
      items: valutazioni.items
        .filter((it) => it.type === 'LIKERT' && it.distribution && it.answered > 0)
        .map((it) => ({
          prompt: inLingua(it.prompt, lingua),
          average: it.average,
          scaleMin: it.scaleMin ?? 1,
          scaleMax: it.scaleMax ?? 5,
          distribution: it.distribution ?? [],
          answered: it.answered,
        })),
    },
  };
}

/** L'agenda dell'evento con le reazioni dei partecipanti per voce. */
export async function agendaConReazioni(eventId: string): Promise<VoceAgenda[]> {
  const [voci, reazioni] = await Promise.all([
    prisma.eventAgendaItem.findMany({
      where: { eventId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        label: true,
        status: true,
        plannedMinutes: true,
        startedAt: true,
        completedAt: true,
      },
    }),
    prisma.agendaItemReaction.groupBy({
      by: ['agendaItemId', 'value'],
      where: { agendaItem: { eventId } },
      _count: { _all: true },
    }),
  ]);
  const conta = (id: string, valore: 'AGREE' | 'DISAGREE') =>
    reazioni.find((r) => r.agendaItemId === id && r.value === valore)?._count._all ?? 0;
  return voci.map((v) => ({
    label: v.label,
    status: v.status,
    plannedMinutes: v.plannedMinutes,
    startedAt: v.startedAt,
    completedAt: v.completedAt,
    agree: conta(v.id, 'AGREE'),
    disagree: conta(v.id, 'DISAGREE'),
  }));
}

/** I numeri del resoconto di un evento; null se l'evento non c'e'. */
export async function metricheResoconto(
  eventId: string,
  lingua: string,
  valutazioniLette?: EventFeedbackReport
): Promise<ReportMetrics | null> {
  const [s, agenda, valutazioni, domande] = await Promise.all([
    statisticheEvento(eventId),
    agendaConReazioni(eventId),
    valutazioniLette ?? buildEventFeedbackReport(eventId),
    contaDomande(eventId),
  ]);
  if (!s) return null;
  return componiMetriche(s, agenda, valutazioni, domande, lingua);
}
