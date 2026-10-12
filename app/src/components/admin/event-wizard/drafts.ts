/**
 * Le chiavi del browser con cui il wizard tiene cio' che non e' ancora
 * salvato: le bozze di un evento nuovo, una per formato o modello
 * (`pa-wizard-draft:new:<id>`; la chiave senza `:<id>` e' la bozza di una
 * versione precedente), e i dati che «Cambia formato» porta al formato
 * nuovo. Contengono dati personali (nomi ed email di chi e' invitato):
 * docs/GDPR.md li elenca.
 */

export const BOZZA_NUOVO_KEY = 'pa-wizard-draft:new';

/** Dove «Cambia formato» lascia cio' che si era scritto sull'evento. */
export const TRASLOCO_KEY = 'pa-wizard-draft:trasloco';

/** Dopo dieci minuti non e' piu' lo stesso evento che si stava preparando. */
export const TRASLOCO_VALIDO_MS = 10 * 60 * 1000;

/** Toglie i dati di «Cambia formato» scaduti: non restano nel browser oltre
 *  il tempo in cui servono. */
export function pulisciTraslocoScaduto(adesso = Date.now()): void {
  try {
    const raw = localStorage.getItem(TRASLOCO_KEY);
    if (!raw) return;
    const { at } = JSON.parse(raw) as { at?: number };
    if (typeof at !== 'number' || adesso - at > TRASLOCO_VALIDO_MS) localStorage.removeItem(TRASLOCO_KEY);
  } catch {
    try {
      localStorage.removeItem(TRASLOCO_KEY);
    } catch {
      /* storage unavailable */
    }
  }
}
