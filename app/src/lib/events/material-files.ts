/**
 * Il file dietro un materiale caricato: dove si legge, quale chiave un
 * materiale può puntare e come se ne va.
 *
 * Un materiale caricato è un blob nello storage "files" sotto
 * `assets/document/…` (o `events/{id}/files/…`, il caricamento per evento),
 * servito da `/api/assets/…` come ogni altro asset pubblico. Il blob
 * appartiene alla riga che lo tiene in `blobPath` e se ne va con lei: chi
 * toglie il materiale — dalla sala, dall'area admin, cancellando l'evento — e
 * la retention (`/api/cron/cleanup`) lo cancellano con `removeMaterialBlob`,
 * PRIMA della riga. Se lo storage non risponde la riga resta: l'operazione
 * fallisce e si riprova, e la retention ci ripassa al giro dopo. Un file
 * rimasto senza riga resterebbe scaricabile da chiunque abbia l'URL, senza più
 * nulla che lo elenchi né lo cancelli.
 *
 * `blobPath` nell'area admin arriva dal client, e l'area è aperta anche
 * all'organizzatore sui propri eventi. Tre regole impediscono che togliere un
 * proprio materiale cancelli il file di qualcun altro:
 *   - la chiave è quella di un documento caricato, ed è il file che l'URL del
 *     materiale serve (`materialBlobPathProblem`);
 *   - un file che un'altra riga o l'informativa privacy di un evento usa già
 *     non si può rivendicare (`materialBlobClaimProblem`);
 *   - alla cancellazione il file resta se un'altra riga lo tiene ancora in
 *     `blobPath`, o se è l'informativa privacy di un evento, che il wizard
 *     carica con la stessa famiglia di chiavi.
 * Un link non possiede nessun file: che punti allo stesso URL non tiene in vita
 * il file di chi l'ha caricato, e un tipo LINK non ha mai un `blobPath`.
 */

import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { appBaseUrl } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { getFilesStorage } from '@/lib/storage';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/**
 * Le chiavi che l'app scrive per i documenti caricati, dall'area admin e dalla
 * sala: `buildAssetKey('document', …)`, cioè
 * `assets/document/{yyyy}/{mm}/{uuid}-{nome ripulito}`.
 */
const MATERIAL_UPLOAD_KEY_RE = new RegExp(
  `^assets/document/\\d{4}/\\d{2}/${UUID}-[A-Za-z0-9._-]+$`,
  'i',
);

/** True se `key` è la chiave di un documento caricato come materiale. */
export function isMaterialUploadKey(key: string): boolean {
  return MATERIAL_UPLOAD_KEY_RE.test(key);
}

/**
 * La chiave del caricamento per evento (`/api/events/[param]/files`):
 * `events/{eventId}/files/{nome}`. L'evento sta nel percorso e lo scrive il
 * server, quindi appartiene a quell'evento; il nome invece viene dal client, e
 * un separatore dentro il nome uscirebbe dalla cartella dell'evento.
 */
function isEventFileKey(key: string, eventId: string): boolean {
  const prefix = `events/${eventId}/files/`;
  if (!key.startsWith(prefix)) return false;
  const name = key.slice(prefix.length);
  return name !== '' && name !== '.' && name !== '..' && !/[\\/]/.test(name);
}

/** Il percorso con cui `/api/assets` serve una chiave `assets/…`, o null. */
function servedPath(key: string): string | null {
  return key.startsWith('assets/') ? `/api/assets/${key.slice('assets/'.length)}` : null;
}

/**
 * URL assoluto con cui l'app serve il blob `key` (`assets/…`).
 *
 * Assoluto come quello dell'area admin (`/api/admin/assets/upload-url`): la
 * colonna `url` dei materiali è validata come URL assoluto, e un materiale
 * caricato in sala deve restare modificabile dall'area admin. L'origine è
 * quella pubblica configurata (`appBaseUrl`, che scarta un valore malformato);
 * senza, quella della richiesta.
 */
