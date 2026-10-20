/**
 * Le slide di una registrazione, lette dal database: per la pagina pubblica
 * dell'evento, per la rotta che serve il PDF accanto al video e per il
 * pannello dello staff. Il calcolo dei tratti sul tempo del video sta in
 * ./recording-slides, puro.
 *
 * QUALE REGISTRAZIONE. La pagina pubblica riproduce `Event.recordingUrl`. Le
 * slide si mettono accanto a quel video solo se è il file di una
 * registrazione della sala, riconosciuta dalla sua sessione
 * (`CallSession.recordingUrl`, lo stesso indirizzo che il webhook della
 * registrazione scrive sull'evento): è lei a dire lo zero dei tempi, la
 * durata e le scelte dello staff. Un evento registrato a più riprese ha più
 * registrazioni, ciascuna con il suo tratto di cronologia; un video caricato a
 * mano non ne ha nessuna, e senza uno zero le slide non si allineano.
 *
 * QUALI MATERIALI. Solo un PDF che c'è ancora fra i materiali dell'evento,
 * con il suo file (`isPresentableMaterial`), e visibile dopo l'evento con la
 * regola di sempre (lib/events/material-visibility): presentarlo in sala lo
 * mostrava a chi c'era, come una condivisione dello schermo, ma dopo
 * l'evento vale la scelta di chi l'ha caricato. Gli altri lasciano un vuoto
 * nel tempo del video. E solo se la pagina dell'evento mostra i materiali
 * (`postEventShowMaterials`): le slide sono materiali, e con la loro sezione
 * spenta non compaiono nemmeno accanto al video. Così la pagina mostra solo
 * documenti che già elenca; il file si legge comunque solo dalle rotte che
 * rifanno questo controllo, mai da un indirizzo pubblico nuovo.
 *
 * DATI. Dal registro si leggono tempi, id dei materiali, pagine e titoli: mai
 * chi presentava.
 */

import type { Prisma } from '@prisma/client';

import { getCached, setCache } from '@/lib/cache';
import { registrazioneConVideo } from '@/lib/captions/transcript';
import { prisma } from '@/lib/db';
import { isUuid } from '@/lib/events/event-param';
import { isMaterialVisibleInPhase } from '@/lib/events/material-visibility';

import {
  SLIDE_ACTION_KINDS,
  buildSlideCues,
  marksFromActions,
  videoSegmentFromJournal,
  titlesFromActions,
  withAvailableMaterials,
  type PresentationMark,
  type RecordingSlidesView,
  type SlideCue,
} from './recording-slides';
import { PRESENTABLE_MATERIAL_SELECT, isPresentableMaterial } from './state';

/** I campi di una registrazione che servono alle slide. */
export const RECORDING_SLIDES_SELECT = {
  id: true,
  eventId: true,
  blobKey: true,
  createdAt: true,
  durationSec: true,
  slidesEnabled: true,
  slidesOffsetSec: true,
  // La fine della sessione è l'arrivo del file: l'ancora dello zero e della
  // fine del video.
  callSession: { select: { endedAt: true } },
} as const satisfies Prisma.RecordingSelect;

export type RecordingForSlides = Prisma.RecordingGetPayload<{
  select: typeof RECORDING_SLIDES_SELECT;
}>;

/** Quanto restano in memoria i dati delle slide per la pagina pubblica. */
const DATI_PUBBLICI_TTL_MS = 30_000;

/** Azioni lette al massimo: ben oltre le pagine girate in un evento vero, solo un tetto. */
const MAX_AZIONI = 20_000;

/** Perché le slide di un materiale non si mostrano. */
export type SlideMaterialProblem = 'deleted' | 'notPdf' | 'notVisibleAfter';

export interface SlideMaterial {
  id: string;
  /** Il titolo di adesso o, per un materiale tolto, quello scritto nel registro. */
  title: string;
  /** Il nome del file, per lo scaricamento; null se non si conosce. */
  fileName: string | null;
  problem: SlideMaterialProblem | null;
  /**
   * La chiave del file, per le rotte che lo servono; solo per un materiale
   * che si può mostrare. Non esce mai dal server.
   */
  blobPath: string | null;
}

export interface RecordingSlidesData {
  /** I fatti della presentazione sullo zero del video. */
  marks: PresentationMark[];
  /** Lo zero è l'avvio della registrazione riferito dalla sala; falso se stimato. */
  exactZero: boolean;
  /**
   * La durata del video in secondi: quella della registrazione o, senza,
   * fino all'arrivo del file; null se non si sa. I fatti da qui in poi non
   * sono nel video.
   */
  durationSec: number | null;
  /** I materiali presentati, nell'ordine in cui sono comparsi. */
  materials: SlideMaterial[];
}

/** La registrazione del video che la pagina pubblica dell'evento riproduce, se è della sala. */
export function recordingOfEventVideo(
  eventId: string,
  recordingUrl: string
): Promise<RecordingForSlides | null> {
  return prisma.recording.findFirst({
    where: { eventId, callSession: { recordingUrl } },
    orderBy: { createdAt: 'desc' },
    select: RECORDING_SLIDES_SELECT,
  });
}

