import type { AdhocQuestionDraft, QuestionnaireBlock } from './step-4-content';

/**
 * Il questionario è cambiato rispetto a come era all'apertura del wizard?
 *
 * PERCHÉ SERVE. La rotta di salvataggio del questionario è una PUT che
 * **sostituisce** l'intero questionario con i soli campi che il wizard conosce:
 * modelli e domande estemporanee. Titolo, descrizione, obbligatorietà,
 * modificabilità e i testi multilingua che il wizard non mostra non ci sono, e
 * al loro posto la PUT scrive i valori predefiniti. Finché il questionario lo si
 * crea dal wizard il difetto non si vede: i valori predefiniti sono già quelli.
 * Si vede quando il questionario arriva da altrove — per esempio dalla copia di
 * un evento, che eredita un questionario curato: aprire la bozza, cambiare la
 * data e salvare azzerava l'obbligatorietà e riportava il titolo al generico.
 *
 * La soluzione è non toccare ciò che non si è modificato. Il confronto è con lo
 * scatto iniziale che il wizard già tiene per il resto delle relazioni, non con
 * il database: al momento del salvataggio non c'è modo di interrogarlo.
 */
function canonical(question: AdhocQuestionDraft): string {
  return JSON.stringify([
    question.prompt,
    question.type,
    question.options,
    question.scaleMin,
    question.scaleMax,
    question.required,
  ]);
}

function fingerprint(block: QuestionnaireBlock): string {
  // I modelli si confrontano nell'ordine: riordinarli cambia il `sortOrder`
  // con cui vengono mostrati, quindi è una modifica a tutti gli effetti.
  return JSON.stringify([block.templateIds, block.adhocQuestions.map(canonical)]);
}

/** Un blocco senza modelli né domande: non c'è nulla da salvare. */
function isEmpty(block: QuestionnaireBlock): boolean {
  return block.templateIds.length === 0 && block.adhocQuestions.length === 0;
}

export function questionnaireChanged(
  current: QuestionnaireBlock,
  initial: QuestionnaireBlock | null,
): boolean {
  if (!initial) return !isEmpty(current);
  return fingerprint(current) !== fingerprint(initial);
}
