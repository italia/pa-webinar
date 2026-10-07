/**
 * La forma della presentazione di un PDF nella sala, condivisa fra server e
 * browser. Nessun import di runtime: la legge anche il bundle della sala.
 */

import type { PresentationPointer } from '@/lib/live-state/pubsub';

export type { PresentationPointer };

/** Pagine al massimo: ben oltre ogni documento vero, solo un tetto all'input. */
export const PRESENTATION_PAGE_MAX = 2000;

/** Chi presenta: chi modera (link principale o co-moderatore) o un relatore. */
export type PresenterRole = 'MODERATOR' | 'SPEAKER';

/** La presentazione in corso come la vede chi sta nella stanza. */
export interface PresentationInfo {
  materialId: string;
  /** Pagina corrente, da 1. */
  page: number;
  /** Pagine del documento, come le ha contate chi presenta; null finché non le ha dette. */
  pageCount: number | null;
  title: string;
  /**
   * Il nome di chi presenta, quando c'è: quello della concessione nominale, o
   * quello del conduttore scritto sull'evento per il link principale. Null
   * altrimenti, e la sala mostra una dicitura tradotta.
   */
  presenterName: string | null;
  presenterRole: PresenterRole | null;
  startedAt: string | null;
  /** Dove si legge il PDF: la rotta che controlla chi sta nella stanza, mai l'indirizzo pubblico del file. */
  fileUrl: string;
}

/** Risposta di GET /api/events/[param]/presentation e delle mutazioni. */
export interface PresentationState {
  /** La versione dello stato: cresce a ogni cambio, anche alla chiusura. */
  version: number;
  presentation: PresentationInfo | null;
}

/** Dove si legge il PDF presentato: la rotta della presentazione, mai l'indirizzo del file. */
export function presentationFileUrl(eventSlug: string, materialId: string): string {
  return `/api/events/${encodeURIComponent(eventSlug)}/presentation/file?m=${encodeURIComponent(materialId)}`;
}

/** Il puntatore di uno stato completo, per confrontarlo con quelli del canale. */
export function pointerOfState(state: PresentationState): PresentationPointer {
  return {
    materialId: state.presentation?.materialId ?? null,
    page: state.presentation?.page ?? 1,
    version: state.version,
  };
}
