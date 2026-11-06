// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * Quali tracce per persona possono passare al worker. Una regola sola per chi
 * accoda la trascrizione, per chi la consegna al worker e per l'orchestratore:
 * un lavoro TRANSCRIBE_MULTITRACK senza tracce fallirebbe a ogni tentativo su
 * un worker con la GPU, quindi non nasce e, se le tracce spariscono dopo, si
 * chiude prima di accenderne uno.
 *
 * Una traccia conta se esiste ancora, se la persona non ha ritirato dalla sala
 * il consenso alla trascrizione dopo che era gia' registrata
 * (lib/captions/room endpointRitirati) e, per la trascrizione, se con il segno
 * `transcriptConsentRule` ha un consenso al testo che comprende il nome: chi
 * aveva acconsentito alla sola traccia audio non ha acconsentito a questo.
 * All'archivio la traccia passa con ogni versione, il nome no.
 */
import { Prisma, type PrismaClient } from '@prisma/client';

import { endpointConConsenso, endpointRitirati } from '@/lib/captions/room';
import { prisma } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { postprodJobsCompletedTotal } from '@/lib/metrics';
import { VERSIONE_TESTO_TRASCRIZIONE } from '@/lib/registration/consents';

type Db = PrismaClient | Prisma.TransactionClient;

export interface RegistrazioneConTracce {
  id: string;
  eventId: string;
  transcriptConsentRule: boolean;
}

export interface TracciaUtilizzabile {
  participantId: string;
  /** Cifrato, com'e' salvato. */
  displayName: string | null;
  blobKey: string;
  startOffsetMs: number;
  /** Il nome puo' arrivare al worker. */
  nominabile: boolean;
}

export const CODICE_TRACCE_ASSENTI = 'NO_TRANSCRIBABLE_TRACKS';

export const MOTIVO_TRACCE_ASSENTI =
  'no transcribable tracks: they were deleted or their consent does not cover the transcription';

/** Quanti lavori in coda si controllano a ogni giro dell'orchestratore. */
const LAVORI_CONTROLLATI = 20;

export async function tracceUtilizzabili(
  db: Db,
  recording: RegistrazioneConTracce,
  { daTrascrivere }: { daTrascrivere: boolean }
): Promise<TracciaUtilizzabile[]> {
  const tracks = await db.recordingTrack.findMany({
    where: { recordingId: recording.id, audioPurgedAt: null },
    select: {
      participantId: true,
      displayName: true,
      blobKey: true,
      startOffsetMs: true,
    },
    orderBy: { startOffsetMs: 'asc' },
  });
  const endpoint = [...new Set(tracks.map((tr) => tr.participantId))];
  const [ritirati, nominabili] = await Promise.all([
    endpointRitirati(recording.eventId, endpoint),
    recording.transcriptConsentRule
      ? endpointConConsenso(recording.eventId, endpoint, VERSIONE_TESTO_TRASCRIZIONE)
      : null,
  ]);
  const utilizzabili: TracciaUtilizzabile[] = [];
  for (const tr of tracks) {
    if (ritirati.has(tr.participantId)) continue;
    const nominabile = nominabili?.has(tr.participantId) ?? true;
    if (daTrascrivere && !nominabile) continue;
    utilizzabili.push({ ...tr, nominabile });
  }
  return utilizzabili;
}

/**
 * Lo stato con cui lo staff sa che niente e' stato trascritto: lo stesso di un
 * lavoro fallito dopo tutti i tentativi.
 */
async function chiudiLavoroSenzaTracce(
  id: string,
  recordingId: string,
  stato: Prisma.Sql
): Promise<boolean> {
  const chiusi = await prisma.$executeRaw`
    UPDATE postprod_jobs
    SET status = 'FAILED', completed_at = NOW(), leased_at = NULL, leased_by = NULL,
        last_error = ${MOTIVO_TRACCE_ASSENTI}, updated_at = NOW()
    WHERE id = ${id}::uuid AND ${stato}
  `;
  if (chiusi === 0) return false;
  await prisma.recording.updateMany({
    where: { id: recordingId, status: { in: ['POSTPROD_QUEUED', 'POSTPROD_RUNNING'] } },
    data: { status: 'POSTPROD_PARTIAL' },
  });
  postprodJobsCompletedTotal.labels('TRANSCRIBE_MULTITRACK', 'FAILED').inc();
  return true;
}

/** Il lavoro appena preso da un worker: non torna in coda a ogni giro. */
export function chiudiLavoroPresoSenzaTracce(
  id: string,
  recordingId: string,
  attempts: number
): Promise<boolean> {
  return chiudiLavoroSenzaTracce(
    id,
    recordingId,
    Prisma.sql`status = 'CLAIMED' AND attempts = ${attempts}`
  );
}

/**
 * Chiude i lavori in coda rimasti senza tracce dopo l'accodamento (l'ultimo
 * consenso ritirato mentre aspettavano). Lo chiama l'orchestratore prima di
 * contare la coda: e' la sua conta che accende il worker con la GPU.
 */
export async function chiudiLavoriInCodaSenzaTracce(): Promise<number> {
  const lavori = await prisma.postprodJob.findMany({
    where: {
      kind: 'TRANSCRIBE_MULTITRACK',
      status: 'PENDING',
      recordingId: { not: null },
    },
    orderBy: { nextAttemptAt: 'asc' },
    take: LAVORI_CONTROLLATI,
    select: {
      id: true,
      recording: { select: { id: true, eventId: true, transcriptConsentRule: true } },
    },
  });
  let chiusi = 0;
  for (const { id, recording } of lavori) {
    if (!recording) continue;
    if ((await tracceUtilizzabili(prisma, recording, { daTrascrivere: true })).length > 0)
      continue;
    if (await chiudiLavoroSenzaTracce(id, recording.id, Prisma.sql`status = 'PENDING'`))
      chiusi += 1;
  }
  return chiusi;
}

/**
 * L'errore con cui chi avvia la pipeline a mano sa che non c'e' niente da
 * trascrivere. Lanciato dentro la transazione di chi accoda, annulla anche le
 * modifiche gia' fatte (interruttori AI, contatore delle esecuzioni).
 */
export function erroreTracceAssenti(): AppError {
  return new AppError(
    'No track of this recording can be transcribed: they were deleted, or the consents they carry do not cover the transcription.',
    422,
    CODICE_TRACCE_ASSENTI
  );
}
