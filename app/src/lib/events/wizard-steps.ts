/**
 * I passi del wizard dell'evento, in ordine. Stanno qui (e non nel wizard)
 * perche' li usano anche gli indirizzi della modifica (`?step=`) e le pagine
 * del server che li leggono.
 */
export const WIZARD_STEPS = ['base', 'permissions', 'invites', 'content', 'review'] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

/** Un valore arrivato da un indirizzo e' un passo del wizard? */
export function isWizardStep(value: unknown): value is WizardStep {
  return typeof value === 'string' && (WIZARD_STEPS as readonly string[]).includes(value);
}
