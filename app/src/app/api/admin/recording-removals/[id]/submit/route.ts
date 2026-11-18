// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * POST /api/admin/recording-removals/[id]/submit
 *
 * Lo staff conferma gli intervalli in cui la persona compare o parla, in
 * secondi dall'inizio del video. Con un video serve almeno un intervallo: il
 * lavoro di rimozione va in coda (worker senza GPU) e la richiesta passa in
 * elaborazione; la chiude la consegna del video ripulito. Una persona che nel
 * video non compare si respinge con il motivo, non si chiude come tolta.
 * Senza video (solo tracce per persona) la rimozione si applica subito: le
 * tracce e le frasi della persona se ne vanno e la post-produzione riparte.
 * Una rimozione alla volta per registrazione: la seconda partirebbe dal video
 * che la prima sta per sostituire. In deroga, come le altre rotte dell'editor.
 */
import { cookies } from 'next/headers';
import { z } from 'zod';

import { parseJsonBody, withErrorHandling } from '@/lib/api-handler';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { requireAdmin } from '@/lib/auth/staff-session';
import { registrazioneConVideo } from '@/lib/captions/transcript';
import { prisma } from '@/lib/db';
import { AppError, ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { TIMEOUT_DOPO_PULIZIA_MS } from '@/lib/gdpr/cleanup-selection';
import { richiestaInDeroga } from '@/lib/recording/redaction/access';
import {
  applicaRimozione,
  cancellaFileDellaRimozione,
} from '@/lib/recording/redaction/apply';
import {
  MASSIMO_INTERVALLI,
  secondiCoperti,
  unisciIntervalli,
} from '@/lib/recording/redaction/intervals';
import { accodaRimozione } from '@/lib/recording/redaction/job';
import { isPostprodStorageConfigured } from '@/lib/storage/postprod';

export const dynamic = 'force-dynamic';

const corpoSchema = z
  .object({
    intervals: z
      .array(
        z
          .object({ start: z.number().finite().min(0), end: z.number().finite().min(0) })
          .strict()
      )
      .max(MASSIMO_INTERVALLI),
  })
  .strict();

export const POST = withErrorHandling(async (request, context) => {
  const { id } = await (context as { params: Promise<{ id: string }> }).params;
  const sessione = await requireAdmin(await cookies());
  const deroga = await richiestaInDeroga(sessione, id);
  const parsed = corpoSchema.safeParse(await parseJsonBody(request, 64 * 1024));
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message }))
    );
  }
  const registrazione = await prisma.recording.findUnique({
    where: { id: deroga.recordingId },
    select: { id: true, blobKey: true, durationSec: true, sourceLanguage: true },
  });
  if (!registrazione) throw new NotFoundError('Recording');
  // Nessun taglio sulla durata salvata, che puo' essere sottostimata: lo
  // staff segna sul video vero, e il worker taglia sulla durata del file.
  const intervalli = unisciIntervalli(
    parsed.data.intervals.filter((i) => i.end > i.start)
  );
  const conVideo = registrazioneConVideo(registrazione);
  if (!isPostprodStorageConfigured()) {
    throw new AppError(
      'Recording storage is not configured',
      409,
      'STORAGE_NOT_CONFIGURED'
    );
  }
  if (conVideo && intervalli.length === 0) {
    throw new AppError(
      'A recording with a video needs at least one interval to cover; reject the request if the person does not appear in it',
      422,
      'NO_INTERVALS'
    );
  }

  if (conVideo) {
    await prisma.$transaction(
      async (tx) => {
        const richiesta = await tx.recordingRedactionRequest.findUnique({
          where: { id },
          select: { id: true, eventId: true, status: true },
        });
        if (
          !richiesta ||
          (richiesta.status !== 'OPEN' && richiesta.status !== 'IN_PROGRESS')
        ) {
          throw new ConflictError('The removal request is not waiting for intervals');
        }
        // La riga della registrazione bloccata: due invii insieme sulla stessa
        // registrazione passano uno alla volta, e il secondo vede il primo.
        await tx.$queryRaw`SELECT id FROM recordings WHERE id = ${registrazione.id}::uuid FOR UPDATE`;
        const altra = await tx.recordingRedactionRequest.count({
          where: { recordingId: registrazione.id, status: 'PROCESSING', id: { not: id } },
        });
        if (altra > 0) {
          throw new AppError(
            'Another removal from this recording is being processed: send this one when it is done',
            409,
            'REDACTION_IN_PROGRESS'
          );
        }
        const jobId = await accodaRimozione(tx, richiesta, registrazione, intervalli);
        const n = await tx.recordingRedactionRequest.updateMany({
          where: { id, status: { in: ['OPEN', 'IN_PROGRESS'] } },
          data: {
            status: 'PROCESSING',
            jobId,
            intervals: intervalli.map((i) => ({ start: i.start, end: i.end })),
            submittedAt: new Date(),
            startedAt: richiesta.status === 'OPEN' ? new Date() : undefined,
            lastError: null,
          },
        });
        if (n.count === 0)
          throw new ConflictError('The removal request changed meanwhile');
      },
      { timeout: TIMEOUT_DOPO_PULIZIA_MS }
    );
    await logAdminAction({
      request,
      action: 'RECORDING_REDACTION_SUBMIT',
      target: deroga.recordingId,
      details: {
        requestId: id,
        intervals: intervalli.length,
        seconds: secondiCoperti(intervalli),
        video: true,
      },
      actor: `admin:${deroga.accountId}`,
    });
    return Response.json({ status: 'PROCESSING' });
  }

  const esito = await prisma.$transaction(
    async (tx) => {
      const richiesta = await tx.recordingRedactionRequest.findUnique({
        where: { id },
        select: {
          id: true,
          eventId: true,
          recordingId: true,
          registrationId: true,
          seatIds: true,
          endpointIds: true,
        },
      });
      if (!richiesta) throw new NotFoundError('Removal request');
      return applicaRimozione(tx, richiesta, [], null);
    },
    { timeout: TIMEOUT_DOPO_PULIZIA_MS }
  );
  const file = await cancellaFileDellaRimozione(esito.file);
  await logAdminAction({
    request,
    action: 'RECORDING_REDACTION_SUBMIT',
    target: deroga.recordingId,
    details: { requestId: id, intervals: 0, seconds: 0, video: false },
    actor: `admin:${deroga.accountId}`,
  });
  const { file: _file, ...numeri } = esito;
  return Response.json({ status: 'CLOSED', ...numeri, filesNotDeleted: file.failed });
});
