// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * POST /api/internal/recording-redaction
 *
 * Il video ripulito consegnato dal worker (lavoro REDACT): e' gia' caricato
 * nella chiave del lavoro, e qui prende il posto dell'originale. Nella stessa
 * transazione il lavoro si chiude come concluso (vale solo il claim che ha il
 * lease, lib/report/job) e la rimozione si completa (lib/recording/redaction/
 * apply): tracce della persona, frasi dei sottotitoli, esiti della
 * post-produzione da rifare, richiesta chiusa, registro GDPR. Dopo il commit
 * si cancellano i file: il video originale, le tracce, i file delle run
 * precedenti.
 *
 * Se nel frattempo la registrazione ha un altro video, il lavoro si chiude
 * come fallito e il file caricato si cancella: la richiesta torna allo staff.
 *
 * Auth: CRON_API_KEY (header x-api-key), come gli altri endpoint /internal.
 */
import { z } from 'zod';

import { parseJsonBody, withErrorHandling } from '@/lib/api-handler';
import { redactPayloadSchema } from '@/lib/ai/schemas';
import { assertCronApiKey } from '@/lib/auth/cron';
import { prisma } from '@/lib/db';
import { NotFoundError, ValidationError, ConflictError } from '@/lib/errors';
import { TIMEOUT_DOPO_PULIZIA_MS } from '@/lib/gdpr/cleanup-selection';
import { postprodJobDurationSeconds, postprodJobsCompletedTotal } from '@/lib/metrics';
import {
  applicaRimozione,
  cancellaFileDellaRimozione,
  type EsitoRimozione,
} from '@/lib/recording/redaction/apply';
import { unisciIntervalli } from '@/lib/recording/redaction/intervals';
import { MOTIVO_VIDEO_CAMBIATO } from '@/lib/recording/redaction/job';
import { riapriRichiesteSenzaLavoro } from '@/lib/recording/redaction/requests';
import { consegnaLavoroEvento, statoLavoroEvento } from '@/lib/report/job';
import { getRecordingsStorage } from '@/lib/storage';

export const dynamic = 'force-dynamic';

const corpoSchema = z.object({
  jobId: z.guid(),
  /** Il numero del claim che consegna: vale solo se e' ancora quello del lavoro. */
  attempt: z.number().int().min(1),
  blobKey: z.string().min(1).max(1024),
  sizeBytes: z.number().int().min(0).nullish(),
  /** La durata del video ripulito, letta dal worker: gli intervalli si registrano tagliati su questa. */
  durationSec: z.number().finite().positive().nullish(),
});

type Esito =
  | { tipo: 'fatto'; rimozione: EsitoRimozione }
  | { tipo: 'video-cambiato' }
  | { tipo: 'niente' };

export const POST = withErrorHandling(async (request) => {
  assertCronApiKey(request);
  const parsed = corpoSchema.safeParse(await parseJsonBody(request, 16 * 1024));
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message }))
    );
  }
  const { jobId, attempt, blobKey, sizeBytes, durationSec } = parsed.data;

  const lavoro = await prisma.postprodJob.findUnique({
    where: { id: jobId },
    select: { kind: true, status: true, payload: true, startedAt: true },
  });
  if (!lavoro || lavoro.kind !== 'REDACT') throw new NotFoundError('Removal job');
  if (lavoro.status === 'DONE')
    return Response.json({ ok: true, alreadyDelivered: true });
  if (lavoro.status === 'FAILED')
    return Response.json({ ok: false, closed: true, status: 'FAILED' });
  const payload = redactPayloadSchema.parse(lavoro.payload);
  if (blobKey !== payload.targetKey)
    throw new ValidationError('The video was uploaded to another key');

  const esito = await prisma.$transaction(
    async (tx): Promise<Esito> => {
      // La riga della registrazione resta bloccata fino al commit: due consegne
      // sulla stessa registrazione (due richieste) passano una alla volta, e la
      // seconda trova il video cambiato invece di scrivere sopra la prima.
      const [registrazione] = await tx.$queryRaw<Array<{ blob_key: string }>>`
      SELECT blob_key FROM recordings WHERE id = ${payload.recordingId}::uuid FOR UPDATE
    `;
      if (!registrazione || registrazione.blob_key !== payload.sourceKey) {
        const chiusi = await tx.$executeRaw`
        UPDATE postprod_jobs
        SET status = 'FAILED', completed_at = NOW(), leased_at = NULL, leased_by = NULL,
            last_error = ${MOTIVO_VIDEO_CAMBIATO}, updated_at = NOW()
        WHERE id = ${jobId}::uuid AND status IN ('PENDING', 'CLAIMED', 'RUNNING') AND attempts = ${attempt}
      `;
        return chiusi > 0 ? { tipo: 'video-cambiato' } : { tipo: 'niente' };
      }
      if ((await consegnaLavoroEvento(jobId, attempt, 'REDACT', tx)) === null)
        return { tipo: 'niente' };
      const richiesta = await tx.recordingRedactionRequest.findUnique({
        where: { id: payload.requestId },
        select: {
          id: true,
          eventId: true,
          recordingId: true,
          registrationId: true,
          seatIds: true,
          endpointIds: true,
          jobId: true,
        },
      });
      if (!richiesta || richiesta.jobId !== jobId)
        throw new ConflictError('The removal request no longer waits for this job');
      const intervalli = durationSec
        ? unisciIntervalli(payload.intervals, durationSec)
        : payload.intervals;
      const rimozione = await applicaRimozione(tx, richiesta, intervalli, {
        blobKey,
        sizeBytes: sizeBytes ?? null,
      });
      return { tipo: 'fatto', rimozione };
    },
    { timeout: TIMEOUT_DOPO_PULIZIA_MS }
  );

  if (esito.tipo === 'video-cambiato') {
    postprodJobsCompletedTotal.labels('REDACT', 'FAILED').inc();
    await riapriRichiesteSenzaLavoro(prisma, jobId);
    // Il file caricato non serve a nessuno.
    await getRecordingsStorage()
      ?.delete(blobKey)
      .catch(() => false);
    return Response.json({ ok: false, closed: true, status: 'FAILED' });
  }
  if (esito.tipo === 'niente') {
    // Chiuso nel frattempo da un altro tentativo, o superato da un claim successivo.
    const ora = await statoLavoroEvento(jobId, attempt);
    if (ora.status === 'DONE') return Response.json({ ok: true, alreadyDelivered: true });
    if (ora.status === 'FAILED')
      return Response.json({ ok: false, closed: true, status: 'FAILED' });
    return Response.json({ ok: false, superseded: true });
  }

  postprodJobsCompletedTotal.labels('REDACT', 'DONE').inc();
  const secondi = lavoro.startedAt ? (Date.now() - lavoro.startedAt.getTime()) / 1000 : 0;
  if (secondi > 0) postprodJobDurationSeconds.labels('REDACT').observe(secondi);
  const file = await cancellaFileDellaRimozione(esito.rimozione.file);
  const { file: _file, ...numeri } = esito.rimozione;
  return Response.json({
    ok: true,
    ...numeri,
    filesDeleted: file.deleted,
    filesNotDeleted: file.failed,
  });
});
