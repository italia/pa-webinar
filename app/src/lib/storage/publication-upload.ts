/**
 * Caricamento manuale di un video dall'amministrazione (nuova pubblicazione
 * o registrazione di un evento esistente): nome dell'oggetto, tipi ammessi e
 * tetto di dimensione, condivisi dalla rotta che apre il caricamento e da
 * quella che lo chiude.
 */

import { randomUUID } from 'crypto';

/** Tetto del file caricato, uguale a quello controllato nel browser. */
export const MAX_PUBLICATION_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;

/** Estensioni ammesse e Content-Type che ne deriva. */
const VIDEO_TYPES = new Map<string, string>([
  ['mp4', 'video/mp4'],
  ['webm', 'video/webm'],
  ['mov', 'video/quicktime'],
  ['m4v', 'video/x-m4v'],
]);
const ALLOWED_CONTENT_TYPES = new Set(VIDEO_TYPES.values());

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/**
 * Forma degli oggetti creati da `planPublicationObject`: la rotta che chiude
 * o annulla un caricamento accetta solo questi, non una chiave qualsiasi del
 * dominio registrazioni.
 */
export const PUBLICATION_OBJECT_NAME_RE = new RegExp(
  `^publications/\\d{4}/${UUID}\\.(?:${[...VIDEO_TYPES.keys()].join('|')})$`,
);

/**
 * Nome dell'oggetto e Content-Type per un video caricato dal browser.
 *
 * `publications/<anno>/<uuid>.<ext>` raggruppa i caricamenti per anno, così
 * il contenitore resta navigabile col crescere dell'archivio; il nome
 * originale non entra nella chiave. Il Content-Type è quello dichiarato dal
 * browser se è tra i video ammessi, altrimenti quello dell'estensione.
 */
export function planPublicationObject(
  originalName: string,
  declaredType?: string,
  opts: { now?: Date; uuid?: string } = {},
): { objectName: string; contentType: string } {
  const dot = originalName.lastIndexOf('.');
  const extRaw = dot >= 0 ? originalName.slice(dot + 1).toLowerCase() : '';
  const ext = VIDEO_TYPES.has(extRaw) ? extRaw : 'mp4';
  const contentType =
    declaredType && ALLOWED_CONTENT_TYPES.has(declaredType)
      ? declaredType
      : (VIDEO_TYPES.get(ext) ?? 'video/mp4');
  const year = (opts.now ?? new Date()).getUTCFullYear();
  const uuid = opts.uuid ?? randomUUID();
  return { objectName: `publications/${year}/${uuid}.${ext}`, contentType };
}
