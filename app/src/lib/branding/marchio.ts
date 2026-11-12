// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * Il marchio di PA Webinar si mostra dai file di `public/images/logo/`, mai
 * ricomposto con il testo: il logotipo e' disegnato, non scritto.
 *
 * Intero (simbolo e logotipo) va solo dove il nome mostrato e' quello del
 * prodotto. Un'installazione che si e' data un nome proprio vede il simbolo
 * accanto al proprio nome, come prima.
 */
export const NOME_PRODOTTO = 'PA Webinar';

/** Il marchio intero in negativo, per i fondi blu (intestazione, barra della sala). */
export const MARCHIO_INTERO_NEGATIVO = '/images/logo/pa-webinar-lockup-white.svg';

/** Larghezza del marchio intero per un'altezza data: il file e' 1189,1 x 263,1. */
export function larghezzaMarchioIntero(altezza: number): number {
  return Math.round((altezza * 1189.1) / 263.1);
}

/** Vero se il nome mostrato e' quello del prodotto, comunque scritto. */
export function eNomeDelProdotto(nome: string | null | undefined): boolean {
  const n = (nome ?? '').trim();
  return n === '' || n.localeCompare(NOME_PRODOTTO, 'it', { sensitivity: 'base' }) === 0;
}
