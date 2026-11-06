// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import type { RecordingAudience } from '@prisma/client';

import { isEventPageVisible } from '@/lib/events/visibility';
import { registrazioneRiservata } from '@/lib/recording/destination';

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
 * mostra e l'evento le ha raccolte. Con la registrazione riservata, dalla
 * destinazione o dal pubblico scelto dopo (`registrazioneRiservata`), non si
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
  recordingAudience: RecordingAudience;
}): boolean {
  return evento.postEventShowQA && evento.qaEnabled && !registrazioneRiservata(evento);
}

/**
 * Le domande arrivano ai modelli di sintesi e resoconto solo se la pagina le
 * pubblica adesso: `domandePubbliche`, con la pagina dell'evento visibile quando
 * il lavoro parte. Vale per entrambi, perche' il resoconto legge anche la sintesi
 * e cio' che il modello legge puo' uscirne riformulato.
 */
export function domandePerIModelli(
  evento: Parameters<typeof domandePubbliche>[0] & Parameters<typeof isEventPageVisible>[0],
): boolean {
  return domandePubbliche(evento) && isEventPageVisible(evento);
}

/**
 * Le domande possono comparire sulla pagina dell'evento anche se il Q&A si apre
 * dal vivo: la stessa regola di `domandePubbliche`, senza `qaEnabled`, che chi
 * conduce puo' accendere a sala aperta. E' cio' che dicono la scheda e gli
 * avvisi in sala, anche nelle chiamate rapide, che nascono con il Q&A spento.
 */
export function domandePubblicabili(
  evento: Omit<Parameters<typeof domandePubbliche>[0], 'qaEnabled'>,
): boolean {
  return domandePubbliche({ ...evento, qaEnabled: true });
}

/**
 * Se in sala si puo' dire che le domande possono comparire sulla pagina
 * dell'evento. Il valore lo calcola il server (`domandePubblicabili`): senza,
 * resta l'avviso piu' prudente.
 */
export function domandePubblicateInSala(evento: { domandePubblicabili?: boolean }): boolean {
  return evento.domandePubblicabili ?? true;
}
