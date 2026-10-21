/**
 * Regole delle risposte comuni al modulo d'iscrizione e alla rotta: qui, e
 * non in `lib/questionnaires`, perche' quel modulo legge il database e il
 * modulo d'iscrizione gira nel browser.
 */

/** Una risposta che non dice niente: nessun testo, nessuna scelta, nessun valore. */
export function rispostaVuota(r: {
  valueText?: string | null;
  valueChoices?: number[] | null;
  valueScale?: number | null;
}): boolean {
  return (
    (r.valueText ?? '').trim() === '' &&
    (r.valueChoices ?? []).length === 0 &&
    (r.valueScale === null || r.valueScale === undefined)
  );
}