export function materialFileUrl(request: Request, key: string): string {
  const base = (appBaseUrl()?.href ?? new URL(request.url).origin).replace(/\/+$/, '');
  // La rotta di serving riaggiunge `assets/` e serve solo quel prefisso.
  return `${base}/api/assets/${key.replace(/^assets\//, '')}`;
}

/**
 * Perché un `blobPath` mandato dal client all'area admin non va bene, o null.
 *
 * Due regole: la chiave è quella di un documento caricato (niente logo, audio,
 * allegati di chat, registrazioni), ed è il file che l'`url` del materiale
 * serve — la riga cancella lo stesso file che mostra. Chi carica dall'area
 * admin riceve entrambi da `/api/admin/assets/upload-url` e li rimanda così.
 */
export function materialBlobPathProblem(blobPath: string, url: string): string | null {
  if (!isMaterialUploadKey(blobPath)) {
    return 'blobPath must be the key of an uploaded event document (assets/document/…)';
  }
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return 'url must be an absolute URL';
  }
  if (!pathname.endsWith(servedPath(blobPath)!)) {
    return 'blobPath must be the file served by url';
  }
  return null;
}

/**
 * Perché un materiale non può prendere in carico il file `blobPath`, o null:
 * il file lo usa già un'altra riga — con la stessa chiave o con l'URL che lo
 * serve — o l'informativa privacy di un evento. Un documento appena caricato
 * ha una chiave nuova e passa sempre; una chiave già in giro no, perché la
 * riga che la prende in carico la cancellerebbe andandosene, anche con la
 * retention del proprio evento. `exceptMaterialId` è la riga che la sta
 * prendendo (in una modifica).
 */
export async function materialBlobClaimProblem(
  blobPath: string,
  exceptMaterialId?: string,
): Promise<string | null> {
  const served = servedPath(blobPath);
  const [materiale, informativa] = await Promise.all([
    prisma.eventMaterial.findFirst({
      where: {
        OR: [{ blobPath }, ...(served ? [{ url: { endsWith: served } }] : [])],
        ...(exceptMaterialId ? { id: { not: exceptMaterialId } } : {}),
      },
      select: { id: true },
    }),
    served
      ? prisma.event.findFirst({
          where: { privacyPolicyUrl: { endsWith: served } },
          select: { id: true },
        })
      : null,
  ]);
  if (materiale || informativa) return 'blobPath is already used by another material or event';
  return null;
}

/**
 * Esito della rimozione del file di un materiale:
 *   - `deleted`: il file non c'è più (tolto adesso, o già assente);
 *   - `kept`: resta di proposito — nessun file, chiave estranea ai materiali
 *     dell'evento, un'altra riga o un'informativa lo usa, o nessuno storage
 *     configurato — e la riga può andarsene;
 *   - `failed`: lo storage, o il controllo sul database, non ha risposto; il
 *     file potrebbe esserci ancora, e la riga deve restare per riprovare.
 */
export type MaterialBlobOutcome = 'deleted' | 'kept' | 'failed';

/** Righe e eventi che stanno per andarsene: non contano come «ancora usato». */
export interface MaterialBlobLeaving {
  materialIds?: readonly string[];
  /** Eventi in cancellazione: né i loro materiali né la loro informativa. */
  eventIds?: readonly string[];
}

/** Se un'altra riga, o l'informativa di un evento, tiene ancora in vita il file. */
async function ancoraUsato(blobPath: string, leaving: MaterialBlobLeaving): Promise<boolean> {
  const served = servedPath(blobPath);
  const materialIds = leaving.materialIds ?? [];
  const eventIds = leaving.eventIds ?? [];
  const [materiale, informativa] = await Promise.all([
    prisma.eventMaterial.findFirst({
      where: {
        blobPath,
        ...(materialIds.length > 0 ? { id: { notIn: [...materialIds] } } : {}),
        ...(eventIds.length > 0 ? { eventId: { notIn: [...eventIds] } } : {}),
      },
      select: { id: true },
    }),
    served
      ? prisma.event.findFirst({
          where: {
            privacyPolicyUrl: { endsWith: served },
            ...(eventIds.length > 0 ? { id: { notIn: [...eventIds] } } : {}),
          },
          select: { id: true },
        })
      : null,
  ]);
  return materiale !== null || informativa !== null;
}

