/**
 * Avvisi del pannello Domande e risposte, fuori dai componenti perché si
 * possano verificare da soli.
 *
 * Due cose da sapere fra una lettura dell'elenco e la successiva: quali
 * domande sono arrivate e quali hanno appena ricevuto una risposta (lo stato
 * «Risposta data» o una risposta scritta). Su queste la sala accende il
 * pallino della scheda e, a chi le riguardano, suona o mostra la notifica.
 *
 * Le domande fatte da questo browser si ricordano per evento nel browser
 * stesso: solo gli identificativi, nessun testo. Servono a dire a chi ha
 * chiesto che la sua domanda ha avuto risposta.
 */

export interface QaListItem {
  id: string;
  authorName: string;
  text: string;
  status: string;
  answerText: string | null;
}

/** Quanto serve ricordare di una domanda per confrontarla con la lettura dopo. */
export type QaSeen = ReadonlyMap<string, { answered: boolean }>;

export function isAnswered(q: Pick<QaListItem, 'status' | 'answerText'>): boolean {
  return q.status === 'ANSWERED' || !!q.answerText;
}

export function qaSeen(items: readonly QaListItem[]): QaSeen {
  return new Map(items.map((q) => [q.id, { answered: isAnswered(q) }]));
}

/**
 * Cosa e' cambiato fra due letture. Alla prima lettura (`prev` null) niente:
 * cio' che c'era all'ingresso in sala non e' una novita'.
 */
export function qaChanges(
  prev: QaSeen | null,
  next: readonly QaListItem[],
): { newQuestions: QaListItem[]; newlyAnswered: QaListItem[] } {
  if (!prev) return { newQuestions: [], newlyAnswered: [] };
  const newQuestions: QaListItem[] = [];
  const newlyAnswered: QaListItem[] = [];
  for (const q of next) {
    const prima = prev.get(q.id);
    if (!prima) newQuestions.push(q);
    else if (!prima.answered && isAnswered(q)) newlyAnswered.push(q);
  }
  return { newQuestions, newlyAnswered };
}

/** Chiave del browser (localStorage) delle domande fatte da qui, per evento. */
export const MY_QUESTIONS_STORAGE_PREFIX = 'pa-webinar.qa-mine.';

/** Oltre questo numero si dimenticano le piu' vecchie. */
const MAX_MY_QUESTIONS = 50;

export function readMyQuestions(eventSlug: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(MY_QUESTIONS_STORAGE_PREFIX + eventSlug);
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function rememberMyQuestion(eventSlug: string, id: string): Set<string> {
  const ids = [...readMyQuestions(eventSlug).add(id)].slice(-MAX_MY_QUESTIONS);
  try {
    window.localStorage.setItem(MY_QUESTIONS_STORAGE_PREFIX + eventSlug, JSON.stringify(ids));
  } catch {
    // Storage non disponibile: la domanda resta riconosciuta finche' la
    // pagina e' aperta, attraverso lo stato di chi chiama.
  }
  return new Set(ids);
}
