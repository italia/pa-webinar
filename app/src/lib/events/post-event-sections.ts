// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import type { RecordingAudience } from '@prisma/client';

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

/**
 * Le domande del Q&A restano sulla pagina dopo l'evento: chi organizza le
 * mostra e l'evento le ha raccolte. Con la registrazione riservata non si
 * pubblicano, qualunque sia l'interruttore: e' una regola in lettura, quindi
 * vale anche per un evento che diventa riservato dopo, e `postEventShowQA` resta
 * la scelta di chi organizza. Una sola regola per la pagina, la sala e
 * GET /api/events/[param].
 *
 * Il riepilogo salvato resta intero: lo leggono anche l'email di fine evento e
 * le statistiche per lo staff. La vista pubblica, che ne toglie le domande, si
 * applica leggendolo per la pagina, mai in `ensureEventRecap`.
 */
export function domandePubbliche(evento: {
  postEventShowQA: boolean;
  qaEnabled: boolean;
  recordingDestination: RecordingAudience | null;
}): boolean {
  return (
    evento.postEventShowQA &&
    evento.qaEnabled &&
    evento.recordingDestination !== 'REGISTRANTS'
  );
}
