/**
 * La presentazione di un PDF nella sala, lato server.
 *
 * COSA. Chi conduce o un relatore sceglie un PDF fra i materiali dell'evento e
 * lo mostra a tutta la sala, una pagina alla volta, senza condividere lo
 * schermo nella chiamata. Lo stato è una riga per evento
 * (`event_presentations`): quale materiale, quale pagina, chi presenta e un
 * numero di versione che cresce a ogni cambio.
 *
 * DOVE VIVE. Nel database, come ogni stato della sala (ADR-005): chi entra a
 * metà presentazione, chi ricarica la pagina e un'altra replica dell'app
 * leggono la riga. Redis porta soltanto i cambi, come snapshot `presentation`
 * sul canale `live:<eventId>`: il puntatore (materiale, pagina, versione) è
 * uguale per tutti, e una pagina girata deve arrivare subito, non dopo una
 * rilettura frenata. Titolo, nome di chi presenta e file stanno dietro le
 * rotte che controllano chi sta nella stanza.
 *
 * CHI. Presentare, girare pagina e chiudere: il link moderatore principale e
 * le concessioni nominali non revocate dell'evento, sia MODERATOR sia SPEAKER
 * (`resolveGrantForEvent`). Leggere: chi sta nella stanza, con la regola dei
 * pannelli (lib/events/panel-read-access).
 *
 * COSA SI PRESENTA. Un PDF caricato fra i materiali dell'evento, con il file
 * nello storage: un link porta a un altro sito, che il browser della sala non
 * può leggere (CSP). Chi modera e i relatori scelgono nel pannello dei
 * materiali, ciascuno con l'elenco che vede; la rotta accetta qualunque PDF
 * dell'evento, perché un relatore deve poter presentare il PDF che ha appena
 * caricato anche in una prova prima dell'inizio, quando il pubblico vede solo
 * i materiali «prima dell'evento». Presentare un materiale lo mostra alla
 * sala per tutta la presentazione anche se la sua fase lo tiene fuori
 * dall'elenco: è ciò che farebbe una condivisione dello schermo. L'elenco non
 * cambia, e il file non riceve un indirizzo pubblico: si legge dalla rotta
 * della presentazione, solo finché è quello presentato e l'evento non è
 * concluso.
 */

import type { Prisma } from '@prisma/client';

import { tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { isMaterialFileKey } from '@/lib/events/material-files';
import { recordLiveAction, type LiveActor } from '@/lib/live/actions';
import { publishPresentation } from '@/lib/live-state/publish';
import { materialKind } from '@/lib/materials/file-kind';

import {
  presentationFileUrl,
  type PresentationPointer,
  type PresentationState,
  type PresenterRole,
} from './types';

/** Lo stato di chi non ha mai presentato nulla: nessun materiale, versione zero. */
export const NO_PRESENTATION: PresentationPointer = { materialId: null, page: 1, version: 0 };

/**
 * Un evento concluso non ha più una sala, e quindi nemmeno una presentazione:
 * non si avvia, non si gira pagina, e quella rimasta aperta non si mostra più
 * né si serve il suo file. La riga resta com'è (chiudere da ogni via con cui
 * un evento finisce — moderatore, scaler, cron — sarebbe una regola in tre
 * posti): decide la lettura.
 */
const STATI_CONCLUSI: ReadonlySet<string> = new Set(['ENDED', 'ARCHIVED']);

/** Vero finché l'evento ha una sala in cui presentare. */
export function isPresentationOpen(eventStatus: string): boolean {
  return !STATI_CONCLUSI.has(eventStatus);
}

/** Il puntatore come lo vede la sala: chiuso se l'evento è concluso, con la stessa versione. */
export function pointerForStatus(pointer: PresentationPointer, eventStatus: string): PresentationPointer {
  return isPresentationOpen(eventStatus) ? pointer : { materialId: null, page: 1, version: pointer.version };
}

/** Ciò che una lettura della riga porta con sé per costruire la risposta. */
export const PRESENTATION_ROW_SELECT = {
  materialId: true,
  page: true,
  pageCount: true,
  presenterRole: true,
  startedAt: true,
  version: true,
  material: { select: { title: true } },
  presenter: { select: { name: true } },
} as const satisfies Prisma.EventPresentationSelect;

export type PresentationRow = Prisma.EventPresentationGetPayload<{
  select: typeof PRESENTATION_ROW_SELECT;
}>;

/** I campi di un materiale che servono a dire se si può presentare. */
export const PRESENTABLE_MATERIAL_SELECT = {
  id: true,
  title: true,
  type: true,
  mimeType: true,
  fileName: true,
  url: true,
  blobPath: true,
} as const satisfies Prisma.EventMaterialSelect;

/**
 * Un materiale si presenta se è un PDF caricato con il suo file nello storage
 * dell'evento. Il genere lo decide il tipo verificato al caricamento, o
 * l'estensione per le righe che non lo portano (lib/materials/file-kind).
 */
export function isPresentableMaterial<
  T extends {
    type: string;
    mimeType: string | null;
    fileName: string | null;
    url: string;
    blobPath: string | null;
  },
>(m: T, eventId: string): m is T & { blobPath: string } {
  return (
    m.type === 'FILE' &&
    !!m.blobPath &&
    isMaterialFileKey(m.blobPath, eventId) &&
    materialKind(m) === 'pdf'
  );
}

/** Il puntatore di una riga: senza materiale la pagina non conta e vale 1. */
export function pointerOf(row: { materialId: string | null; page: number; version: number }): PresentationPointer {
  return row.materialId
    ? { materialId: row.materialId, page: row.page, version: row.version }
    : { materialId: null, page: 1, version: row.version };
}

/** Il puntatore corrente dell'evento, o quello vuoto se non ha mai presentato. */
export async function readPresentationPointer(eventId: string): Promise<PresentationPointer> {
  const row = await prisma.eventPresentation.findUnique({
    where: { eventId },
    select: { materialId: true, page: true, version: true },
  });
  return row ? pointerOf(row) : NO_PRESENTATION;
}

/** La riga completa dell'evento, per la risposta delle rotte. */
export function readPresentationRow(eventId: string): Promise<PresentationRow | null> {
  return prisma.eventPresentation.findUnique({
    where: { eventId },
    select: PRESENTATION_ROW_SELECT,
  });
}

function ruolo(valore: string | null): PresenterRole | null {
  return valore === 'MODERATOR' || valore === 'SPEAKER' ? valore : null;
}

/**
 * Il nome di chi presenta. Una concessione nominale porta il suo, cifrato a
 * riposo e decifrato qui, mai copiato nella riga della presentazione. Il link
 * principale non ha una persona dietro: vale il nome del conduttore scritto
 * sull'evento, già pubblico, come per l'autore dei materiali
 * (lib/events/material-author). Altrimenti null.
 */
function nomeDiChiPresenta(
  row: PresentationRow,
  event: { moderatorName: string | null },
): string | null {
  if (row.presenter) {
    try {
      const nome = (tryDecryptPII(row.presenter.name) ?? row.presenter.name).trim();
      return nome || null;
    } catch {
      // Chiave di cifratura sbagliata: meglio la dicitura tradotta che il
      // testo cifrato, e la presentazione non si ferma per un nome.
      return null;
    }
  }
  if (row.presenterRole === 'MODERATOR') return event.moderatorName?.trim() || null;
  return null;
}

/**
 * La risposta di GET .../presentation (e delle mutazioni) per una riga. Con
 * `status` concluso (vedi `isPresentationOpen`) nessuna presentazione.
 */
export function presentationStateOf(
  row: PresentationRow | null,
  event: { slug: string; moderatorName: string | null; status?: string },
): PresentationState {
  const aperta = event.status === undefined || isPresentationOpen(event.status);
  if (!aperta || !row?.materialId || !row.material) {
    return { version: row?.version ?? 0, presentation: null };
  }
  return {
    version: row.version,
    presentation: {
      materialId: row.materialId,
      page: row.page,
      pageCount: row.pageCount,
      title: row.material.title,
      presenterName: nomeDiChiPresenta(row, event),
      presenterRole: ruolo(row.presenterRole),
      startedAt: row.startedAt?.toISOString() ?? null,
      fileUrl: presentationFileUrl(event.slug, row.materialId),
    },
  };
}

/** I campi azzerati quando la presentazione si chiude. */
export const PRESENTATION_CLEARED = {
  materialId: null,
  page: 1,
  pageCount: null,
  presenterRole: null,
  presenterGrantId: null,
  startedAt: null,
} as const;

/** Il ruolo nella cronologia della sala (lib/live/actions): mai la persona. */
export function liveActorOf(role: string | null | undefined): LiveActor {
  return role === 'SPEAKER' ? 'speaker' : 'moderator';
}

/**
 * Chiude la presentazione se mostra `material`, che sta per essere tolto. Va
 * chiamata PRIMA di cancellare la riga del materiale: dopo, la chiave esterna
 * avrebbe già azzerato il materiale senza cambiare versione, e la sala non lo
 * saprebbe fino alla rilettura successiva. Non solleva: togliere un materiale
 * non deve fallire per la presentazione.
 */
export async function endPresentationOfMaterial(
  eventId: string,
  material: { id: string; title: string },
  actor: LiveActor,
): Promise<void> {
  try {
    const { count } = await prisma.eventPresentation.updateMany({
      where: { eventId, materialId: material.id },
      data: { ...PRESENTATION_CLEARED, version: { increment: 1 } },
    });
    if (count === 0) return;
    publishPresentation(eventId, await readPresentationPointer(eventId));
    void recordLiveAction({
      eventId,
      kind: 'presentation.stopped',
      actor,
      data: { materialId: material.id, title: material.title, reason: 'material.deleted' },
    });
  } catch (err) {
    console.error(
      '[presentation] chiusura per materiale tolto non riuscita',
      err instanceof Error ? err.message : err,
    );
  }
}
