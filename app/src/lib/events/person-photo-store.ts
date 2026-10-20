/**
 * Le foto delle persone dell'evento nel database (EventPersonPhoto): il
 * salvataggio di una foto caricata, il controllo degli id che arrivano dal
 * wizard e la cancellazione. Solo sul server.
 *
 * Una foto può servire più eventi: la copia di un evento porta con sé la foto
 * della persona, con lo stesso id. Per questo una foto si cancella solo con
 * `deleteUnreferencedPersonPhotos`, che toglie soltanto le righe che nessun
 * evento e nessuna concessione usano più.
 */

import type { Prisma, PrismaClient } from '@prisma/client';

import { prisma } from '@/lib/db';
import { normalizePhoto } from '@/lib/profile-photo';

import { PERSON_PHOTO_SIDE } from './person-photo';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * La foto come si salva: un JPEG quadrato di PERSON_PHOTO_SIDE di lato,
 * ricodificato qui senza metadati, qualunque cosa abbia mandato il browser.
 * Null se i byte non sono un JPEG, PNG o WebP leggibile.
 */
export function normalizePersonPhoto(input: Uint8Array): Promise<Buffer | null> {
  return normalizePhoto(input, PERSON_PHOTO_SIDE);
}

/** Salva una foto già ricodificata e ne restituisce l'id. */
export async function savePersonPhoto(jpeg: Buffer): Promise<string> {
  const foto = await prisma.eventPersonPhoto.create({
    data: { contentType: 'image/jpeg', bytes: new Uint8Array(jpeg) },
    select: { id: true },
  });
  return foto.id;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Nessun evento la usa come foto dell'organizzatore principale e nessuna
 *  concessione, revocata o no, come foto della persona. */
const SENZA_RIFERIMENTI = {
  leadOf: { none: {} },
  grants: { none: {} },
} satisfies Prisma.EventPersonPhotoWhereInput;

/**
 * Chi scrive la foto su un evento: lo staff che lo gestisce (o che lo crea),
 * o chi ha soltanto un link di conduzione.
 */
export type PersonPhotoWriter = 'staff' | 'link';

/**
 * L'id di una foto da scrivere su un evento (`eventId`, null alla creazione) o
 * su una sua concessione: lo stesso se la foto la usa già questo evento, o se
 * non la usa nessuno e a scriverla è lo staff; altrimenti null. Undefined
 * resta undefined: il campo non si tocca.
 *
 * Una foto già salvata la usa questo evento, anche quando passa da una
 * concessione a un'altra al cambio di ruolo, o quando la copia di un evento
 * la condivide con l'originale (la copia la riceve senza passare da qui:
 * lib/events/duplicate-*): la tiene anche chi ha solo il link di conduzione.
 * Una foto che nessuno usa è quella appena caricata dallo staff nel wizard,
 * ma anche quella tolta da un altro evento, o rimasta da un evento
 * cancellato, in attesa della pulizia: la aggancia solo lo staff, come solo
 * lo staff carica le foto. Con il solo link non si prende la foto mostrata
 * da un'altra pagina, né si tiene in vita una foto che il suo evento ha tolto.
 * La foto usata solo da altri eventi non si aggancia per nessuno.
 *
 * Un id sconosciuto si lascia cadere invece di rifiutare la richiesta: una
 * bozza del wizard può ricordare una foto caricata e mai salvata, che la
 * pulizia ha già tolto. Rifiutare farebbe fallire il salvataggio della persona
 * per una foto che comunque non c'è più.
 */
export async function usablePersonPhotoId(
  id: string | null | undefined,
  eventId: string | null,
  writer: PersonPhotoWriter,
  db: Db = prisma
): Promise<string | null | undefined> {
  if (id === undefined) return undefined;
  if (!id || !UUID_RE.test(id)) return null;
  const ammesse: Prisma.EventPersonPhotoWhereInput[] = [
    ...(writer === 'staff' ? [SENZA_RIFERIMENTI] : []),
    ...(eventId
      ? [{ leadOf: { some: { id: eventId } } }, { grants: { some: { eventId } } }]
      : []),
  ];
  if (ammesse.length === 0) return null;
  const foto = await db.eventPersonPhoto.findFirst({
    where: { id, OR: ammesse },
    select: { id: true },
  });
  return foto?.id ?? null;
}

/**
 * Cancella le foto che nessuno usa più, fra quelle indicate (`ids`) o fra
 * quelle caricate prima di `olderThan`. Una sola istruzione, con il controllo
 * dei riferimenti dentro: una foto condivisa con un altro evento resta.
 * Senza né `ids` né `olderThan` non cancella niente.
 */
export async function deleteUnreferencedPersonPhotos(
  db: Db,
  filtro: { ids?: string[]; olderThan?: Date }
): Promise<number> {
  const ids = filtro.ids?.filter((id): id is string => !!id);
  if (ids !== undefined && ids.length === 0) return 0;
  if (ids === undefined && !filtro.olderThan) return 0;
  const { count } = await db.eventPersonPhoto.deleteMany({
    where: {
      ...(ids && { id: { in: [...new Set(ids)] } }),
      ...(filtro.olderThan && { createdAt: { lt: filtro.olderThan } }),
      ...SENZA_RIFERIMENTI,
    },
  });
  return count;
}
