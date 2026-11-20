// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * Chi si iscrive a questo evento si vede proporre la rubrica: l'installazione
 * la tiene accesa (`SiteSetting.addressBookEnabled`) e l'evento la offre
 * (`Event.offerAddressBook`).
 *
 * Solo un `false` esplicito la toglie: le due colonne nascono vere, e un flag
 * assente vale acceso, come `liveCaptionsEnabled`. Per questo va chiamata con le
 * righe intere: `publicSettings()` toglie `addressBookEnabled`, il compilatore
 * accetta il risultato, e la rubrica sembrerebbe sempre accesa.
 */
export function rubricaProposta(
  evento: { offerAddressBook?: boolean | null },
  sito: { addressBookEnabled?: boolean | null }
): boolean {
  return sito.addressBookEnabled !== false && evento.offerAddressBook !== false;
}
