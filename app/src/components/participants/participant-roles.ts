/**
 * Ruoli nella conferenza per il pannello «Partecipanti».
 *
 * `getParticipantsInfo()` dell'IFrame API non porta il ruolo: le sue righe
 * hanno nome, avatar e id, e basta. Il ruolo lo portano `getRoomsInfo()` e
 * l'evento `participantRoleChanged`; qui si raccoglie da li'.
 *
 * Il ruolo di Jitsi pero' non e' quello del portale. Dove Jicofo non assegna il
 * ruolo dal token, chiunque abbia un JWT diventa moderatore della conferenza:
 * un'etichetta «Moderatore» su ogni riga direbbe il falso quanto
 * «Partecipante» su tutte. Le etichette si mostrano quindi solo quando i ruoli
 * distinguono davvero qualcuno: almeno un moderatore e almeno un non
 * moderatore fra chi e' in elenco.
 *
 * Il pulsante per espellere non dipende da nessuna di queste cose: lo decide il
 * ruolo nel portale di chi guarda, e non compare mai sulla propria riga.
 */

export type ConferenceRole = 'moderator' | 'participant';

/** Mappa endpoint id → ruolo nella conferenza, per chi ne ha uno noto. */
export type ConferenceRoles = Readonly<Record<string, ConferenceRole>>;

/** Qualunque ruolo diverso da «moderator» (participant, visitor, none) conta
 *  come partecipante: l'etichetta distingue solo chi modera. */
export function normalizeRole(role: unknown): ConferenceRole | null {
  if (typeof role !== 'string' || !role) return null;
  return role === 'moderator' ? 'moderator' : 'participant';
}

/**
 * Legge i ruoli dalla risposta di `getRoomsInfo()`. La forma non e' tipizzata
 * dall'IFrame API e cambia fra versioni: tutto cio' che non e' riconosciuto si
 * ignora, e una risposta illeggibile da' una mappa vuota (nessuna etichetta).
 */
export function rolesFromRoomsInfo(info: unknown): Record<string, ConferenceRole> {
  const roles: Record<string, ConferenceRole> = {};
  if (!info || typeof info !== 'object') return roles;
  const rooms = (info as { rooms?: unknown }).rooms;
  if (!Array.isArray(rooms)) return roles;
  // La stanza principale; senza il segno (versioni vecchie) valgono tutte.
  const main = rooms.filter(
    (r): r is { participants?: unknown } =>
      !!r && typeof r === 'object' && (r as { isMainRoom?: unknown }).isMainRoom === true,
  );
  for (const room of main.length > 0 ? main : rooms) {
    const participants = (room as { participants?: unknown })?.participants;
    if (!Array.isArray(participants)) continue;
    for (const p of participants) {
      if (!p || typeof p !== 'object') continue;
      const id = (p as { id?: unknown }).id;
      const role = normalizeRole((p as { role?: unknown }).role);
      if (typeof id === 'string' && id && role) roles[id] = role;
    }
  }
  return roles;
}

/**
 * I ruoli distinguono qualcuno? Vero solo se, fra gli id in elenco, c'e'
 * almeno un moderatore e almeno un non moderatore di ruolo noto.
 */
export function rolesAreMeaningful(roles: ConferenceRoles, ids: readonly string[]): boolean {
  let moderator = false;
  let other = false;
  for (const id of ids) {
    const role = roles[id];
    if (role === 'moderator') moderator = true;
    else if (role === 'participant') other = true;
    if (moderator && other) return true;
  }
  return false;
}

/**
 * Il pulsante per espellere: a chi modera nel portale, su ogni riga tranne la
 * propria. L'id locale arriva con l'ingresso nella conferenza, prima che
 * l'elenco si riempia; se mancasse non si esclude nessuna riga, perche'
 * nascondere il pulsante a chi modera lo lascerebbe senza modo di intervenire.
 */
export function canKick(
  isPortalModerator: boolean,
  participantId: string,
  localParticipantId: string | null | undefined,
): boolean {
  if (!isPortalModerator) return false;
  return !localParticipantId || participantId !== localParticipantId;
}
