/**
 * I passi del wizard dell'evento, in ordine: le domande semplici («Evento»,
 * «Quando», «Persone», il «Programma», facoltativo, e il riepilogo) e, a
 * parte, le impostazioni avanzate, gia' scelte dal modello. Stanno qui (e non
 * nel wizard) perche' li usano anche gli indirizzi della modifica (`?step=`)
 * e le pagine del server che li leggono.
 */
export const WIZARD_STEPS = ['base', 'schedule', 'invites', 'programme', 'review', 'advanced'] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

/** I passi numerati nella barra; le impostazioni avanzate stanno a parte. */
export const WIZARD_MAIN_STEPS = ['base', 'schedule', 'invites', 'programme', 'review'] as const;
export type WizardMainStep = (typeof WIZARD_MAIN_STEPS)[number];

/**
 * I passi numerati di un evento. Una chiamata istantanea non ha una pagina
 * pubblica, e quindi nemmeno un programma da pubblicare: il passo non c'e'.
 */
export function passiPrincipali(istantanea: boolean): readonly WizardMainStep[] {
  return istantanea ? WIZARD_MAIN_STEPS.filter((s) => s !== 'programme') : WIZARD_MAIN_STEPS;
}

/** Il passo da aprire per un evento: il programma di una chiamata istantanea
 *  (un indirizzo scritto a mano) apre il passo prima, «Persone». */
export function passoDisponibile(step: WizardStep, istantanea: boolean): WizardStep {
  return istantanea && step === 'programme' ? 'invites' : step;
}

/** Le sezioni delle impostazioni avanzate. */
export const WIZARD_ADVANCED_SECTIONS = [
  'participation',
  'recording',
  'content',
  'room',
  'data',
  'technical',
] as const;
export type WizardAdvancedSection = (typeof WIZARD_ADVANCED_SECTIONS)[number];

/**
 * I passi di una volta, che gli indirizzi gia' scritti possono ancora
 * nominare: «Permessi» e «Contenuti» sono diventati sezioni delle
 * impostazioni avanzate.
 */
const PASSI_DI_UNA_VOLTA: Record<string, { step: WizardStep; section?: WizardAdvancedSection }> = {
  permissions: { step: 'advanced', section: 'participation' },
  content: { step: 'advanced', section: 'content' },
};

/** Un valore arrivato da un indirizzo e' un passo del wizard? */
export function isWizardStep(value: unknown): value is WizardStep {
  return typeof value === 'string' && (WIZARD_STEPS as readonly string[]).includes(value);
}

/** Il passo (e la sezione) da aprire per il valore di `?step=`, anche uno di
 *  una volta; null se non dice niente. */
export function wizardStepFromParam(
  value: unknown,
): { step: WizardStep; section?: WizardAdvancedSection } | null {
  if (isWizardStep(value)) return { step: value };
  if (typeof value === 'string' && Object.hasOwn(PASSI_DI_UNA_VOLTA, value)) return PASSI_DI_UNA_VOLTA[value]!;
  return null;
}
