/**
 * Il pubblico vede chi altro e' in sala? La scheda Partecipanti, la griglia, la
 * striscia dei video e i nomi nella piazza dipendono da questa sola regola.
 *
 * Lo decide chi organizza (Event.participantListVisible), partendo dal formato
 * dell'evento (`elencoPredefinito`). Con gli pseudonimi resta nascosto. Nelle
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

/** Da qui in su un evento e' su vasta scala. */
const VASTA_SCALA = 300;

/**
 * Il valore di partenza: dove chi partecipa parla o si mostra ci si conosce
 * (una call di community, un incontro tra colleghi), e l'elenco si vede. Dove il
 * pubblico ascolta soltanto, o su vasta scala, resta nascosto.
 */
export function elencoPredefinito(evento: {
  participantsCanUnmute?: boolean | null;
  participantsCanStartVideo?: boolean | null;
  maxParticipants?: number | null;
}): boolean {
  if ((evento.maxParticipants ?? 0) >= VASTA_SCALA) return false;
  return !!evento.participantsCanUnmute || !!evento.participantsCanStartVideo;
}
