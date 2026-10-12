/**
 * Quali modelli di domande si propongono per un questionario: quelli pensati
 * per quel momento (prima dell'evento, all'iscrizione; dopo l'evento, come
 * feedback) e quelli senza indicazione, che valgono per entrambi. Un modello
 * già scelto resta in elenco anche se è per l'altro momento, così si può
 * togliere.
 */

export type QuestionnaireMoment = 'PRE_REGISTRATION' | 'POST_EVENT';

/** Il momento di un modello: null = prima e dopo l'evento. */
export type TemplateUsage = QuestionnaireMoment | null;

/** L'etichetta breve di un momento (admin.questionTemplates). */
export const USAGE_SHORT_KEY = {
  PRE_REGISTRATION: 'usagePreShort',
  POST_EVENT: 'usagePostShort',
  ANY: 'usageAnyShort',
} as const;

/** Un modello pensato per l'altro momento, tenuto in elenco perché scelto. */
export function isForOtherMoment(moment: QuestionnaireMoment, usage: TemplateUsage | undefined): boolean {
  return !!usage && usage !== moment;
}

export function templatesFor<T extends { id: string; usage?: QuestionnaireMoment | null }>(
  moment: QuestionnaireMoment,
  templates: readonly T[],
  selectedIds: readonly string[] = [],
): T[] {
  const scelti = new Set(selectedIds);
  return templates.filter((t) => !t.usage || t.usage === moment || scelti.has(t.id));
}
