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
import { consegnaResoconto, statoResoconto } from '@/lib/report/job';
import { postprodJobDurationSeconds, postprodJobsCompletedTotal } from '@/lib/metrics';
import type { ReportMetrics } from '@/lib/report/types';

export const dynamic = 'force-dynamic';

const corpoSchema = z.object({
  jobId: z.string().uuid(),
  narratives: z.record(z.string().min(2).max(10), z.unknown()),
  modelId: z.string().max(200).nullish(),
  modelVersion: z.string().max(200).nullish(),
  /** Il numero del claim che consegna: vale solo se e' ancora quello del lavoro (lib/report/job). */
  attempt: z.number().int().min(1).optional(),
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
  const { jobId, narratives, modelId, modelVersion, attempt } = parsed.data;

  const lavoro = await prisma.postprodJob.findUnique({
    where: { id: jobId },
    select: { kind: true, status: true, payload: true, startedAt: true },
  });
  if (!lavoro || lavoro.kind !== 'REPORT') throw new NotFoundError('Report job');
  // Concluso vuol dire consegnato (lib/report/job): una seconda consegna dello
  // stesso lavoro, dopo un lease scaduto e ripreso, lascia il primo resoconto.
  if (lavoro.status === 'DONE') return Response.json({ ok: true, alreadyDelivered: true });
  // Fallito (per esempio dal recupero dei lavori bloccati): il worker lo legge e si ferma.
  if (lavoro.status === 'FAILED') return Response.json({ ok: false, closed: true, status: 'FAILED' });
  if (!attempt) throw new ConflictError('The delivery of a report needs the claim attempt number');
  const payload = reportPayloadSchema.parse(lavoro.payload);

  // I numeri si prendono, il lavoro si chiude e il resoconto si salva nella
  // stessa transazione: se il testo non e' utilizzabile tutto si annulla e il
  // lavoro resta aperto con i suoi numeri.
  const resoconto = await prisma.$transaction(async (tx) => {
    const numeri = await consegnaResoconto(jobId, attempt, tx);
    if (numeri === null) return null;
    const salvato = await salvaResoconto(
      {
        eventId: payload.eventId,
        sourceLanguage: payload.sourceLanguage,
        metrics: numeri as unknown as ReportMetrics,
        narratives,
        modelId: modelId ?? null,
        modelVersion: modelVersion ?? null,
      },
      tx,
    );
    if (!salvato) throw new ValidationError('The report has no usable text in the source language');
    return salvato;
  });
  if (!resoconto) {
    // Chiuso nel frattempo da un altro tentativo, o superato da un claim
    // successivo: chi consegna lo legge e si ferma.
    const ora = await statoResoconto(jobId, attempt);
    if (ora.status === 'DONE') return Response.json({ ok: true, alreadyDelivered: true });
    if (ora.status === 'FAILED') return Response.json({ ok: false, closed: true, status: 'FAILED' });
    if (ora.superseded) return Response.json({ ok: false, superseded: true });
    throw new ConflictError('The report job has no figures to deliver');
  }
  postprodJobsCompletedTotal.labels('REPORT', 'DONE').inc();
  const secondi = lavoro.startedAt ? (Date.now() - lavoro.startedAt.getTime()) / 1000 : 0;
  if (secondi > 0) postprodJobDurationSeconds.labels('REPORT').observe(secondi);
  return Response.json({ ok: true, languages: Object.keys(resoconto.narratives) });
});
