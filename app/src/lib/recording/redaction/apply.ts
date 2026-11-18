// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * Cosa succede quando una persona esce da una registrazione.
 *
 * Nella stessa transazione:
 *  - il video ripulito (se c'e') prende il posto dell'originale nella
 *    registrazione, nella sessione di chiamata e, se era lo stesso file, nel
 *    video pubblicato dell'evento;
 *  - le tracce per persona della persona si cancellano, con le frasi dei
 *    sottotitoli salvate per lei e le sue righe nella trascrizione costruita
 *    dai sottotitoli;
 *  - gli esiti della post-produzione ricavati dall'originale (trascrizione AI,
 *    sottotitoli, sintesi, traduzioni, doppiaggio, forma d'onda, archivio) si
 *    cancellano, i lavori ancora aperti si chiudono, e se c'era una
 *    trascrizione AI la pipeline riparte su una run nuova;
 *  - la richiesta si chiude e il registro GDPR lo dice, con i numeri.
 *
 * I file si cancellano dopo il commit (`cancellaFileDellaRimozione`): il
 * video originale, i file audio delle tracce della persona, il manifesto
 * delle tracce (porta i nomi in chiaro) e i file delle run precedenti della
 * post-produzione.
 *
 * La pipeline riparte con lo stesso lavoro radice di prima. Dalle tracce per
 * persona riparte dalle tracce che restano. Dal video completo non chiede di
 * nuovo la conferma che tutte le voci abbiano acconsentito: il video ripulito
 * contiene meno voci di quello per cui era stata data.
 */
import type { Prisma } from '@prisma/client';

import { enqueuePostprodForRecording } from '@/lib/ai/enqueue';
import { recordingPrefix } from '@/lib/ai/paths';
import {
  bloccaTrascrizioneEvento,
  CAPTIONS_TRANSCRIPT_MODEL,
  togliPersoneDalleTrascrizioni,
} from '@/lib/captions/transcript';
import { prisma } from '@/lib/db';
import { ConflictError, NotFoundError } from '@/lib/errors';
import { titolariDeiPosti } from '@/lib/gdpr/consent-proofs';
import { cancellaManifesto } from '@/lib/recorder/manifest';
import { getRecordingsStorage } from '@/lib/storage';
import { deletePostprodBlob, listPostprodBlobs } from '@/lib/storage/postprod';
import { recordingBlobNameFromKey } from '@/lib/storage/recordings';

import { secondiCoperti, type Intervallo } from './intervals';

type Tx = Prisma.TransactionClient;

/** Il motivo con cui si chiudono i lavori della run superata dalla rimozione. */
export const MOTIVO_LAVORI_SUPERATI = 'Superseded by a removal from the recording';

export interface RichiestaDaApplicare {
  id: string;
  eventId: string;
  recordingId: string | null;
  registrationId: string | null;
  seatIds: readonly string[];
  endpointIds: readonly string[];
}

export interface VideoRipulito {
  blobKey: string;
  sizeBytes: number | null;
}

export interface FileDaCancellare {
  /** Chiavi sotto `recordings/`: il video originale e le tracce della persona. */
  registrazioni: string[];
  /** Il manifesto delle tracce della registrazione, quando la persona ne aveva. */
  manifesto: { eventId: string; recordingId: string } | null;
  /** I file della post-produzione della registrazione, tranne quelli dalla run `primaRunDaTenere`. */
  postprod: { prefisso: string; primaRunDaTenere: number };
}

export interface EsitoRimozione {
  intervals: number;
  secondsRemoved: number;
  videoReplaced: boolean;
  tracksDeleted: number;
  captionSegmentsDeleted: number;
  outputsDeleted: number;
  jobsClosed: number;
  rerun: boolean;
  file: FileDaCancellare;
}

/** Due chiavi dello stesso file, dati due modi di scriverlo (indirizzo canonico o chiave). */
function stessoFile(indirizzo: string | null | undefined, chiave: string): boolean {
  if (!indirizzo) return false;
  if (indirizzo === chiave) return true;
  const provider = getRecordingsStorage();
  return provider?.keyFromUrl(indirizzo) === chiave;
}

/**
 * Applica la rimozione nella transazione `tx`. La richiesta deve essere in
 * elaborazione (con un video ripulito) o in lavorazione (senza): altrimenti
 * qualcun altro l'ha gia' chiusa, e la transazione si annulla.
 */
