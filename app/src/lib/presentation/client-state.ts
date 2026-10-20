/**
 * La presentazione come la vede il browser della sala: tre fonti, una regola.
 *
 * Arrivano in qualsiasi ordine:
 *   1. lo stato completo da GET .../presentation (all'apertura, col polling di
 *      riserva, o riletto quando il canale annuncia un documento nuovo);
 *   2. il puntatore dal canale della sala (snapshot `presentation`: materiale,
 *      pagina, versione), che porta le pagine girate senza riletture;
 *   3. la risposta alle proprie mutazioni, per chi presenta.
 * Vince sempre la versione più alta; a parità, l'ultima arrivata. Una risposta
 * lenta del polling non riporta così la sala alla pagina di prima.
 *
 * Il puntatore non ha titolo né nome di chi presenta (restano dietro la rotta
 * che controlla chi sta nella stanza): quando annuncia un documento che lo
 * stato completo non conosce ancora, la vista lo dice (`stale`) e chi la usa
 * rilegge. Il file intanto si può già chiedere: il suo indirizzo dipende solo
 * dal materiale.
 */

import {
  pointerOfState,
  presentationFileUrl,
  type PresentationInfo,
  type PresentationPointer,
  type PresentationState,
} from './types';

/** Il più recente fra due stati completi. */
export function newerState(
  a: PresentationState | null | undefined,
  b: PresentationState | null | undefined
): PresentationState | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return b.version >= a.version ? b : a;
}

/** Il più recente fra due puntatori. */
export function newerPointer(
  a: PresentationPointer | null | undefined,
  b: PresentationPointer | null | undefined
): PresentationPointer | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return b.version >= a.version ? b : a;
}

export interface PresentationView {
  /** La versione dello stato mostrato. */
  version: number;
  /** Il materiale presentato, o null quando nessuno presenta. */
  materialId: string | null;
  /** La pagina di chi presenta. */
  page: number;
  /** Titolo, chi presenta, pagine: null finché lo stato completo non è quello del materiale presentato. */
  info: PresentationInfo | null;
  /** Dove leggere il PDF, o null quando nessuno presenta. */
  fileUrl: string | null;
  /** Il canale annuncia un documento che lo stato completo non conosce: va riletto. */
  stale: boolean;
}

/** La vista della presentazione dallo stato completo e dal puntatore del canale. */
export function presentationView(
  eventSlug: string,
  full: PresentationState | null | undefined,
  pointer: PresentationPointer | null | undefined
): PresentationView {
  const ptr = newerPointer(full ? pointerOfState(full) : null, pointer);
  if (!ptr?.materialId) {
    return {
      version: ptr?.version ?? 0,
      materialId: null,
      page: 1,
      info: null,
      fileUrl: null,
      stale: false,
    };
  }
  const conosciuto =
    full?.presentation?.materialId === ptr.materialId ? full.presentation : null;
  return {
    version: ptr.version,
    materialId: ptr.materialId,
    page: ptr.page,
    info: conosciuto ? { ...conosciuto, page: ptr.page } : null,
    fileUrl: conosciuto?.fileUrl ?? presentationFileUrl(eventSlug, ptr.materialId),
    stale: !conosciuto,
  };
}

/** Una pagina valida per un documento di `total` pagine (se noto). */
export function clampPage(page: number, total: number | null | undefined): number {
  const max = total && total > 0 ? total : Number.MAX_SAFE_INTEGER;
  if (!Number.isFinite(page)) return 1;
  return Math.min(max, Math.max(1, Math.round(page)));
}
