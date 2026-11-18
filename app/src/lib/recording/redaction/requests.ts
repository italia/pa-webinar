// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * Le richieste di rimozione da una registrazione: come nascono, come si
 * leggono, come cambiano stato.
 *
 * Una richiesta riguarda una persona e una registrazione con un media (video o
 * tracce per persona). Nasce da «I miei dati», per le iscrizioni a un evento
 * che ha una registrazione, o dallo staff, per una richiesta arrivata al
 * titolare per altre vie. All'arrivo si fotografano gli intervalli proposti
 * (lib/recording/redaction/people), perche' i dati della sala da cui nascono
 * si cancellano alla scadenza dell'evento, mentre la richiesta resta finche'
 * qualcuno non la evade.
 *
 * Il registro GDPR (GdprAuditLog) ne tiene la storia senza dati personali:
 * l'identificativo della richiesta e della registrazione, l'origine, i numeri.
 */
import { Prisma, type RecordingRedactionStatus } from '@prisma/client';

import { registrazioneConMedia, registrazioneConVideo } from '@/lib/captions/transcript';
import { encryptPII, tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { ConflictError, NotFoundError } from '@/lib/errors';
import { TIMEOUT_DOPO_PULIZIA_MS } from '@/lib/gdpr/cleanup-selection';

import { richiestaAperta, STATI_APERTI } from './access';
import { leggiIntervalli, leggiProposte } from './intervals';
import {
  CAMPI_TEMPO,
  identitaDellIscrizione,
  proposteDellaPersona,
  type IdentitaInSala,
} from './people';

type Db = Prisma.TransactionClient | typeof prisma;

export type OrigineRichiesta = 'self-service' | 'admin';

/** Le registrazioni di un evento da cui si puo' chiedere di essere tolti: quelle con un media. */
export async function registrazioniConMedia(
  db: Db,
  eventId: string
): Promise<Array<{ id: string; blobKey: string; createdAt: Date }>> {
  const tutte = await db.recording.findMany({
    where: { eventId },
    select: { id: true, blobKey: true, mediaStartedAt: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  return tutte.filter((r) => registrazioneConMedia(r));
}

export interface NuovaRichiesta {
  recordingId: string;
  source: OrigineRichiesta;
  /** Il nome della persona, gia' cifrato (encryptPII). */
  displayNameCifrato: string;
  emailHash?: string | null;
  registrationId?: string | null;
  identita: IdentitaInSala;
  /** La nota dello staff, in chiaro: si cifra qui. */
  note?: string | null;
}

/**
 * Crea la richiesta con gli intervalli proposti e la traccia nel registro
 * GDPR. La registrazione deve avere un media.
 */
export async function creaRichiesta(
  db: Db,
  nuova: NuovaRichiesta
): Promise<{ id: string }> {
  const r = await db.recording.findUnique({
    where: { id: nuova.recordingId },
    select: CAMPI_TEMPO,
  });
  if (!r || !registrazioneConMedia(r)) throw new NotFoundError('Recording');
  const proposti = await proposteDellaPersona(db, r, nuova.identita);
  const creata = await db.recordingRedactionRequest.create({
    data: {
      eventId: r.eventId,
      recordingId: r.id,
      source: nuova.source,
      displayName: nuova.displayNameCifrato,
      emailHash: nuova.emailHash ?? null,
      registrationId: nuova.registrationId ?? null,
      seatIds: [...new Set(nuova.identita.seatIds)],
      endpointIds: [...new Set(nuova.identita.endpointIds)],
      proposedIntervals: proposti as unknown as Prisma.InputJsonValue,
      note: nuova.note ? encryptPII(nuova.note) : null,
    },
    select: { id: true },
  });
  await db.gdprAuditLog.create({
    data: {
      eventId: r.eventId,
      action: 'RECORDING_REDACTION_REQUESTED',
      recordCount: 1,
      details: JSON.stringify({
        requestId: creata.id,
        recordingId: r.id,
        source: nuova.source,
        proposedIntervals: proposti.length,
        ...(nuova.emailHash ? { emailHashPrefix: nuova.emailHash.substring(0, 8) } : {}),
      }),
    },
  });
  return creata;
}

/**
 * La richiesta da «I miei dati»: una per ogni registrazione con un media
 * dell'evento dell'iscrizione, salvo quelle per cui la stessa iscrizione ne ha
 * gia' una aperta. Restituisce quante ne ha create.
 */
export async function chiediDaIMieiDati(
  emailHash: string,
  registrationId: string
): Promise<number> {
  const iscrizione = await prisma.registration.findFirst({
    where: { id: registrationId, emailHash },
    select: { id: true, eventId: true, displayName: true },
  });
  if (!iscrizione) throw new NotFoundError('Registration');
  return prisma.$transaction(
    async (tx) => {
      // Due invii insieme (doppio clic, due schede) non creano due richieste:
      // il secondo aspetta il primo e trova la sua.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`rimozione:${iscrizione.id}`}))`;
      const registrazioni = await registrazioniConMedia(tx, iscrizione.eventId);
      if (registrazioni.length === 0) throw new NotFoundError('Recording');
      const gia = await tx.recordingRedactionRequest.findMany({
        where: {
          registrationId: iscrizione.id,
          recordingId: { in: registrazioni.map((r) => r.id) },
          status: { in: [...STATI_APERTI] },
        },
        select: { recordingId: true },
      });
      const aperte = new Set(gia.map((g) => g.recordingId));
      const identita = await identitaDellIscrizione(
        tx,
        iscrizione.eventId,
        iscrizione.id
      );
      let create = 0;
      for (const r of registrazioni) {
        if (aperte.has(r.id)) continue;
        await creaRichiesta(tx, {
          recordingId: r.id,
          source: 'self-service',
          displayNameCifrato: iscrizione.displayName,
          emailHash,
          registrationId: iscrizione.id,
          identita,
        });
        create += 1;
      }
      return create;
    },
    { timeout: TIMEOUT_DOPO_PULIZIA_MS }
  );
}

/** L'errore di una richiesta il cui lavoro non c'e' piu'. */
export const SENZA_LAVORO = 'The removal job no longer exists';

/**
 * Le richieste in elaborazione il cui lavoro e' fallito per sempre (o non c'e'
 * piu') tornano in lavorazione, con l'errore: lo staff le puo' inviare di
 * nuovo. La chiamano chi chiude un lavoro di rimozione come fallito (il
 * recupero dei lavori, l'avanzamento, il claim e la consegna) e l'elenco dello
 * staff; con `jobId` solo quella del lavoro.
 */
export async function riapriRichiesteSenzaLavoro(
  db: Db = prisma,
  jobId?: string
): Promise<number> {
  const soloLavoro = jobId ? Prisma.sql`AND rr.job_id = ${jobId}::uuid` : Prisma.empty;
  return db.$executeRaw`
    UPDATE recording_redaction_requests r
    SET status = 'IN_PROGRESS',
        last_error = LEFT(COALESCE(f.last_error, ${SENZA_LAVORO}), 2000),
        updated_at = NOW()
    FROM (
      SELECT rr.id, pj.last_error
      FROM recording_redaction_requests rr
      LEFT JOIN postprod_jobs pj ON pj.id = rr.job_id
      WHERE rr.status = 'PROCESSING' AND (pj.id IS NULL OR pj.status = 'FAILED') ${soloLavoro}
    ) f
    WHERE r.id = f.id
  `;
}

/** Lo stato delle richieste di una persona, per «I miei dati»: senza nomi. */
export interface RichiestaPerLaPersona {
  registrationId: string;
  status: RecordingRedactionStatus;
  createdAt: string;
  closedAt: string | null;
}

export async function richiesteDellaPersona(
  emailHash: string
): Promise<RichiestaPerLaPersona[]> {
  const righe = await prisma.recordingRedactionRequest.findMany({
    where: { emailHash, registrationId: { not: null } },
    select: { registrationId: true, status: true, createdAt: true, closedAt: true },
    orderBy: { createdAt: 'asc' },
  });
  return righe.map((r) => ({
    registrationId: r.registrationId!,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    closedAt: r.closedAt?.toISOString() ?? null,
  }));
}

/** Le iscrizioni fra quelle date i cui eventi hanno una registrazione con un media. */
export async function iscrizioniConRegistrazione(
  iscrizioni: ReadonlyArray<{ id: string; eventId: string }>
): Promise<Set<string>> {
  const eventi = [...new Set(iscrizioni.map((i) => i.eventId))];
  if (eventi.length === 0) return new Set();
  const registrazioni = await prisma.recording.findMany({
    where: { eventId: { in: eventi } },
    select: { eventId: true, blobKey: true, mediaStartedAt: true },
  });
  const conMedia = new Set(
    registrazioni.filter((r) => registrazioneConMedia(r)).map((r) => r.eventId)
  );
  return new Set(iscrizioni.filter((i) => conMedia.has(i.eventId)).map((i) => i.id));
}

/** Una riga dell'elenco dello staff. */
export interface RichiestaInElenco {
  id: string;
  status: RecordingRedactionStatus;
  source: string;
  name: string | null;
  createdAt: string;
  closedAt: string | null;
  recordingId: string | null;
  event: { id: string; title: unknown; startsAt: string };
}

export async function elencoRichieste(
  filtro: 'open' | 'all'
): Promise<RichiestaInElenco[]> {
  await riapriRichiesteSenzaLavoro().catch(() => 0);
  const righe = await prisma.recordingRedactionRequest.findMany({
    where: filtro === 'open' ? { status: { in: [...STATI_APERTI] } } : {},
    orderBy: { createdAt: 'desc' },
    take: 500,
    select: {
      id: true,
      status: true,
      source: true,
      displayName: true,
      createdAt: true,
      closedAt: true,
      recordingId: true,
      event: { select: { id: true, title: true, startsAt: true } },
    },
  });
  return righe.map((r) => ({
    id: r.id,
    status: r.status,
    source: r.source,
    name: tryDecryptPII(r.displayName),
    createdAt: r.createdAt.toISOString(),
    closedAt: r.closedAt?.toISOString() ?? null,
    recordingId: r.recordingId,
    event: {
      id: r.event.id,
      title: r.event.title,
      startsAt: r.event.startsAt.toISOString(),
    },
  }));
}

/**
 * La richiesta come la legge lo staff. Una richiesta in elaborazione il cui
 * lavoro e' fallito per sempre (o non c'e' piu') torna in lavorazione con
 * l'errore: lo staff la puo' inviare di nuovo.
 */
export async function leggiRichiesta(id: string) {
  let r = await prisma.recordingRedactionRequest.findUnique({
    where: { id },
    include: {
      job: { select: { status: true, lastError: true, attempts: true, updatedAt: true } },
      event: {
        select: {
          id: true,
          title: true,
          startsAt: true,
          youtubeUrl: true,
          recordingUrl: true,
          recordingPublished: true,
        },
      },
      recording: {
        select: {
          id: true,
          blobKey: true,
          durationSec: true,
          mediaStartedAt: true,
          createdAt: true,
          status: true,
          _count: { select: { tracks: true } },
        },
      },
    },
  });
  if (!r) throw new NotFoundError('Removal request');
  if (r.status === 'PROCESSING' && (!r.job || r.job.status === 'FAILED')) {
    const errore = r.job?.lastError ?? SENZA_LAVORO;
    const n = await prisma.recordingRedactionRequest.updateMany({
      where: { id, status: 'PROCESSING', jobId: r.jobId },
      data: { status: 'IN_PROGRESS', lastError: errore.slice(0, 2000) },
    });
    if (n.count > 0)
      r = { ...r, status: 'IN_PROGRESS', lastError: errore.slice(0, 2000) };
  }
  return r;
}

export type RichiestaLetta = Awaited<ReturnType<typeof leggiRichiesta>>;

/** La vista dello staff: niente di cifrato, niente identificativi della sala. */
export function vistaRichiesta(
  r: RichiestaLetta,
  extra: {
    pipelineEnabled: boolean;
    storageConfigured: boolean;
    /** La chiave del video pubblicato dell'evento, se c'e' (keyFromUrl). */
    chiavePubblicata: string | null;
  }
) {
  const rec = r.recording;
  const conVideo = !!rec && registrazioneConVideo(rec);
  return {
    id: r.id,
    status: r.status,
    source: r.source,
    name: tryDecryptPII(r.displayName),
    note: r.note ? tryDecryptPII(r.note) : null,
    hasRegistration: !!r.registrationId,
    seats: r.seatIds.length,
    createdAt: r.createdAt.toISOString(),
    startedAt: r.startedAt?.toISOString() ?? null,
    submittedAt: r.submittedAt?.toISOString() ?? null,
    closedAt: r.closedAt?.toISOString() ?? null,
    lastError: r.lastError,
    proposedIntervals: leggiProposte(r.proposedIntervals),
    intervals: leggiIntervalli(r.intervals),
    job: r.job
      ? {
          status: r.job.status,
          attempts: r.job.attempts,
          updatedAt: r.job.updatedAt.toISOString(),
        }
      : null,
    event: {
      id: r.event.id,
      title: r.event.title,
      startsAt: r.event.startsAt.toISOString(),
    },
    recording: rec
      ? {
          id: rec.id,
          durationSec: rec.durationSec,
          hasVideo: conVideo,
          tracks: rec._count.tracks,
          status: rec.status,
        }
      : null,
    // Le copie che la rimozione non raggiunge: lo staff le deve togliere da se'.
    externalCopy: !!r.event.youtubeUrl,
    // Il video pubblicato dell'evento e' un altro file: la rimozione non lo cambia.
    publishedElsewhere:
      !!r.event.recordingPublished &&
      !!extra.chiavePubblicata &&
      !!rec &&
      extra.chiavePubblicata !== rec.blobKey,
    pipelineEnabled: extra.pipelineEnabled,
    storageConfigured: extra.storageConfigured,
  };
}

/** Lo staff apre l'editor: una richiesta aperta passa in lavorazione. */
export async function prendiInCarico(id: string): Promise<void> {
  await prisma.recordingRedactionRequest.updateMany({
    where: { id, status: 'OPEN' },
    data: { status: 'IN_PROGRESS', startedAt: new Date() },
  });
}

/** Lo staff la respinge, con il motivo (cifrato: puo' citare la persona). */
export async function respingi(id: string, nota: string): Promise<void> {
  const r = await prisma.recordingRedactionRequest.findUnique({
    where: { id },
    select: { status: true, eventId: true, recordingId: true, source: true },
  });
  if (!r) throw new NotFoundError('Removal request');
  if (!richiestaAperta(r.status) || r.status === 'PROCESSING') {
    throw new ConflictError(
      'Only an open request that is not being processed can be rejected'
    );
  }
  await prisma.$transaction(async (tx) => {
    const n = await tx.recordingRedactionRequest.updateMany({
      where: { id, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      data: { status: 'REJECTED', note: encryptPII(nota), closedAt: new Date() },
    });
    if (n.count === 0) throw new ConflictError('The request changed meanwhile');
    await tx.gdprAuditLog.create({
      data: {
        eventId: r.eventId,
        action: 'RECORDING_REDACTION_REJECTED',
        recordCount: 1,
        details: JSON.stringify({
          requestId: id,
          recordingId: r.recordingId,
          source: r.source,
        }),
      },
    });
  });
}