export async function applicaRimozione(
  tx: Tx,
  richiesta: RichiestaDaApplicare,
  intervalli: readonly Intervallo[],
  nuovoVideo: VideoRipulito | null,
  adesso = new Date()
): Promise<EsitoRimozione> {
  if (!richiesta.recordingId) throw new NotFoundError('Recording');
  // In fila con le costruzioni della trascrizione dai sottotitoli, i ritiri e
  // la pulizia dello stesso evento, come la cancellazione chiesta da «I miei dati».
  await bloccaTrascrizioneEvento(tx, richiesta.eventId);
  const chiusa = await tx.recordingRedactionRequest.updateMany({
    where: {
      id: richiesta.id,
      status: nuovoVideo ? 'PROCESSING' : { in: ['OPEN', 'IN_PROGRESS'] },
    },
    data: {
      status: 'CLOSED',
      closedAt: adesso,
      intervals: intervalli.map((i) => ({ start: i.start, end: i.end })),
      lastError: null,
    },
  });
  if (chiusa.count === 0)
    throw new ConflictError('The removal request is not open for this step');

  const registrazione = await tx.recording.findUnique({
    where: { id: richiesta.recordingId },
    select: {
      id: true,
      eventId: true,
      blobKey: true,
      runCount: true,
      callSessionId: true,
      event: {
        select: { recordingUrl: true, tempRecordingUrl: true, aiTranscriptEnabled: true },
      },
    },
  });
  if (!registrazione) throw new NotFoundError('Recording');

  const registrazioni: string[] = [];
  if (nuovoVideo) {
    const provider = getRecordingsStorage();
    if (!provider) throw new ConflictError('Recording storage is not configured');
    const originale = registrazione.blobKey;
    const nuovoIndirizzo = provider.publicUrl(nuovoVideo.blobKey);
    const dimensione =
      nuovoVideo.sizeBytes !== null ? BigInt(nuovoVideo.sizeBytes) : null;
    await tx.recording.update({
      where: { id: registrazione.id },
      data: { blobKey: nuovoVideo.blobKey, fileSizeBytes: dimensione },
    });
    const sessione = await tx.callSession.findUnique({
      where: { id: registrazione.callSessionId },
      select: { recordingUrl: true, recordingFilename: true },
    });
    if (
      sessione &&
      (stessoFile(sessione.recordingUrl, originale) ||
        (sessione.recordingFilename &&
          `recordings/${sessione.recordingFilename}` === originale))
    ) {
      await tx.callSession.update({
        where: { id: registrazione.callSessionId },
        data: {
          recordingUrl: nuovoIndirizzo,
          recordingFilename: recordingBlobNameFromKey(nuovoVideo.blobKey),
          recordingFileSize: dimensione,
        },
      });
    }
    if (stessoFile(registrazione.event.recordingUrl, originale)) {
      await tx.event.update({
        where: { id: registrazione.eventId },
        data: { recordingUrl: nuovoIndirizzo, recordingFileSize: dimensione },
      });
    }
    // La copia per chi arriva in ritardo, se era lo stesso file, se ne va:
    // spostarla sul video ripulito lo farebbe cancellare dalla pulizia delle
    // copie temporanee.
    if (stessoFile(registrazione.event.tempRecordingUrl, originale)) {
      await tx.event.update({
        where: { id: registrazione.eventId },
        data: { tempRecordingUrl: null, tempRecordingStartedAt: null },
      });
    }
    registrazioni.push(originale);
  }

  // Le tracce per persona sono la sua voce isolata: via tutte, non solo gli intervalli.
  const tracce = richiesta.endpointIds.length
    ? await tx.recordingTrack.findMany({
        where: {
          recordingId: registrazione.id,
          participantId: { in: [...richiesta.endpointIds] },
        },
        select: { id: true, blobKey: true, audioPurgedAt: true },
      })
    : [];
  if (tracce.length > 0) {
    await tx.recordingTrack.deleteMany({
      where: { id: { in: tracce.map((t) => t.id) } },
    });
    registrazioni.push(...tracce.filter((t) => !t.audioPurgedAt).map((t) => t.blobKey));
  }

  // Le frasi dei sottotitoli della persona e le sue righe nella trascrizione
  // costruita dai sottotitoli, per tutto l'evento.
  const chiFrasi: Prisma.CaptionSegmentWhereInput[] = [
    ...(richiesta.endpointIds.length
      ? [{ endpointId: { in: [...richiesta.endpointIds] } }]
      : []),
    ...(richiesta.seatIds.length ? [{ seatId: { in: [...richiesta.seatIds] } }] : []),
  ];
  const frasi = chiFrasi.length
    ? await tx.captionSegment.deleteMany({
        where: { eventId: richiesta.eventId, OR: chiFrasi },
      })
    : { count: 0 };
  const titolari = await titolariDeiPosti(tx, richiesta.eventId);
  const impronte = [
    ...new Set(richiesta.seatIds.flatMap((s) => titolari.get(s)?.impronte ?? [])),
  ];
  await togliPersoneDalleTrascrizioni(
    tx,
    [richiesta.eventId],
    richiesta.registrationId ? [richiesta.registrationId] : [],
    impronte
  );

  // Il registro di chi parla resta fino alla scadenza dell'evento, ma senza il
  // nome della persona: le sue voci restano (danno la fine del turno di chi
  // parlava prima) e non nominano piu' nessuno.
  if (richiesta.endpointIds.length > 0) {
    const endpoint = new Set(richiesta.endpointIds);
    const sessioni = await tx.callSession.findMany({
      where: { eventId: richiesta.eventId },
      select: { id: true, dominantSpeakerLog: true },
    });
    for (const s of sessioni) {
      if (!Array.isArray(s.dominantSpeakerLog)) continue;
      const voci = s.dominantSpeakerLog as Array<Record<string, unknown> | null>;
      if (
        !voci.some(
          (v) => v && endpoint.has(String(v.participantId)) && 'displayName' in v
        )
      )
        continue;
      await tx.callSession.update({
        where: { id: s.id },
        data: {
          dominantSpeakerLog: voci.map((v) => {
            if (!v || !endpoint.has(String(v.participantId))) return v;
            const { displayName: _nome, ...resto } = v;
            return resto;
          }) as Prisma.InputJsonValue,
        },
      });
    }
  }

  // Gli esiti ricavati dall'originale: la trascrizione dai sottotitoli resta,
  // ripulita qui sopra.
  const esiti = await tx.postprodArtifact.findMany({
    where: {
      recordingId: registrazione.id,
      OR: [{ modelId: null }, { modelId: { not: CAPTIONS_TRANSCRIPT_MODEL } }],
    },
    select: { id: true, type: true, job: { select: { kind: true } } },
  });
  const aperti = await tx.postprodJob.findMany({
    where: {
      recordingId: registrazione.id,
      status: { in: ['PENDING', 'CLAIMED', 'RUNNING'] },
    },
    select: { kind: true },
  });
  // Il lavoro radice della pipeline: quello che ha prodotto la trascrizione
  // AI, o quello che la stava producendo. La nuova run riparte dallo stesso.
  const radice =
    esiti.find((a) => a.type === 'TRANSCRIPT_JSON')?.job.kind ??
    aperti.find((j) => j.kind === 'TRANSCRIBE' || j.kind === 'TRANSCRIBE_MULTITRACK')
      ?.kind ??
    null;
  const avevaTrascrizioneAI = esiti.some((a) => a.type === 'TRANSCRIPT_JSON');
  if (esiti.length > 0) {
    await tx.postprodArtifact.deleteMany({
      where: { id: { in: esiti.map((a) => a.id) } },
    });
  }
  if (avevaTrascrizioneAI) {
    await tx.speaker.deleteMany({ where: { recordingId: registrazione.id } });
  }
  const lavoriChiusi = await tx.postprodJob.updateMany({
    where: {
      recordingId: registrazione.id,
      status: { in: ['PENDING', 'CLAIMED', 'RUNNING'] },
    },
    data: {
      status: 'FAILED',
      lastError: MOTIVO_LAVORI_SUPERATI,
      completedAt: adesso,
      leasedAt: null,
      leasedBy: null,
    },
  });

  // La pipeline riparte dove c'era: su una run nuova, con la conferma delle
  // voci gia' data per un video che ne conteneva di piu'.
  let rerun = false;
  let runNuova = registrazione.runCount;
  if (esiti.length > 0 || lavoriChiusi.count > 0) {
    const sito = await tx.siteSetting.findUnique({
      where: { id: 'singleton' },
      select: { aiPipelineEnabled: true },
    });
    if (
      radice !== null &&
      sito?.aiPipelineEnabled &&
      registrazione.event.aiTranscriptEnabled
    ) {
      runNuova = registrazione.runCount + 1;
      await tx.recording.update({
        where: { id: registrazione.id },
        data: { runCount: runNuova, status: 'POSTPROD_QUEUED' },
      });
      // Dalle tracce per persona si riparte dalle tracce che restano, mai dal
      // video completo, che nessuno ha confermato. Dal video completo la
      // conferma delle voci data per l'originale vale per quello ripulito.
      const multitraccia = radice === 'TRANSCRIBE_MULTITRACK';
      const accodati = await enqueuePostprodForRecording(tx, {
        recordingId: registrazione.id,
        multitrack: multitraccia,
        allVoicesConsented: !multitraccia,
        seServeConferma: 'salta',
        seMancanoTracce: 'salta',
      });
      rerun = accodati.enqueued > 0;
    }
    if (!rerun) {
      await tx.recording.update({
        where: { id: registrazione.id },
        data: { status: 'READY' },
      });
    }
  }

  const esito: EsitoRimozione = {
    intervals: intervalli.length,
    secondsRemoved: secondiCoperti(intervalli),
    videoReplaced: !!nuovoVideo,
    tracksDeleted: tracce.length,
    captionSegmentsDeleted: frasi.count,
    outputsDeleted: esiti.length,
    jobsClosed: lavoriChiusi.count,
    rerun,
    file: {
      registrazioni,
      manifesto:
        tracce.length > 0
          ? { eventId: registrazione.eventId, recordingId: registrazione.id }
          : null,
      postprod: {
        prefisso: recordingPrefix({
          eventId: registrazione.eventId,
          recordingId: registrazione.id,
        }),
        primaRunDaTenere: rerun ? runNuova : Number.POSITIVE_INFINITY,
      },
    },
  };
  const { file: _file, ...numeri } = esito;
  await tx.gdprAuditLog.create({
    data: {
      eventId: richiesta.eventId,
      action: 'RECORDING_REDACTED',
      recordCount: 1,
      details: JSON.stringify({
        requestId: richiesta.id,
        recordingId: registrazione.id,
        ...numeri,
      }),
    },
  });
  return esito;
}

