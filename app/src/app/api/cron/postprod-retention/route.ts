// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * GET /api/cron/postprod-retention
 *
 * Daily cleanup of post-production outputs and per-participant tracks.
 *
 *   1. **La scadenza della registrazione** (`Recording.retentionUntil`): la
 *      scrive la pulizia GDPR (`/api/cron/cleanup`, fase 2) quando la
 *      registrazione dell'evento scade (`Event.recordingDeleteAfterDays`).
 *      Passata quella data se ne va tutto cio' che la post-produzione ha
 *      prodotto: file e righe degli artefatti, parlanti, tracce, testi dei
 *      lavori, nomi nello snapshot. Senza quella data gli output restano: la
 *      registrazione e' un documento storico e non segue la conservazione dei
 *      dati dei partecipanti.
 *
 *   2. **Le tracce per persona** (voce isolata, quasi biometrica) non sono la
 *      registrazione che resta: alla conservazione dei dati dell'evento
 *      (`endsAt + dataRetentionDays`) se ne vanno, file e righe, pubblicata o
 *      no la registrazione.
 *
 *   3. **Il limite del sito** (`SiteSetting.aiArtifactRetentionDays > 0`):
 *      cancella gli artefatti creati da piu' di N giorni, pubblicati o no.
 *
 * Protected by CRON_API_KEY.
 */

import type { Prisma } from '@prisma/client';

import { withErrorHandling } from '@/lib/api-handler';
import { withoutSpeakerNames } from '@/lib/ai/pipeline-snapshot';
import { assertCronApiKey } from '@/lib/auth/cron';
import { prisma } from '@/lib/db';
import { isEventDataRetentionExpired } from '@/lib/gdpr/cleanup-selection';
import { cancellaManifesto } from '@/lib/recorder/manifest';
import {
  deletePostprodBlob,
  getPostprodStorage,
  isPostprodStorageConfigured,
} from '@/lib/storage/postprod';

export const dynamic = 'force-dynamic';

/**
 * Purge a recording's per-participant audio tracks: blobKey points at
 * isolated-voice audio (quasi-biometric) and displayName is encrypted PII.
 * For RETAINED (retainParticipantTracks=true) recordings, cron/multitrack-purge
 * waits on a retentionUntil that only the recording's expiry writes, so the raw
 * audio would otherwise outlive the event's retention. Deletes any surviving
 * track blobs, then the rows (RecordingTrack has no FK dependents). Idempotent.
 *
 * Indipendente dagli artefatti: trascrizioni, sottotitoli e sintesi restano con
 * la registrazione, la voce isolata di una persona no, e se ne va alla
 * conservazione dei dati dell'evento.
 */
