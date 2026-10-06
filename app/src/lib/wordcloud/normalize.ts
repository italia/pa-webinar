/**
 * La forma con cui una parola di «In una parola» entra e si conta.
 *
 * Minuscole, spazi compattati, niente punteggiatura o simboli in testa e in
 * coda: «Chiarezza!», « chiarezza » e «#chiarezza» sono la stessa parola. Gli
 * apostrofi e i trattini interni restano («l'ascolto», «e-government»). Una
 * parola fatta solo di simboli diventa vuota e non si accetta.
 *
 * La usa il server per salvare e contare, e il pannello per accorgersi prima
 * dell'invio che la stessa parola e' gia' stata mandata.
 */
export function normalizeWord(raw: string): string {
  return raw
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/** Durata che vuol dire «resta aperta finche' il moderatore non la chiude». */
export const WORD_ROUND_NO_LIMIT = 0;

/** Il giro e' scaduto? Mai, per un giro senza limite di tempo. */
export function isRoundExpired(round: { duration: number; createdAt: Date }, now = Date.now()): boolean {
  if (round.duration === WORD_ROUND_NO_LIMIT) return false;
  return now - round.createdAt.getTime() > round.duration * 1000;
}

export interface WordRow {
  word: string;
  registrationId: string | null;
  guestId: string | null;
  /** La domanda: nel riepilogo di un evento le domande sono piu' d'una. */
  roundId?: string;
}

/**
 * Quante PERSONE hanno scritto ogni parola, dalla piu' scritta. La parola si
 * confronta normalizzata (anche le righe salvate prima della normalizzazione:
 * «Chiarezza!» e «chiarezza» sono la stessa) e una persona conta una volta per
 * parola in ogni domanda. Le parole che normalizzate restano vuote si saltano.
 */
export function countWordsByPerson(rows: readonly WordRow[]): { word: string; count: number }[] {
  const persone = new Map<string, Set<string>>();
  for (const r of rows) {
    const parola = normalizeWord(r.word);
    if (!parola) continue;
    const chi = `${r.roundId ?? ''}|${r.registrationId ? `r:${r.registrationId}` : `g:${r.guestId ?? ''}`}`;
    const insieme = persone.get(parola) ?? new Set<string>();
    insieme.add(chi);
    persone.set(parola, insieme);
  }
  return Array.from(persone.entries())
    .map(([word, chi]) => ({ word, count: chi.size }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
}
