// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * La ricerca nella rubrica per nome, email o ente.
 *
 * Nome ed email sono cifrati con un IV nuovo a ogni scrittura: SQL non li puo'
 * confrontare, quindi la ricerca decifra le voci sul server e le filtra qui,
 * in memoria. Il testo cercato e i dati decifrati non vanno mai nei log, e la
 * ricerca arriva nel corpo di una POST: un indirizzo nell'URL finirebbe nei log
 * di accesso dell'ingress.
 *
 * Il limite tiene fisso il costo di una ricerca: si guardano le voci toccate piu'
 * di recente, e la risposta dice se ne sono rimaste fuori.
 */
export const VOCI_ESAMINATE_MAX = 5000;

/** Senza maiuscole e senza accenti: «nicolo» trova «Nicolò». */
function piegato(testo: string): string {
  return testo.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Vero se uno dei campi, gia' in chiaro, contiene il testo cercato. */
export function voceCorrisponde(
  campi: readonly (string | null | undefined)[],
  testo: string
): boolean {
  const cercato = piegato(testo);
  return campi.some((campo) => !!campo && piegato(campo).includes(cercato));
}
