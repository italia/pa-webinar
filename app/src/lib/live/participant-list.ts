/**
 * Il pubblico vede chi altro e' in sala? La scheda Partecipanti, la griglia, la
 * striscia dei video e i nomi nella piazza dipendono da questa sola regola.
 *
 * Di default no: lo mostra solo la scelta di chi organizza
 * (Event.participantListVisible). Con gli pseudonimi resta nascosto. Nelle
 * chiamate rapide tutti hanno microfono e camera e ci si vede: non sono un
 * evento con un pubblico.
 *
 * Chi conduce e chi interviene vedono sempre tutto: la regola riguarda il
 * pubblico. Nascondere riguarda l'interfaccia: Jitsi consegna comunque i nomi
 * al browser di chi e' in conferenza.
 */
export function elencoVisibileAlPubblico(evento: {
  participantListVisible?: boolean | null;
  audienceAnonymous?: boolean | null;
  eventType?: string | null;
}): boolean {
  if (evento.audienceAnonymous) return false;
  if (evento.eventType === 'INSTANT') return true;
  return evento.participantListVisible === true;
}