/** Quanto indietro dall'arrivo del file si leggono avvii e fermate. */
const CRONOLOGIA_REGISTRAZIONE_MS = 24 * 3600_000;

/** Avvii e fermate letti al massimo: ben oltre una giornata vera. */
const MAX_AVVII = 500;

/**
 * Lo zero e la durata del video della registrazione (`videoSegmentFromJournal`).
 *
 * Il file di una registrazione della sala è il video composito di Jibri, che
 * arriva con il webhook alla fine della sessione (`CallSession.endedAt`; per
 * una riga nata con il file, la sua creazione). Il suo inizio è l'avvio della
 * registrazione riferito dalla sala (`recording.started`).
 *
 * Per una registrazione composita è lo zero della pipeline
 * (`recordingTimeZero`, lib/postprod/live-timeline). Non per una
 * registrazione multitraccia: il suo zero è l'inizio delle tracce, che il
 * registratore avvia quando la sala va in diretta, prima che chi modera
 * avvii il video.
 */
async function tempiDelVideo(
  r: RecordingForSlides
): Promise<{ t0: Date; exact: boolean; durationSec: number | null }> {
  const arrivo = r.callSession?.endedAt ?? r.createdAt;
  const durataMs = r.durationSec && r.durationSec > 0 ? r.durationSec * 1000 : 0;
  const righe = await prisma.liveAction.findMany({
    where: {
      eventId: r.eventId,
      kind: { in: ['recording.started', 'recording.stopped'] },
      at: {
        gte: new Date(arrivo.getTime() - durataMs - CRONOLOGIA_REGISTRAZIONE_MS),
        lte: arrivo,
      },
    },
    orderBy: { at: 'asc' },
    take: MAX_AVVII,
    select: { at: true, kind: true },
  });
  return videoSegmentFromJournal({
    avvii: righe.filter((x) => x.kind === 'recording.started').map((x) => x.at),
    fermate: righe.filter((x) => x.kind === 'recording.stopped').map((x) => x.at),
    arrivo,
    durationSec: r.durationSec,
  });
}

/** I fatti della presentazione e i materiali presentati di una registrazione. */
export async function readRecordingSlides(
  recording: RecordingForSlides
): Promise<RecordingSlidesData> {
  const [tempi, azioni] = await Promise.all([
    tempiDelVideo(recording),
    prisma.liveAction.findMany({
      where: { eventId: recording.eventId, kind: { in: [...SLIDE_ACTION_KINDS] } },
      orderBy: { at: 'asc' },
      take: MAX_AZIONI,
      select: { at: true, kind: true, data: true },
    }),
  ]);
  const marks = marksFromActions(azioni, tempi.t0);
  const titoli = titlesFromActions(azioni);

  // Gli id nell'ordine in cui compaiono; un valore che non è un UUID non
  // arriva al database (la colonna lo rifiuterebbe con un errore).
  const ids = [
    ...new Set(
      marks
        .filter((m) => m.kind === 'started' || m.kind === 'page')
        .map((m) => m.materialId!)
        .filter(isUuid)
    ),
  ];
  const righe =
    ids.length === 0
      ? []
      : await prisma.eventMaterial.findMany({
          where: { eventId: recording.eventId, id: { in: ids } },
          select: { ...PRESENTABLE_MATERIAL_SELECT, visibility: true },
        });
  const perId = new Map(righe.map((r) => [r.id, r]));

  const materials = ids.map((id): SlideMaterial => {
    const m = perId.get(id);
    if (!m) {
      return {
        id,
        title: titoli.get(id) ?? '',
        fileName: null,
        problem: 'deleted',
        blobPath: null,
      };
    }
    if (!isPresentableMaterial(m, recording.eventId)) {
      return {
        id,
        title: m.title,
        fileName: m.fileName,
        problem: 'notPdf',
        blobPath: null,
      };
    }
    if (!isMaterialVisibleInPhase(m.visibility, 'AFTER')) {
      return {
        id,
        title: m.title,
        fileName: m.fileName,
        problem: 'notVisibleAfter',
        blobPath: null,
      };
    }
    return {
      id,
      title: m.title,
      fileName: m.fileName,
      problem: null,
      blobPath: m.blobPath,
    };
  });

  return {
    marks,
    exactZero: tempi.exact,
    durationSec: tempi.durationSec,
    materials,
  };
}

/** I tratti del video con lo scarto dato, dei soli materiali che si possono mostrare. */
export function cuesOf(data: RecordingSlidesData, offsetSec: number): SlideCue[] {
  const mostrabili = new Set(
    data.materials.filter((m) => m.problem === null).map((m) => m.id)
  );
  return withAvailableMaterials(
    buildSlideCues(data.marks, { offsetSec, durationSec: data.durationSec }),
    (id) => mostrabili.has(id)
  );
}

