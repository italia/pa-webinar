/**
 * Le sezioni che la pagina di un evento concluso mostra al pubblico, se c'e'
 * qualcosa da mostrare: la scelta di chi organizza (Event.postEventShow*),
 * come la applica la pagina. Le usa il dialogo di chiusura della sala per
 * dire cosa restera' visibile, con «se ce ne sono»: una sezione accesa senza
 * contenuto (nessun sondaggio pubblicato, nessun materiale) non compare.
 */
export const SEZIONI_DOPO_EVENTO = ['recap', 'qa', 'polls', 'wordCloud', 'materials', 'feedback'] as const;
export type SezioneDopoEvento = (typeof SEZIONI_DOPO_EVENTO)[number];

export function sezioniDopoEvento(mostra: Record<SezioneDopoEvento, boolean>): SezioneDopoEvento[] {
  return SEZIONI_DOPO_EVENTO.filter((s) => mostra[s]);
}