type FilesStorage = NonNullable<ReturnType<typeof getFilesStorage>>;

/**
 * Cancella `key` e dice se non c'è più. `false` da `delete` vuol dire «non
 * c'era» per un fornitore e «non riuscito» per un altro: decide lo storage
 * stesso, cercando la chiave. Solleva se lo storage non risponde.
 */
async function cancellaDalloStorage(storage: FilesStorage, key: string): Promise<boolean> {
  if (await storage.delete(key)) return true;
  return !(await storage.list(key)).some((e) => e.key === key);
}

/**
 * Cancella il file del materiale dell'evento `eventId` che sta per essere
 * tolto o sostituito. Da chiamare PRIMA di cancellare (o sganciare) la riga,
 * indicando in `leaving` le righe che se ne vanno: con `failed` la riga resta
 * dov'è, altrimenti nessuno ritroverebbe più il file.
 *
 * Il file resta (`kept`) se la chiave non è di un materiale di quell'evento, o
 * se un'altra riga lo tiene ancora in `blobPath`, o se è l'informativa privacy
 * di un evento. Non solleva mai; un errore finisce nel log con la sola chiave.
 */
export async function removeMaterialBlob(
  blobPath: string | null | undefined,
  eventId: string,
  leaving: MaterialBlobLeaving = {},
): Promise<MaterialBlobOutcome> {
  if (!blobPath) return 'kept';
  if (!isMaterialUploadKey(blobPath) && !isEventFileKey(blobPath, eventId)) {
    console.warn('[materials] file non cancellato: chiave fuori dai materiali dell’evento:', blobPath);
    return 'kept';
  }
  const storage = getFilesStorage();
  if (!storage) return 'kept';
  try {
    if (await ancoraUsato(blobPath, leaving)) return 'kept';
    if (await cancellaDalloStorage(storage, blobPath)) return 'deleted';
    console.error('[materials] cancellazione del file non riuscita:', blobPath);
    return 'failed';
  } catch (err) {
    console.error(
      '[materials] cancellazione del file non riuscita:',
      blobPath,
      err instanceof Error ? err.message : err,
    );
    return 'failed';
  }
}

/**
 * L'errore con cui una rotta rinuncia a togliere un materiale, o un evento,
 * perché un file non si è potuto cancellare: la riga resta, e chi l'ha chiesto
 * riprova quando lo storage risponde.
 */
export function fileDeletionFailed(): AppError {
  return new AppError(
    'Files storage did not confirm a file deletion: the record was kept, retry later',
    503,
    'STORAGE_DELETE_FAILED',
  );
}

/**
 * Cancella un blob appena scritto che nessuna riga ha fatto in tempo a
 * puntare (la creazione della riga è fallita). La chiave l'ha decisa il server
 * un istante prima, con un UUID nuovo: nessun controllo da fare, e il database
 * che ha appena fallito non va interrogato. Non solleva mai.
 */
export async function discardUploadedBlob(key: string): Promise<void> {
  const storage = getFilesStorage();
  if (!storage) return;
  try {
    await storage.delete(key);
  } catch (err) {
    console.error(
      '[materials] file appena caricato non rimosso:',
      key,
      err instanceof Error ? err.message : err,
    );
  }
}

export interface MaterialBlobRef {
  id: string;
  eventId: string;
  blobPath: string;
}