/** La run di un file della post-produzione, dalla sua chiave; null se non si legge. */
export function runDellaChiave(prefisso: string, chiave: string): number | null {
  if (!chiave.startsWith(`${prefisso}/`)) return null;
  const run = chiave.slice(prefisso.length + 1).split('/')[0] ?? '';
  return /^\d+$/.test(run) ? Number(run) : null;
}

/**
 * Cancella i file dopo il commit. Non lancia: un file che lo storage non
 * cancella si scrive nel log; uno sotto `recordings/` si segna anche fra gli
 * orfani da cancellare subito, cosi' il prossimo giro della riconciliazione lo
 * toglie anche con la tolleranza spenta.
 */
export async function cancellaFileDellaRimozione(
  file: FileDaCancellare
): Promise<{ deleted: number; failed: number }> {
  const provider = getRecordingsStorage();
  if (!provider) return { deleted: 0, failed: 0 };
  let deleted = 0;
  let failed = 0;
  for (const chiave of file.registrazioni) {
    let ok = false;
    try {
      await provider.delete(chiave);
      ok = true;
    } catch (err) {
      console.error('[recording-redaction] file not deleted', {
        key: chiave,
        err: err instanceof Error ? err.message : String(err),
      });
    }
    if (ok) {
      deleted += 1;
      continue;
    }
    failed += 1;
    const nome = recordingBlobNameFromKey(chiave);
    if (nome) {
      await prisma.orphanRecording
        .upsert({
          where: { blobName: nome },
          create: { blobName: nome, decision: 'delete-now', note: 'removal request' },
          update: { decision: 'delete-now' },
        })
        .catch(() => undefined);
    }
  }
  if (file.manifesto) {
    const esito = await cancellaManifesto(
      provider,
      file.manifesto.eventId,
      file.manifesto.recordingId
    );
    if (esito === 'fallito') failed += 1;
    else if (esito === 'cancellato') deleted += 1;
  }
  try {
    for (const { key } of await listPostprodBlobs(file.postprod.prefisso)) {
      const run = runDellaChiave(file.postprod.prefisso, key);
      if (run !== null && run >= file.postprod.primaRunDaTenere) continue;
      try {
        await deletePostprodBlob(key);
        deleted += 1;
      } catch (err) {
        failed += 1;
        console.error('[recording-redaction] post-production file not deleted', {
          key,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    failed += 1;
    console.error('[recording-redaction] post-production files not listed', {
      prefix: file.postprod.prefisso,
      err: err instanceof Error ? err.message : String(err),
    });
  }
  return { deleted, failed };
}
