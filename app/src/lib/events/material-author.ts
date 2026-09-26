/**
 * Chi ha aggiunto un materiale dalla sala, per la riga «Aggiunto da …».
 *
 * Si salva un nome solo quando e' gia' pubblico: quello del conduttore scritto
 * sull'evento, per chi usa il link moderatore principale. Un co-moderatore ha
 * il nome cifrato a riposo, e copiarlo in chiaro nella riga del materiale lo
 * toglierebbe dalla cifratura; per lui, e per un evento senza conduttore, si
 * salva la stringa vuota (la colonna non ammette null) e la sala mostra una
 * dicitura tradotta invece di un nome.
 */
export function materialAddedBy(
  grant: { isPrimaryShared: boolean; displayName: string | null } | null,
): string {
  if (!grant?.isPrimaryShared) return '';
  return grant.displayName?.trim() ?? '';
}

/**
 * Valori scritti in passato al posto di un nome: parole fisse, in inglese, che
 * la sala mostrava tali e quali in ogni lingua. Letti come «nessun nome».
 */
const SEGNAPOSTO_STORICI = new Set(['moderator', 'admin']);

/**
 * Il nome da mostrare, oppure null quando la riga non ne porta uno (stringa
 * vuota o un segnaposto storico): chi legge usa allora la dicitura tradotta.
 */
export function materialAuthorName(addedBy: string | null | undefined): string | null {
  const nome = addedBy?.trim();
  if (!nome || SEGNAPOSTO_STORICI.has(nome.toLowerCase())) return null;
  return nome;
}
