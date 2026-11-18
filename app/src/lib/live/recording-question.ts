// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * La domanda «vuoi comparire nella registrazione?» in una chiamata rapida.
 *
 * Nelle chiamate rapide tutti entrano fuori dalla registrazione
 * (lib/live/consent-rule): finche' nessuno registra non cambia niente. Quando
 * la registrazione parte, la sala lo chiede a chi e' fuori. Ogni avvio e' un
 * «giro»: la risposta vale per quel giro. Un si' resta finche' la persona non lo
 * ritira, perche' e' un consenso con la sua prova; un no, o nessuna risposta,
 * lascia la persona fuori, e al giro dopo la domanda torna.
 *
 * Il giro si chiude per la persona quando risponde, in qualunque modo, o quando
 * nel giro e' stata nella registrazione: chi ritira il consenso a registrazione
 * in corso non se lo vede richiedere subito dopo. Chi entra a registrazione gia'
 * in corso apre un giro suo: anche lui riceve la domanda.
 *
 * Il modulo e' puro: lo stato lo tiene la sala (hooks/use-recording-question).
 */

export interface StatoDomanda {
  /** Gli avvii della registrazione visti da questa pagina. */
  giro: number;
  /** La registrazione e' in corso. */
  inCorso: boolean;
  /** L'ultimo giro chiuso per questa persona. */
  risolto: number;
}

export const DOMANDA_INIZIALE: StatoDomanda = { giro: 0, inCorso: false, risolto: 0 };

export type EventoDomanda =
  /** Lo stato della registrazione, come lo dice Jitsi a tutta la sala. */
  | { tipo: 'registrazione'; inCorso: boolean }
  /** La persona e' nella registrazione (il suo token non la esclude). */
  | { tipo: 'dentro' }
  /** Ha risposto di no, o ha chiuso la domanda. */
  | { tipo: 'risposta' };

export function aggiornaDomanda(
  stato: StatoDomanda,
  evento: EventoDomanda
): StatoDomanda {
  if (evento.tipo === 'registrazione') {
    if (evento.inCorso === stato.inCorso) return stato;
    return evento.inCorso
      ? { ...stato, inCorso: true, giro: stato.giro + 1 }
      : { ...stato, inCorso: false };
  }
  // Fuori da una registrazione non c'e' un giro da chiudere.
  if (!stato.inCorso || stato.risolto === stato.giro) return stato;
  return { ...stato, risolto: stato.giro };
}

/**
 * Se la domanda e' aperta. `fuori`: il token in uso esclude la persona dalla
 * registrazione; null quando la sala non ha ancora un token.
 */
export function domandaAperta(stato: StatoDomanda, fuori: boolean | null): boolean {
  return stato.inCorso && fuori === true && stato.risolto !== stato.giro;
}
