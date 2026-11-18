// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/** Gli stati di una richiesta di rimozione, come li mostra l'amministrazione. */
export type StatoRichiesta =
  'OPEN' | 'IN_PROGRESS' | 'PROCESSING' | 'CLOSED' | 'REJECTED';

/** Il colore del badge di ciascuno stato (Bootstrap Italia). */
export const COLORE_STATO: Record<StatoRichiesta, string> = {
  OPEN: 'warning',
  IN_PROGRESS: 'primary',
  PROCESSING: 'primary',
  CLOSED: 'success',
  REJECTED: 'secondary',
};