async function purgeRecordingTracks(
  recordingId: string,
  eventId: string
): Promise<{ blobsDeleted: number; blobsFailed: number }> {
  let blobsDeleted = 0;
  let blobsFailed = 0;
  const tracks = await prisma.recordingTrack.findMany({
    where: { recordingId },
    select: { blobKey: true, audioPurgedAt: true },
  });
  const storage = getPostprodStorage();
  for (const tr of tracks) {
    if (tr.audioPurgedAt) continue; // blob already gone
    try {
      await storage.delete(tr.blobKey);
      blobsDeleted += 1;
    } catch (err) {
      blobsFailed += 1;
      console.warn('[postprod-retention] track blob delete failed', {
        key: tr.blobKey,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  await prisma.recordingTrack.deleteMany({ where: { recordingId } });
  // Senza piu' tracce, via anche il manifesto con i nomi. Sempre: una
  // registrazione multitraccia puo' non avere righe di traccia (avviso del
  // recorder mai arrivato) e aver gia' preso la chiave del mix al posto del
  // segnaposto; per le altre la chiave non esiste.
  if ((await cancellaManifesto(storage, eventId, recordingId)) === 'fallito')
    blobsFailed += 1;
  return { blobsDeleted, blobsFailed };
}

/**
 * Purge every postprod artifact of a recording: delete the blobs, delete the
 * artifact rows, delete Speaker rows (full PII), purge the raw tracks, scrub
 * PostprodJob payloads, then archive the recording. Lo usa la scadenza della
 * registrazione (`retentionUntil`).
 */
async function purgeRecordingArtifacts(
  recordingId: string,
  eventId: string
): Promise<{ blobsDeleted: number; blobsFailed: number; artifactsDeleted: number }> {
  let blobsDeleted = 0;
  let blobsFailed = 0;
  const artifacts = await prisma.postprodArtifact.findMany({
    where: { recordingId },
    select: { id: true, blobKey: true },
  });
  for (const a of artifacts) {
    // Gli artefatti tenuti solo nel database (trascrizione dai sottotitoli)
    // non hanno un file da cancellare.
    if (!a.blobKey) continue;
    try {
      await deletePostprodBlob(a.blobKey);
      blobsDeleted += 1;
    } catch (err) {
      blobsFailed += 1;
      console.warn('[postprod-retention] blob delete failed', {
        key: a.blobKey,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  // I testi originali conservati muoiono con i loro artefatti. La chiave
  // esterna li porterebbe via comunque, ma una cancellazione implicita non è
  // verificabile da un test: qui è esplicita.
  await prisma.postprodOriginalBody.deleteMany({ where: { recordingId } });
  const del = await prisma.postprodArtifact.deleteMany({ where: { recordingId } });
  await prisma.speaker.deleteMany({ where: { recordingId } });

  const tp = await purgeRecordingTracks(recordingId, eventId);
  blobsDeleted += tp.blobsDeleted;
  blobsFailed += tp.blobsFailed;

  await prisma.postprodJob.updateMany({
    where: { recordingId },
    data: { payload: { scrubbed: true }, lastError: null },
  });
  // I nomi dei parlanti copiati nello snapshot dei modelli se ne vanno con
  // le righe Speaker da cui venivano: resta la fotografia dei modelli.
  const snap = await prisma.recording.findUnique({
    where: { id: recordingId },
    select: { pipelineSnapshot: true },
  });
  const scrubbed = withoutSpeakerNames(snap?.pipelineSnapshot ?? null);
  await prisma.recording.update({
    where: { id: recordingId },
    data: {
      status: 'ARCHIVED',
      ...(scrubbed && scrubbed !== snap?.pipelineSnapshot
        ? { pipelineSnapshot: scrubbed as Prisma.InputJsonValue }
        : {}),
    },
  });
  return { blobsDeleted, blobsFailed, artifactsDeleted: del.count };
}

/**
 * True if the recording has a postprod job that still needs its raw inputs
 * (tracks/artifacts). Mirrors cron/multitrack-purge's guard: a re-run of the
 * multitrack transcription or a pending/running ARCHIVE reads the tracks, so
 * purging mid-job would yield an empty transcript or a degraded archive. We
 * defer the whole purge one tick when such a job is in flight.
 */
async function hasActivePostprodJob(recordingId: string): Promise<boolean> {
  const job = await prisma.postprodJob.findFirst({
    where: {
      recordingId,
      kind: { in: ['TRANSCRIBE_MULTITRACK', 'ARCHIVE'] },
      status: { in: ['PENDING', 'CLAIMED', 'RUNNING'] },
    },
    select: { id: true },
  });
  return job !== null;
}

export const GET = withErrorHandling(async (request) => {
  assertCronApiKey(request);

  if (!isPostprodStorageConfigured()) {
    return Response.json({ ok: true, skipped: true, reason: 'storage not configured' });
  }

  const now = new Date();

  // La scadenza della registrazione: via tutti i suoi output.
  const expired = await prisma.recording.findMany({
    where: {
      retentionUntil: { not: null, lt: now },
      status: { not: 'ARCHIVED' },
    },
    select: { id: true, eventId: true },
    take: 50, // bound the per-tick work
  });

  let blobsDeleted = 0;
  let blobsFailed = 0;
  let artifactsDeleted = 0;

  let deferredActiveJob = 0;
  for (const rec of expired) {
    if (await hasActivePostprodJob(rec.id)) {
      deferredActiveJob += 1;
      continue;
    }
    const r = await purgeRecordingArtifacts(rec.id, rec.eventId);
    blobsDeleted += r.blobsDeleted;
    blobsFailed += r.blobsFailed;
    artifactsDeleted += r.artifactsDeleted;
  }

  // Le tracce per persona alla conservazione dei dati dell'evento, per ogni
  // registrazione senza una scadenza propria: gli artefatti restano (la
  // registrazione non segue i dati dei partecipanti), la voce isolata no. Per
  // multitrack-purge le tracce non conservate se ne vanno gia' dopo la
  // trascrizione; qui quelle tenute (retainParticipantTracks) e quelle mai
  // trascritte. Prima gli eventi scaduti, poi le loro registrazioni: filtrare
  // dopo un `take` sulle registrazioni lascerebbe fuori quelle scadute ogni
  // volta che le prime appartengono a eventi ancora in conservazione.
  // `tracks: { some: {} }` esaurisce il giro: tolte le righe, la registrazione
  // non e' piu' scelta.
  let tracksPurged = 0;
  const eventiConTracce = await prisma.event.findMany({
    where: {
      status: { in: ['ENDED', 'ARCHIVED'] },
      endsAt: { lt: now },
      recordings: { some: { retentionUntil: null, tracks: { some: {} } } },
    },
    select: { id: true, endsAt: true, dataRetentionDays: true },
  });
  const eventiScaduti = eventiConTracce
    .filter((e) => isEventDataRetentionExpired(e, now))
    .map((e) => e.id);
  const conTracce =
    eventiScaduti.length === 0
      ? []
      : await prisma.recording.findMany({
          where: { eventId: { in: eventiScaduti }, retentionUntil: null, tracks: { some: {} } },
          select: { id: true, eventId: true },
          take: 50,
        });
  for (const rec of conTracce) {
    // Same active-job guard as the purge above: an in-flight ARCHIVE /
    // multitrack re-run still reads these tracks — defer a tick.
    if (await hasActivePostprodJob(rec.id)) {
      deferredActiveJob += 1;
      continue;
    }
    const tp = await purgeRecordingTracks(rec.id, rec.eventId);
    blobsDeleted += tp.blobsDeleted;
    blobsFailed += tp.blobsFailed;
    tracksPurged += 1;
  }

  // Also walk the global aiArtifactRetentionDays override (a single
  // site-wide N-days from artifact creation). 0 = disabled.
  const site = await prisma.siteSetting.findUnique({
    where: { id: 'singleton' },
    select: { aiArtifactRetentionDays: true },
  });
  const days = site?.aiArtifactRetentionDays ?? 0;
  let globalBlobsDeleted = 0;
  let globalArtifactsDeleted = 0;
  if (days > 0) {
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const old = await prisma.postprodArtifact.findMany({
      where: { createdAt: { lt: cutoff } },
      select: { id: true, blobKey: true },
      take: 200,
    });
    for (const a of old) {
      if (!a.blobKey) continue;
      try {
        await deletePostprodBlob(a.blobKey);
        globalBlobsDeleted += 1;
      } catch (err) {
        console.warn('[postprod-retention] global delete failed', {
          key: a.blobKey,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    const del = await prisma.postprodArtifact.deleteMany({
      where: { id: { in: old.map((a) => a.id) } },
    });
    globalArtifactsDeleted = del.count;
  }

  return Response.json({
    ok: true,
    expiredRecordings: expired.length,
    tracksPurged,
    deferredActiveJob,
    blobsDeleted,
    blobsFailed,
    artifactsDeleted,
    globalBlobsDeleted,
    globalArtifactsDeleted,
  });
});