/**
 * I file dei materiali degli eventi scelti da `where`: le righe che ne tengono
 * uno in `blobPath`, di qualunque tipo. Da leggere PRIMA di cancellarle.
 */
export async function materialBlobsOfEvents(
  where: Prisma.EventWhereInput,
): Promise<MaterialBlobRef[]> {
  const rows = await prisma.eventMaterial.findMany({
    where: { event: where, blobPath: { not: null } },
    select: { id: true, eventId: true, blobPath: true },
  });
  return rows.flatMap((r) =>
    r.blobPath ? [{ id: r.id, eventId: r.eventId, blobPath: r.blobPath }] : [],
  );
}

/** Quante cancellazioni di file tenere in volo insieme. */
const CANCELLAZIONI_IN_PARALLELO = 5;

/**
 * Cancella i file letti con `materialBlobsOfEvents`, prima che le righe se ne
 * vadano, con le regole di `removeMaterialBlob`. Restituisce quanti file ha
 * tolto e le righe il cui file non si è potuto cancellare: quelle devono
 * restare.
 */
export async function removeMaterialBlobs(
  refs: readonly MaterialBlobRef[],
  leaving: MaterialBlobLeaving = {},
): Promise<{ deleted: number; failed: MaterialBlobRef[] }> {
  let deleted = 0;
  const failed: MaterialBlobRef[] = [];
  for (let i = 0; i < refs.length; i += CANCELLAZIONI_IN_PARALLELO) {
    const gruppo = refs.slice(i, i + CANCELLAZIONI_IN_PARALLELO);
    const esiti = await Promise.all(
      gruppo.map((r) => removeMaterialBlob(r.blobPath, r.eventId, leaving)),
    );
    esiti.forEach((esito, j) => {
      if (esito === 'deleted') deleted++;
      if (esito === 'failed') failed.push(gruppo[j]!);
    });
  }
  return { deleted, failed };
}

/**
 * Cancella i file degli eventi scelti da `where`, che stanno per essere
 * cancellati: i materiali caricati e gli allegati della chat. Da chiamare
 * PRIMA della cancellazione: la cascata porta via le righe, e con loro l'unico
 * riferimento ai blob — né la retention né nient'altro li ritroverebbe più, e
 * resterebbero scaricabili da chi ne ha l'URL.
 *
 * Se anche un solo file non si cancella solleva `fileDeletionFailed()` e gli
 * eventi vanno lasciati dove sono: si riprova, e i file già tolti non fanno
 * danno. Restituisce quanti file ha tolto.
 */
export async function removeFilesOfEventsBeingDeleted(
  where: Prisma.EventWhereInput,
): Promise<number> {
  const eventi = await prisma.event.findMany({ where, select: { id: true } });
  if (eventi.length === 0) return 0;
  const eventIds = eventi.map((e) => e.id);

  const materiali = await materialBlobsOfEvents({ id: { in: eventIds } });
  const esitoMateriali = await removeMaterialBlobs(materiali, { eventIds });

  const allegati = await prisma.chatMessage.findMany({
    where: { eventId: { in: eventIds }, attachmentBlobPath: { not: null } },
    select: { eventId: true, attachmentBlobPath: true },
  });
  let allegatiTolti = 0;
  let allegatiFalliti = 0;
  const storage = getFilesStorage();
  for (const a of allegati) {
    const key = a.attachmentBlobPath;
    // Solo lo spazio degli allegati di quell'evento, che scrive il server.
    if (!storage || !key || !key.startsWith(`assets/chat/${a.eventId}/`)) continue;
    try {
      if (!(await cancellaDalloStorage(storage, key))) throw new Error('still present');
      allegatiTolti++;
    } catch (err) {
      allegatiFalliti++;
      console.error(
        '[events] allegato di chat non cancellato:',
        key,
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (esitoMateriali.failed.length > 0 || allegatiFalliti > 0) throw fileDeletionFailed();
  return esitoMateriali.deleted + allegatiTolti;
}
