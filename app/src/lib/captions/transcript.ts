/**
 * La trascrizione dell'evento costruita dai sottotitoli live
 * (Event.captionsTranscriptEnabled).
 *
 * Le frasi salvate durante la diretta (CaptionSegment, solo di chi ha dato il
 * consenso) diventano un artefatto TRANSCRIPT_JSON nella stessa forma di
 * quello della trascrizione AI: l'editor, i download, la pagina dopo
 * l'evento e la sintesi lo usano senza distinguerlo. Sta sulla registrazione
 * della sessione se c'e' (allineato al video), altrimenti su una
 * registrazione «solo sottotitoli», senza media.
 *
 * Non sostituisce mai una trascrizione AI (piu' accurata) ne' una
 * trascrizione corretta a mano: una trascrizione AI successiva, invece, la
 * sostituisce.
 */
import { createHash } from 'node:crypto';

import type { Prisma, RecordingStatus } from '@prisma/client';

import { prisma } from '@/lib/db';
import { encryptPII, tryDecryptPII } from '@/lib/crypto/pii';
import { iscrizioneDelPosto } from '@/lib/captions/room';
import { recordingTimeZero } from '@/lib/postprod/live-timeline';
import { isMultitrackPlaceholder } from '@/lib/recorder/lifecycle';

/** Il modello che firma l'artefatto: dice da dove viene la trascrizione. */
export const CAPTIONS_TRANSCRIPT_MODEL = 'live-captions';

/**
 * La registrazione «solo sottotitoli» non ha un file: niente da riprodurre ne'
 * da dare alla pipeline AI, che fallirebbe al download dell'ingresso.
 */
export function registrazioneSoloSottotitoli(recording: { blobKey: string }): boolean {
  return recording.blobKey === '';
}

/**
 * La registrazione ha un media a cui allineare la trascrizione: un file, o le
 * tracce multitraccia arrivate (il segnaposto nasce in diretta, il suo inizio
 * si conosce solo con il manifesto).
 */
export function registrazioneConMedia(recording: { blobKey: string; mediaStartedAt: Date | null }): boolean {
  if (registrazioneSoloSottotitoli(recording)) return false;
  return !isMultitrackPlaceholder(recording.blobKey) || recording.mediaStartedAt !== null;
}

export interface SegmentoTrascrizione {
  start: number;
  end: number;
  text: string;
  speaker: string;
}

export interface ParlanteTrascrizione {
  diarLabel: string;
  displayName: string | null;
  totalSpeechSec: number;
  /**
   * L'iscrizione di chi parla, quando e' entrato con il link di iscrizione:
   * serve a togliere le sue frasi se chiede la cancellazione
   * (togliPersoneDalleTrascrizioni). Sta nel corpo cifrato, mai fuori.
   */
  registrationId?: string;
}

export interface TrascrizioneSottotitoli {
  source: 'live-captions';
  language: string | null;
  segments: SegmentoTrascrizione[];
  speakers: ParlanteTrascrizione[];
}

interface FraseSalvata {
  seatId: string | null;
  speakerName: string | null;
  text: string | null;
  language: string | null;
  startedAt: Date;
  endedAt: Date;
}

/**
 * Dalle frasi alla trascrizione, con i tempi in secondi dall'inizio `t0`
 * (l'inizio del video, se c'e'). Pura: si prova senza database.
 */
/**
 * Chi parla. Il posto cambia a ogni ingresso: chi si ricollega non deve
 * diventare un secondo parlante. Un'iscrizione e' la stessa persona a ogni
 * ingresso; per gli altri posti (link di moderazione condiviso, ospiti) vale
 * il nome con cui la persona e' entrata, quando c'e'.
 */
function chiParla(seatId: string, nome: string | null): string {
  const iscrizione = iscrizioneDelPosto(seatId);
  if (iscrizione) return `reg:${iscrizione}`;
  return nome ? `nome:${nome.trim().toLowerCase()}` : `posto:${seatId}`;
}

