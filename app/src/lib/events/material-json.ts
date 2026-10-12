import type { EventMaterial } from '@prisma/client';

import { materialAuthorName } from './material-author';

/** Un materiale come lo ricevono la sala e la scheda pubblica. */
export interface RoomMaterialJson {
  id: string;
  type: string;
  title: string;
  url: string;
  description: string | null;
  /** Solo per i file caricati (type FILE): il peso da mostrare accanto. */
  fileSize: number | null;
  /** Il tipo verificato al caricamento: la sala ne ricava icona ed etichetta
   *  (lib/materials/file-kind). Null per i link. */
  mimeType: string | null;
  visibility: string;
  /** Null quando la riga non porta un nome: la sala mostra una dicitura
   *  tradotta (lib/events/material-author). */
  addedBy: string | null;
  createdAt: string;
  /** Quante volte è stato aperto o scaricato: solo per chi conduce. */
  openCount?: number;
}

/**
 * La forma di un materiale nelle risposte della sala (GET .../materials,
 * PATCH .../materials/[id]). `blobPath` non esce mai: è il percorso interno
 * nello storage. Il conteggio delle aperture è un dato per chi conduce
 * (`seesAll` di lib/events/material-access): il pubblico non lo riceve
 * affatto, nemmeno come campo vuoto.
 */
export function roomMaterialJson(
  m: Pick<
    EventMaterial,
    | 'id'
    | 'type'
    | 'title'
    | 'url'
    | 'description'
    | 'fileSize'
    | 'mimeType'
    | 'visibility'
    | 'addedBy'
    | 'createdAt'
    | 'openCount'
  >,
  { seesAll }: { seesAll: boolean },
): RoomMaterialJson {
  return {
    id: m.id,
    type: m.type,
    title: m.title,
    url: m.url,
    description: m.description,
    fileSize: m.fileSize != null ? Number(m.fileSize) : null,
    mimeType: m.mimeType ?? null,
    visibility: m.visibility,
    addedBy: materialAuthorName(m.addedBy),
    createdAt: m.createdAt.toISOString(),
    ...(seesAll ? { openCount: m.openCount } : {}),
  };
}