/** Dove la pagina pubblica legge il PDF di una slide: la rotta che rifà i controlli. */
export function recordingSlidesFileUrl(eventSlug: string, materialId: string): string {
  return `/api/events/${encodeURIComponent(eventSlug)}/recording/slides?m=${encodeURIComponent(materialId)}`;
}

/** I campi dell'evento che servono a `publicRecordingSlides`. */
export interface PublicSlidesEvent {
  id: string;
  slug: string;
  status: string;
  recordingUrl: string | null;
  recordingPublished: boolean;
  postEventShowMaterials: boolean;
}

/** Il nome del file da proporre allo scaricamento: quello caricato, o il titolo. */
function nomeDelFile(m: SlideMaterial): string {
  const nome = m.fileName?.trim() || m.title.trim() || 'slide';
  return /\.pdf$/i.test(nome) ? nome : `${nome}.pdf`;
}

/**
 * La pagina pubblica può avere slide accanto al video: evento concluso, video
 * pubblicato, materiali mostrati. Controlli senza database.
 */
function puoAvereSlide(
  event: PublicSlidesEvent
): event is PublicSlidesEvent & { recordingUrl: string } {
  // Le slide sono materiali: con la sezione dei materiali spenta non compaiono.
  return (
    event.status === 'ENDED' &&
    event.recordingPublished &&
    !!event.recordingUrl &&
    event.postEventShowMaterials
  );
}

/** Le slide pubbliche e, per materiale, la chiave del suo file. */
async function slidePubbliche(
  event: PublicSlidesEvent
): Promise<{ view: RecordingSlidesView; chiavi: Map<string, string> } | null> {
  if (!puoAvereSlide(event)) return null;
  const recording = await recordingOfEventVideo(event.id, event.recordingUrl);
  if (!recording || !recording.slidesEnabled || !registrazioneConVideo(recording))
    return null;

  // Una pagina vista spesso non rilegge la cronologia a ogni visita e a ogni
  // PDF: i dati restano qualche secondo, le scelte dello staff no (si leggono
  // dalla registrazione qui sopra).
  const chiaveCache = `recording-slides:${recording.id}`;
  let data = getCached<RecordingSlidesData>(chiaveCache);
  if (!data) {
    data = await readRecordingSlides(recording);
    setCache(chiaveCache, data, DATI_PUBBLICI_TTL_MS);
  }
  const cues = cuesOf(data, recording.slidesOffsetSec);
  if (cues.length === 0) return null;

  const usati = new Set(cues.map((c) => c.materialId));
  const mostrati = data.materials.filter(
    (m): m is SlideMaterial & { blobPath: string } =>
      m.problem === null && !!m.blobPath && usati.has(m.id)
  );
  return {
    view: {
      cues,
      materials: mostrati.map((m) => ({
        id: m.id,
        title: m.title,
        fileUrl: recordingSlidesFileUrl(event.slug, m.id),
        downloadName: nomeDelFile(m),
      })),
    },
    chiavi: new Map(mostrati.map((m) => [m.id, m.blobPath])),
  };
}

/**
 * Le slide da mostrare accanto al video pubblicato dell'evento concluso, o
 * null: video non pubblicato o non della sala, materiali spenti sulla
 * pagina, slide spente dallo staff, nessuna presentazione nel tempo del
 * video, o nessun materiale presentato che si possa ancora mostrare.
 *
 * Chi la chiama ha già deciso che la pagina post-evento è pubblica.
 */
export async function publicRecordingSlides(
  event: PublicSlidesEvent
): Promise<RecordingSlidesView | null> {
  return (await slidePubbliche(event))?.view ?? null;
}

/**
 * La chiave del file di `materialId` se è una delle slide che la pagina
 * pubblica mostra accanto al video, con le stesse regole di
 * `publicRecordingSlides`; altrimenti null.
 */
export async function publicSlideFileKey(
  event: PublicSlidesEvent,
  materialId: string
): Promise<string | null> {
  if (!puoAvereSlide(event) || !isUuid(materialId)) return null;
  // Prima i controlli che costano poco: un id qualunque non fa leggere la
  // cronologia della sala. Il materiale c'è, si può mostrare dopo l'evento ed
  // è stato presentato almeno una volta.
  const [materiale, presentato] = await Promise.all([
    prisma.eventMaterial.findFirst({
      where: { id: materialId, eventId: event.id },
      select: { ...PRESENTABLE_MATERIAL_SELECT, visibility: true },
    }),
    prisma.liveAction.findFirst({
      where: {
        eventId: event.id,
        kind: { in: ['presentation.started', 'presentation.page'] },
        data: { path: ['materialId'], equals: materialId },
      },
      select: { id: true },
    }),
  ]);
  if (
    !materiale ||
    !presentato ||
    !isPresentableMaterial(materiale, event.id) ||
    !isMaterialVisibleInPhase(materiale.visibility, 'AFTER')
  ) {
    return null;
  }
  // Poi le stesse regole della pagina: presentato durante il video, con le
  // slide accese.
  return (await slidePubbliche(event))?.chiavi.get(materialId) ?? null;
}
