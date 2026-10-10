/**
 * POST /api/internal/event-report
 *
 * Il resoconto dell'evento consegnato dal worker (lavoro REPORT): il testo per
 * lingua. Si normalizza (lib/report/normalize), si unisce ai numeri calcolati
 * al claim e si congela sull'evento, non pubblicato. Il worker chiude poi il
 * lavoro con postprod-progress.
 *
 * Auth: CRON_API_KEY (header x-api-key), come gli altri endpoint /internal.
 */
import { z } from 'zod';

import { parseJsonBody, withErrorHandling } from '@/lib/api-handler';
import { reportPayloadSchema } from '@/lib/ai/schemas';
import { assertCronApiKey } from '@/lib/auth/cron';
import { prisma } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { salvaResoconto } from '@/lib/report/enqueue';
import type { ReportMetrics } from '@/lib/report/types';

export const dynamic = 'force-dynamic';

const corpoSchema = z.object({
  jobId: z.string().uuid(),
  narratives: z.record(z.string().min(2).max(10), z.unknown()),
  modelId: z.string().max(200).nullish(),
  modelVersion: z.string().max(200).nullish(),
});

export const POST = withErrorHandling(async (request) => {
  assertCronApiKey(request);
  // Un resoconto e le sue traduzioni: qualche centinaio di KB al massimo.
  const parsed = corpoSchema.safeParse(await parseJsonBody(request, 4 * 1024 * 1024));
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }
  const { jobId, narratives, modelId, modelVersion } = parsed.data;

  const lavoro = await prisma.postprodJob.findUnique({
    where: { id: jobId },
    select: { kind: true, status: true, payload: true },
  });
  if (!lavoro || lavoro.kind !== 'REPORT') throw new NotFoundError('Report job');
  if (lavoro.status !== 'CLAIMED' && lavoro.status !== 'RUNNING') {
    throw new ConflictError(`Report job is ${lavoro.status}`);
  }
  const payload = reportPayloadSchema.parse(lavoro.payload);
  // I numeri si tolgono alla prima consegna: una seconda (dopo un lease
  // scaduto e ripreso) non deve sostituire il resoconto con uno senza.
  if (!payload.metrics) throw new ConflictError('The report of this job was already delivered');

  const resoconto = await salvaResoconto({
    eventId: payload.eventId,
    sourceLanguage: payload.sourceLanguage,
    metrics: payload.metrics as ReportMetrics,
    narratives,
    modelId: modelId ?? null,
    modelVersion: modelVersion ?? null,
  });
  if (!resoconto) {
    throw new ValidationError('The report has no usable text in the source language');
  }
  // I numeri ora stanno sul resoconto: il lavoro non ne tiene una copia.
  await prisma.postprodJob.update({
    where: { id: jobId },
    data: {
      payload: {
        eventId: payload.eventId,
        sourceLanguage: payload.sourceLanguage,
        targetLanguages: payload.targetLanguages,
      },
    },
  });
  return Response.json({ ok: true, languages: Object.keys(resoconto.narratives) });
});
