/**
 * Le valutazioni di un evento, per la sua pagina in amministrazione: il
 * questionario di fine evento (POST_EVENT) con le statistiche per domanda e
 * tutte le risposte, piu' le valutazioni a stelle raccolte prima che la sala
 * passasse ai questionari (EventFeedback). Mai il nome o l'email di chi ha
 * risposto: la sala promette risposte senza nome.
 */

import { csvCell } from '@/lib/utils/csv';
import { prisma } from '@/lib/db';
import { findEventQuestionnaireByPlacement, type RenderedItem } from '@/lib/questionnaires';

export interface FeedbackItemStats {
  id: string;
  type: RenderedItem['type'];
  prompt: Record<string, string>;
  options: Record<string, string>[] | null;
  scaleMin: number | null;
  scaleMax: number | null;
  scaleMinLabel: Record<string, string> | null;
  scaleMaxLabel: Record<string, string> | null;
  /** Quante risposte hanno toccato questa domanda. */
  answered: number;
  /** Media (scala e si/no come 1/0); null se non numerica o senza risposte. */
  average: number | null;
  /** Conteggi per valore della scala, o per opzione (scelte), o [no, si]. */
  distribution: number[] | null;
}

export interface FeedbackResponseRow {
  id: string;
  submittedAt: string;
  /** Risposta legata a un'iscrizione o al browser di chi non ne aveva una. */
  kind: 'registration' | 'guest';
  answers: Record<string, { scale?: number; text?: string; choices?: number[] }>;
}

export interface EventFeedbackReport {
  enabled: boolean;
  questionnaire: { id: string; title: Record<string, string> } | null;
  items: FeedbackItemStats[];
  responses: FeedbackResponseRow[];
  legacy: {
    count: number;
    average: number | null;
    entries: Array<{ rating: number; comment: string | null; createdAt: string }>;
  };
}

function media(valori: number[]): number | null {
  if (valori.length === 0) return null;
  return Math.round((valori.reduce((a, b) => a + b, 0) / valori.length) * 100) / 100;
}

export async function buildEventFeedbackReport(eventId: string): Promise<EventFeedbackReport> {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { feedbackEnabled: true } });
  const q = await findEventQuestionnaireByPlacement(eventId, 'POST_EVENT');

  const righe = q
    ? await prisma.questionnaireResponse.findMany({
        where: { questionnaireId: q.id },
        orderBy: { submittedAt: 'desc' },
        select: {
          id: true,
          submittedAt: true,
          registrationId: true,
          answers: { select: { itemId: true, valueText: true, valueChoices: true, valueScale: true } },
        },
      })
    : [];

  const responses: FeedbackResponseRow[] = righe.map((r) => {
    const answers: FeedbackResponseRow['answers'] = {};
    for (const a of r.answers) {
      const v: { scale?: number; text?: string; choices?: number[] } = {};
      if (a.valueScale != null) v.scale = a.valueScale;
      if (a.valueText && a.valueText.trim()) v.text = a.valueText.trim();
      if (Array.isArray(a.valueChoices)) {
        v.choices = (a.valueChoices as unknown[]).filter((n): n is number => typeof n === 'number');
      }
      answers[a.itemId] = v;
    }
    return {
      id: r.id,
      submittedAt: r.submittedAt.toISOString(),
      kind: r.registrationId ? 'registration' : 'guest',
      answers,
    };
  });

  const items: FeedbackItemStats[] = (q?.items ?? []).map((it) => {
    const valori = responses.map((r) => r.answers[it.id]).filter((v) => v !== undefined);
    let average: number | null = null;
    let distribution: number[] | null = null;
    if (it.type === 'LIKERT') {
      const min = it.scaleMin ?? 1;
      const max = it.scaleMax ?? 5;
      const scala = valori.map((v) => v.scale).filter((n): n is number => typeof n === 'number');
      average = media(scala);
      distribution = Array.from({ length: max - min + 1 }, (_, i) => scala.filter((n) => n === min + i).length);
    } else if (it.type === 'YES_NO') {
      const scala = valori.map((v) => v.scale).filter((n): n is number => n === 0 || n === 1);
      average = media(scala);
      distribution = [scala.filter((n) => n === 0).length, scala.filter((n) => n === 1).length];
    } else if (it.type === 'SINGLE_CHOICE' || it.type === 'MULTI_CHOICE') {
      distribution = (it.options ?? []).map(
        (_, i) => valori.filter((v) => (v.choices ?? []).includes(i)).length,
      );
    }
    const answered = valori.filter(
      (v) => v.scale !== undefined || v.text !== undefined || (v.choices ?? []).length > 0,
    ).length;
    return {
      id: it.id,
      type: it.type,
      prompt: it.prompt,
      options: it.options,
      scaleMin: it.scaleMin,
      scaleMax: it.scaleMax,
      scaleMinLabel: it.scaleMinLabel,
      scaleMaxLabel: it.scaleMaxLabel,
      answered,
      average,
      distribution,
    };
  });

  const vecchie = await prisma.eventFeedback.findMany({
    where: { eventId },
    orderBy: { createdAt: 'desc' },
    select: { rating: true, comment: true, createdAt: true },
  });

  return {
    enabled: event?.feedbackEnabled ?? false,
    questionnaire: q ? { id: q.id, title: q.title } : null,
    items,
    responses,
    legacy: {
      count: vecchie.length,
      average: media(vecchie.map((v) => v.rating)),
      entries: vecchie.map((v) => ({
        rating: v.rating,
        comment: v.comment?.trim() || null,
        createdAt: v.createdAt.toISOString(),
      })),
    },
  };
}

/** Un campo CSV: tra virgolette se serve, e mai interpretato come formula.
 *  Il separatore e' il punto e virgola: e' quello che Excel si aspetta con le
 *  impostazioni italiane ed europee. */
const campo = csvCell;

/** Le risposte in CSV: una riga per risposta, una colonna per domanda. */
export function feedbackReportCsv(
  report: EventFeedbackReport,
  locale: string,
  labels: { yes: string; no: string } = { yes: 'yes', no: 'no' },
): string {
  const testo = (m: Record<string, string> | null | undefined) => (m ? m[locale] || m.it || Object.values(m)[0] || '' : '');
  const intestazione = ['submitted_at', 'respondent', ...report.items.map((it) => testo(it.prompt))];
  const righe = report.responses.map((r) => [
    r.submittedAt,
    r.kind,
    ...report.items.map((it) => {
      const a = r.answers[it.id];
      if (!a) return '';
      if (a.scale !== undefined) {
        if (it.type === 'YES_NO') return a.scale === 1 ? labels.yes : labels.no;
        return String(a.scale);
      }
      if (a.text !== undefined) return a.text;
      if (a.choices) return a.choices.map((i) => testo(it.options?.[i])).join(' | ');
      return '';
    }),
  ]);
  return [intestazione, ...righe].map((r) => r.map(campo).join(';')).join('\r\n') + '\r\n';
}