/** Quante persone hanno parlato, con lo stesso criterio della trascrizione. */
export function contaVoci(frasi: ReadonlyArray<{ seatId: string | null; speakerName: string | null }>): number {
  const persone = new Set<string>();
  for (const f of frasi) {
    if (!f.seatId) continue;
    persone.add(chiParla(f.seatId, f.speakerName ? (tryDecryptPII(f.speakerName) ?? null) : null));
  }
  return persone.size;
}

export function componiTrascrizione(frasi: readonly FraseSalvata[], t0: Date): TrascrizioneSottotitoli {
  const etichette = new Map<string, string>();
  const parlanti = new Map<
    string,
    { displayName: string | null; totalSpeechSec: number; registrationId?: string }
  >();
  const segments: SegmentoTrascrizione[] = [];
  const lingue = new Map<string, number>();
  for (const f of frasi) {
    if (!f.text || !f.seatId) continue;
    const testo = tryDecryptPII(f.text)?.trim();
    if (!testo) continue;
    const start = Math.max(0, (f.startedAt.getTime() - t0.getTime()) / 1000);
    const end = Math.max(start, (f.endedAt.getTime() - t0.getTime()) / 1000);
    const nome = f.speakerName ? (tryDecryptPII(f.speakerName) ?? null) : null;
    const persona = chiParla(f.seatId, nome);
    let etichetta = etichette.get(persona);
    if (!etichetta) {
      etichetta = `SPEAKER_${String(etichette.size).padStart(2, '0')}`;
      etichette.set(persona, etichetta);
      const registrationId = iscrizioneDelPosto(f.seatId);
      parlanti.set(etichetta, {
        displayName: nome,
        totalSpeechSec: 0,
        ...(registrationId ? { registrationId } : {}),
      });
    }
    const p = parlanti.get(etichetta);
    if (p) p.totalSpeechSec += end - start;
    if (f.language) lingue.set(f.language, (lingue.get(f.language) ?? 0) + 1);
    segments.push({ start: round(start), end: round(end), text: testo, speaker: etichetta });
  }
  const language = [...lingue.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return {
    source: 'live-captions',
    language,
    segments,
    speakers: [...parlanti.entries()].map(([diarLabel, p]) => ({
      diarLabel,
      displayName: p.displayName,
      totalSpeechSec: Math.round(p.totalSpeechSec),
      ...(p.registrationId ? { registrationId: p.registrationId } : {}),
    })),
  };
}

const round = (n: number) => Math.round(n * 100) / 100;

export type EsitoTrascrizione =
  | { stato: 'scritta'; recordingId: string; segmenti: number; nuovaRegistrazione: boolean }
  | { stato: 'nessuna-frase' }
  /** Passata la conservazione dei dati dell'evento: non si ricostruisce. */
  | { stato: 'scaduta' }
  /** La pipeline AI sta trascrivendo il video: si aspetta la sua trascrizione. */
  | { stato: 'ai-in-corso' }
  | { stato: 'gia-trascritta'; recordingId: string };

/** I lavori della pipeline che scrivono una trascrizione AI su una registrazione. */
const TRASCRIZIONE_AI_IN_CORSO = {
  kind: { in: ['TRANSCRIBE', 'TRANSCRIBE_MULTITRACK'] },
  status: { in: ['PENDING', 'CLAIMED', 'RUNNING'] },
  NOT: { idempotencyKey: { startsWith: 'captions-transcript:' } },
} satisfies Prisma.PostprodJobWhereInput;

/**
 * Lo zero dei tempi della registrazione con il video, come lo calcola la
 * pipeline (lib/postprod/live-timeline): l'inizio del media, o l'avvio
 * riferito dalla sala, o la creazione meno la durata.
 */
async function zeroDelVideo(tx: Prisma.TransactionClient, r: {
  id: string;
  eventId: string;
  blobKey: string;
  mediaStartedAt: Date | null;
  createdAt: Date;
  durationSec: number | null;
}): Promise<Date> {
  const multitrack =
    isMultitrackPlaceholder(r.blobKey) ||
    (await tx.recordingTrack.count({ where: { recordingId: r.id } })) > 0;
  const durataMs = (r.durationSec ?? 0) * 1000;
  const avviata =
    multitrack || r.mediaStartedAt || durataMs <= 0
      ? null
      : await tx.liveAction.findFirst({
          where: {
            eventId: r.eventId,
            kind: 'recording.started',
            at: {
              gte: new Date(r.createdAt.getTime() - durataMs - 30 * 60_000),
              lte: new Date(r.createdAt.getTime() - durataMs + 2 * 60_000),
            },
          },
          orderBy: { at: 'desc' },
          select: { at: true },
        });
  return recordingTimeZero({
    mediaStartedAt: r.mediaStartedAt,
    createdAt: r.createdAt,
    durationSec: r.durationSec,
    multitrack,
    journaledStart: avviata?.at ?? null,
  }).t0;
}

/**
 * La pipeline AI scriverebbe sopra la trascrizione dai sottotitoli di questa
 * registrazione: se qualcuno l'ha corretta a mano, le correzioni andrebbero
 * perse. Chi avvia la pipeline lo sa prima (rerun, generate-ai).
 */
export async function trascrizioneCorrettaDaiSottotitoli(
  db: Prisma.TransactionClient | typeof prisma,
  recordingId: string,
): Promise<boolean> {
  const a = await db.postprodArtifact.findFirst({
    where: {
      recordingId,
      type: 'TRANSCRIPT_JSON',
      language: null,
      modelId: CAPTIONS_TRANSCRIPT_MODEL,
      revisedAt: { not: null },
    },
    select: { id: true },
  });
  return a !== null;
}

/**
 * Una trascrizione AI o corretta a mano su qualunque registrazione
 * dell'evento: non si tocca e non se ne fa un'altra accanto.
 */
async function trascrizioneIntoccabile(
  db: Prisma.TransactionClient | typeof prisma,
  eventId: string,
): Promise<string | null> {
  const a = await db.postprodArtifact.findFirst({
    where: {
      type: 'TRANSCRIPT_JSON',
      language: null,
      recording: { eventId },
      OR: [{ modelId: { not: CAPTIONS_TRANSCRIPT_MODEL } }, { modelId: null }, { revisedAt: { not: null } }],
    },
    select: { recordingId: true },
  });
  return a?.recordingId ?? null;
}

/**
 * Costruisce (o ricostruisce) la trascrizione dai sottotitoli di un evento.
 * Idempotente: rifatta, sostituisce la propria versione precedente.
 *
 * Sta sulla registrazione con il video, se c'e' e la pipeline AI non la sta
 * trascrivendo (allineata al video), altrimenti su quella «solo
 * sottotitoli». Quando il video arriva dopo, la trascrizione si sposta e la
 * registrazione senza file se ne va. Le costruzioni dello stesso evento (il
 * giro periodico, il pulsante dello staff, la trascrizione AI che arriva) si
 * mettono in fila su un lock per evento.
 */
export async function costruisciTrascrizioneDaiSottotitoli(eventId: string): Promise<EsitoTrascrizione> {
  // Dopo la conservazione la pulizia toglie la trascrizione: ricostruirla
  // dalle frasi rimaste fino al giro successivo la riporterebbe in vita.
  const evento = await prisma.event.findUnique({
    where: { id: eventId },
    select: { endsAt: true, dataRetentionDays: true },
  });
  if (!evento || conservazioneFinita(evento, new Date())) return { stato: 'scaduta' };

  return prisma.$transaction(async (tx): Promise<EsitoTrascrizione> => {
    await bloccaTrascrizioneEvento(tx, eventId);
    const intoccabile = await trascrizioneIntoccabile(tx, eventId);
    if (intoccabile) return { stato: 'gia-trascritta', recordingId: intoccabile };

    // Le frasi si leggono dentro il lock: una cancellazione su richiesta
    // (lib/gdpr/erase-registrations) che lo prende non si vede annullata da
    // una costruzione partita prima.
    const frasi = await tx.captionSegment.findMany({
      where: { eventId, text: { not: null }, seatId: { not: null } },
      orderBy: { startedAt: 'asc' },
      select: { seatId: true, speakerName: true, text: true, language: true, startedAt: true, endedAt: true },
    });
    if (frasi.length === 0) return { stato: 'nessuna-frase' };
    const primo = frasi[0]!.startedAt;
    const ultimo = new Date(Math.max(...frasi.map((f) => f.endedAt.getTime())));

    const registrazioni = await tx.recording.findMany({
      where: { eventId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        eventId: true,
        blobKey: true,
        mediaStartedAt: true,
        createdAt: true,
        durationSec: true,
        sourceLanguage: true,
        jobs: { where: TRASCRIZIONE_AI_IN_CORSO, select: { id: true }, take: 1 },
        artifacts: {
          where: { type: 'TRANSCRIPT_JSON', language: null },
          select: { id: true },
        },
      },
    });
    // Mentre la pipeline AI trascrive il video si aspetta lei: una trascrizione
    // dai sottotitoli accanto la oscurerebbe. Se non va a buon fine, il giro
    // successivo costruisce questa.
    if (registrazioni.some((r) => r.jobs.length > 0)) return { stato: 'ai-in-corso' };
    const conVideo = registrazioni.find((r) => registrazioneConMedia(r));
    const esistente = conVideo ?? registrazioni.find((r) => registrazioneSoloSottotitoli(r));
    const superate = registrazioni
      .filter((r) => registrazioneSoloSottotitoli(r) && r.id !== esistente?.id)
      .map((r) => r.id);
    const artefatto = esistente?.artifacts[0];

    const t0 = conVideo && esistente === conVideo ? await zeroDelVideo(tx, conVideo) : primo;
    const trascrizione = componiTrascrizione(frasi, t0);
    if (trascrizione.segments.length === 0) return { stato: 'nessuna-frase' };
    const corpo = JSON.stringify(trascrizione);
    const contentHash = createHash('sha256').update(corpo).digest('hex');

    if (superate.length > 0) {
      await tx.recording.deleteMany({ where: { id: { in: superate } } });
    }
    let recordingId = esistente?.id;
    let nuovaRegistrazione = false;
    if (!recordingId) {
      // La sessione della diretta: quella senza registrazione piu' recente, o
      // una nuova che copre le frasi (una diretta senza ingresso registrato).
      const sessione =
        (await tx.callSession.findFirst({
          where: { eventId, recording: null },
          orderBy: { startedAt: 'desc' },
          select: { id: true },
        })) ??
        (await tx.callSession.create({
          data: {
            eventId,
            jitsiRoomName: (await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { jitsiRoomName: true } }))
              .jitsiRoomName,
            startedAt: primo,
            endedAt: ultimo,
          },
          select: { id: true },
        }));
      const creata = await tx.recording.create({
        data: {
          eventId,
          callSessionId: sessione.id,
          // Nessun file: la trascrizione e' l'unico contenuto.
          blobKey: '',
          status: 'POSTPROD_DONE',
          sourceLanguage: trascrizione.language,
          durationSec: Math.round((ultimo.getTime() - primo.getTime()) / 1000),
          mediaStartedAt: primo,
          pipelineSnapshot: { source: 'live-captions' } as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      recordingId = creata.id;
      nuovaRegistrazione = true;
    } else if (esistente && !esistente.sourceLanguage && trascrizione.language) {
      // La lingua della registrazione con il video la scrive la pipeline AI:
      // senza, la si prende dalla trascrizione (download e pagina pubblica).
      await tx.recording.update({
        where: { id: recordingId },
        data: { sourceLanguage: trascrizione.language },
      });
    }

    const lavoro = await tx.postprodJob.upsert({
      where: { idempotencyKey: `captions-transcript:${recordingId}` },
      create: {
        recordingId,
        kind: 'TRANSCRIBE',
        status: 'DONE',
        payload: { source: 'live-captions' },
        idempotencyKey: `captions-transcript:${recordingId}`,
        completedAt: new Date(),
      },
      update: { completedAt: new Date() },
      select: { id: true },
    });

    const dati = {
      jobId: lavoro.id,
      blobKey: '',
      sizeBytes: BigInt(Buffer.byteLength(corpo)),
      mimeType: 'application/json',
      inlineBody: encryptPII(corpo),
      contentHash,
      modelId: CAPTIONS_TRANSCRIPT_MODEL,
      modelVersion: null,
    };
    if (artefatto) {
      await tx.postprodArtifact.update({ where: { id: artefatto.id }, data: dati });
    } else {
      await tx.postprodArtifact.create({
        data: { ...dati, recordingId, type: 'TRANSCRIPT_JSON', language: null },
      });
    }

    // I nomi delle voci, come li ha dati chi ha acconsentito.
    await tx.speaker.deleteMany({ where: { recordingId } });
    if (trascrizione.speakers.length > 0) {
      await tx.speaker.createMany({
        data: trascrizione.speakers.map((s) => ({
          recordingId: recordingId as string,
          diarLabel: s.diarLabel,
          displayName: s.displayName,
          totalSpeechSec: s.totalSpeechSec,
        })),
      });
    }

    return {
      stato: 'scritta',
      recordingId,
      segmenti: trascrizione.segments.length,
      nuovaRegistrazione,
    };
  });
}

/**
 * La registrazione da mostrare nella pagina pubblica dopo l'evento: quella
 * con la trascrizione AI, se c'e'; altrimenti quella con la trascrizione dai
 * sottotitoli (che non passa dalla pipeline e lascia lo stato com'e');
 * altrimenti l'ultima con la post-produzione conclusa. Con la pipeline AI
 * spenta, solo quella dai sottotitoli.
 */
export async function registrazionePubblica(
  eventId: string,
  soloSottotitoli: boolean,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<string | null> {
  const fatta = { status: { in: ['POSTPROD_DONE', 'POSTPROD_PARTIAL'] as RecordingStatus[] } };
  if (!soloSottotitoli) {
    const ai = await db.recording.findFirst({
      where: {
        eventId,
        ...fatta,
        artifacts: {
          some: {
            type: 'TRANSCRIPT_JSON',
            OR: [{ modelId: null }, { modelId: { not: CAPTIONS_TRANSCRIPT_MODEL } }],
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (ai) return ai.id;
  }
  const dai = await db.recording.findFirst({
    where: { eventId, artifacts: { some: { type: 'TRANSCRIPT_JSON', modelId: CAPTIONS_TRANSCRIPT_MODEL } } },
    // A pari, quella con il video (blobKey non vuota) prima.
    orderBy: [{ blobKey: 'desc' }, { createdAt: 'desc' }],
    select: { id: true },
  });
  if (dai || soloSottotitoli) return dai?.id ?? null;
  const conclusa = await db.recording.findFirst({
    where: { eventId, ...fatta },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  return conclusa?.id ?? null;
}

/**
 * Mette in fila, fino alla fine della transazione, chi scrive la trascrizione
 * di un evento: la costruzione dai sottotitoli e la trascrizione AI che
 * arriva (internal/postprod-artifact).
 */
export async function bloccaTrascrizioneEvento(tx: Prisma.TransactionClient, eventId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`captions-transcript:${eventId}`}))`;
}

/** Se la conservazione dei dati dell'evento e' finita (fine + giorni di conservazione). */
export function conservazioneFinita(e: { endsAt: Date; dataRetentionDays: number }, adesso: Date): boolean {
  return e.endsAt.getTime() + e.dataRetentionDays * 86_400_000 < adesso.getTime();
}

/** Quanto aspettare l'ultima frase prima di costruire: il servizio dei sottotitoli manda a gruppi. */
export const ATTESA_ULTIMA_FRASE_MS = 2 * 60_000;

export interface StatoTrascrizione {
  /** Quando e' arrivata (salvata) l'ultima frase. */
  ultimaFrase: Date;
  /** La trascrizione dai sottotitoli costruita: quando, se corretta, se su una registrazione senza file. */
  costruita: { il: Date | null; corretta: boolean; soloSottotitoli: boolean } | null;
  /** C'e' una trascrizione fatta dall'AI, o la pipeline la sta facendo. */
  ai: boolean;
  /** C'e' una registrazione con il video. */
  video: boolean;
}

/**
 * Se il giro periodico deve (ri)costruire la trascrizione: dopo che le frasi
 * hanno smesso di arrivare, quando manca, quando sono arrivate frasi dopo
 * l'ultima costruzione, o quando e' arrivato il video e la trascrizione sta
 * ancora sulla registrazione senza file. Mai sopra una trascrizione AI o una
 * corretta a mano.
 */
export function vaCostruita(s: StatoTrascrizione, adesso: Date): boolean {
  if (adesso.getTime() - s.ultimaFrase.getTime() < ATTESA_ULTIMA_FRASE_MS) return false;
  if (s.ai) return false;
  if (!s.costruita) return true;
  if (s.costruita.corretta) return false;
  if (s.costruita.soloSottotitoli && s.video) return true;
  return !s.costruita.il || s.ultimaFrase > s.costruita.il;
}

/**
 * Gli eventi conclusi da poco che tengono la trascrizione dai sottotitoli: la
 * costruisce, e la tiene aggiornata, il giro periodico (cron dei promemoria).
 */
export async function costruisciTrascrizioniMancanti(now: Date, giorni = 7): Promise<number> {
  const eventi = await prisma.event.findMany({
    where: {
      status: 'ENDED',
      captionsTranscriptEnabled: true,
      endsAt: { gte: new Date(now.getTime() - giorni * 86_400_000) },
      captionSegments: { some: { text: { not: null } } },
    },
    select: {
      id: true,
      endsAt: true,
      dataRetentionDays: true,
      recordings: {
        select: {
          blobKey: true,
          mediaStartedAt: true,
          jobs: { where: TRASCRIZIONE_AI_IN_CORSO, select: { id: true }, take: 1 },
          artifacts: {
            where: { type: 'TRANSCRIPT_JSON', language: null },
            select: { modelId: true, revisedAt: true, job: { select: { completedAt: true } } },
          },
        },
      },
    },
    orderBy: { endsAt: 'desc' },
    take: 50,
  });
  let fatte = 0;
  for (const e of eventi) {
    if (conservazioneFinita(e, now)) continue;
    try {
      const ultima = await prisma.captionSegment.findFirst({
        where: { eventId: e.id, text: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      if (!ultima) continue;
      const trascrizioni = e.recordings.flatMap((r) =>
        r.artifacts.map((a) => ({ ...a, soloSottotitoli: registrazioneSoloSottotitoli(r) })),
      );
      const dai = trascrizioni.find((a) => a.modelId === CAPTIONS_TRANSCRIPT_MODEL);
      const stato: StatoTrascrizione = {
        ultimaFrase: ultima.createdAt,
        ai:
          trascrizioni.some((a) => a.modelId !== CAPTIONS_TRANSCRIPT_MODEL) ||
          e.recordings.some((r) => r.jobs.length > 0),
        video: e.recordings.some((r) => registrazioneConMedia(r)),
        costruita: dai
          ? { il: dai.job.completedAt, corretta: dai.revisedAt !== null, soloSottotitoli: dai.soloSottotitoli }
          : null,
      };
      if (!vaCostruita(stato, now)) continue;
      const esito = await costruisciTrascrizioneDaiSottotitoli(e.id);
      if (esito.stato === 'scritta') fatte += 1;
    } catch (err) {
      console.error('[captions] trascrizione dai sottotitoli non costruita', {
        eventId: e.id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return fatte;
}

interface CorpoTrascrizione {
  segments?: Array<{ speaker?: string | null; [k: string]: unknown }>;
  speakers?: Array<{ diarLabel?: string; registrationId?: string; [k: string]: unknown }>;
  [k: string]: unknown;
}

/** Il corpo senza le frasi e i parlanti di quelle iscrizioni; null se non le contiene. */
export function senzaLePersone(
  corpo: string,
  registrationIds: ReadonlySet<string>,
): { corpo: string; etichette: string[]; vuoto: boolean } | null {
  let t: CorpoTrascrizione;
  try {
    t = JSON.parse(corpo) as CorpoTrascrizione;
  } catch {
    return null;
  }
  const etichette = (t.speakers ?? [])
    .filter((s) => s.registrationId && registrationIds.has(s.registrationId) && s.diarLabel)
    .map((s) => s.diarLabel as string);
  if (etichette.length === 0) return null;
  const via = new Set(etichette);
  const segments = (t.segments ?? []).filter((s) => !s.speaker || !via.has(s.speaker));
  const speakers = (t.speakers ?? []).filter((s) => !s.diarLabel || !via.has(s.diarLabel));
  return { corpo: JSON.stringify({ ...t, segments, speakers }), etichette, vuoto: segments.length === 0 };
}

/**
 * Chi chiede la cancellazione esce anche dalla trascrizione gia' costruita
 * dai sottotitoli: le sue frasi, il suo nome e la sua voce nell'elenco dei
 * parlanti, nel testo pubblicato e in quello originale conservato alla prima
 * correzione. Le frasi spostate a mano su un'altra voce restano con quella.
 * Una trascrizione che resta vuota se ne va, con la registrazione «solo
 * sottotitoli» che la portava.
 */
export async function togliPersoneDalleTrascrizioni(
  tx: Prisma.TransactionClient,
  eventIds: readonly string[],
  registrationIds: readonly string[],
): Promise<number> {
  if (eventIds.length === 0 || registrationIds.length === 0) return 0;
  const persone = new Set(registrationIds);
  const artefatti = await tx.postprodArtifact.findMany({
    where: {
      type: 'TRANSCRIPT_JSON',
      modelId: CAPTIONS_TRANSCRIPT_MODEL,
      recording: { eventId: { in: [...eventIds] } },
    },
    select: {
      id: true,
      recordingId: true,
      inlineBody: true,
      recording: { select: { blobKey: true } },
      original: { select: { id: true, body: true } },
    },
  });
  let toccate = 0;
  for (const a of artefatti) {
    const chiaro = a.inlineBody ? tryDecryptPII(a.inlineBody) : null;
    const nuovo = chiaro ? senzaLePersone(chiaro, persone) : null;
    const originale = a.original ? tryDecryptPII(a.original.body) : null;
    const nuovoOriginale = originale ? senzaLePersone(originale, persone) : null;
    if (!nuovo && !nuovoOriginale) continue;
    toccate += 1;
    const etichette = [...new Set([...(nuovo?.etichette ?? []), ...(nuovoOriginale?.etichette ?? [])])];
    if (nuovo?.vuoto) {
      if (registrazioneSoloSottotitoli(a.recording)) {
        await tx.recording.delete({ where: { id: a.recordingId } });
      } else {
        await tx.postprodArtifact.delete({ where: { id: a.id } });
        await tx.speaker.deleteMany({ where: { recordingId: a.recordingId } });
      }
      continue;
    }
    if (nuovo) {
      await tx.postprodArtifact.update({
        where: { id: a.id },
        data: {
          inlineBody: encryptPII(nuovo.corpo),
          sizeBytes: BigInt(Buffer.byteLength(nuovo.corpo)),
          contentHash: createHash('sha256').update(nuovo.corpo).digest('hex'),
        },
      });
    }
    if (a.original && nuovoOriginale) {
      await tx.postprodOriginalBody.update({
        where: { id: a.original.id },
        data: {
          body: encryptPII(nuovoOriginale.corpo),
          sizeBytes: BigInt(Buffer.byteLength(nuovoOriginale.corpo)),
          contentHash: createHash('sha256').update(nuovoOriginale.corpo).digest('hex'),
        },
      });
    }
    await tx.speaker.deleteMany({ where: { recordingId: a.recordingId, diarLabel: { in: etichette } } });
  }
  return toccate;
}
