/**
 * I passi del wizard dell'evento, in ordine: prima chi partecipa con un ruolo
 * (`invites`, il passo «Persone»), poi che cosa può fare ciascun ruolo
 * (`permissions`). Stanno qui (e non nel wizard)
 * perche' li usano anche gli indirizzi della modifica (`?step=`) e le pagine
 * del server che li leggono.
 */
export const WIZARD_STEPS = ['base', 'invites', 'permissions', 'content', 'review'] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

/** Un valore arrivato da un indirizzo e' un passo del wizard? */
export function isWizardStep(value: unknown): value is WizardStep {
  return typeof value === 'string' && (WIZARD_STEPS as readonly string[]).includes(value);
}
