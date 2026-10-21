/**
 * POST /api/internal/event-text-translation
 *
 * Le traduzioni di titolo e descrizione consegnate dal worker (lavoro
 * TRANSLATE_TEXT, lib/text-translation): un testo per lingua. Le lingue
 * devono essere fra quelle chieste; i testi si normalizzano (il titolo tiene
 * al piu' il «|» del sopratitolo) e restano sull'evento come versione
 * automatica (Event.textTranslations). Se il testo principale e' ancora
 * quello tradotto, vanno anche in titolo e descrizione, nelle lingue vuote o
 * gia' tradotte in automatico: mai sopra il testo di una persona. Il lavoro si
 * chiude nella stessa transazione: e' concluso solo se la traduzione e'
 * salvata, e vale solo la consegna del claim corrente (lib/report/job).
 *
 * Dopo, il server guarda di nuovo le lingue dell'evento: un testo principale
 * cambiato nel frattempo, o una lingua aggiunta, chiedono un'altra traduzione.
 *
 * Auth: CRON_API_KEY (header x-api-key), come gli altri endpoint /internal.
 */
import { z } from 'zod';

import { parseJsonBody, withErrorHandling } from '@/lib/api-handler';
import { translateTextPayloadSchema } from '@/lib/ai/schemas';
import { assertCronApiKey } from '@/lib/auth/cron';
import { prisma } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { postprodJobDurationSeconds, postprodJobsCompletedTotal } from '@/lib/metrics';
import { consegnaLavoroEvento, statoLavoroEvento } from '@/lib/report/job';
import { riconciliaTraduzioni } from '@/lib/text-translation/auto';
import { applicaTraduzioni, salvaTraduzioni } from '@/lib/text-translation/enqueue';
import {
  DESCRIZIONE_TRADOTTA_MAX,
  TITOLO_TRADOTTO_MAX,
} from '@/lib/text-translation/proposals';

export const dynamic = 'force-dynamic';

const lingua = z.string().regex(/^[a-z]{2,3}(-[a-z]{2,4})?$/);

const corpoSchema = z.object({
  jobId: z.string().uuid(),
  title: z.record(lingua, z.string().max(TITOLO_TRADOTTO_MAX * 2)).default({}),
  description: z.record(lingua, z.string().max(DESCRIZIONE_TRADOTTA_MAX * 2)).default({}),
  modelId: z.string().max(200).nullish(),
  modelVersion: z.string().max(200).nullish(),
  /** Il numero del claim che consegna: vale solo se e' ancora quello del lavoro (lib/report/job). */
  attempt: z.number().int().min(1).optional(),
});

export const POST = withErrorHandling(async (request) => {
  assertCronApiKey(request);
  // Titolo e descrizione in al piu' 24 lingue: qualche centinaio di KB, di
  // piu' negli alfabeti con caratteri di due byte.
  const parsed = corpoSchema.safeParse(await parseJsonBody(request, 2 * 1024 * 1024));
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message }))
    );
  }
  const { jobId, title, description, modelId, modelVersion, attempt } = parsed.data;

  const lavoro = await prisma.postprodJob.findUnique({
    where: { id: jobId },
    select: { kind: true, status: true, payload: true, startedAt: true },
  });
  if (!lavoro || lavoro.kind !== 'TRANSLATE_TEXT')
    throw new NotFoundError('Text translation job');
  if (lavoro.status === 'DONE')
    return Response.json({ ok: true, alreadyDelivered: true });
  if (lavoro.status === 'FAILED')
    return Response.json({ ok: false, closed: true, status: 'FAILED' });
  if (!attempt)
    throw new ConflictError(
      'The delivery of a text translation needs the claim attempt number'
    );
  const payload = translateTextPayloadSchema.parse(lavoro.payload);

  // Solo le lingue chieste: un worker che ne manda altre ha un difetto, e lo
  // si dice invece di salvarle.
  const chieste = new Set(payload.targetLanguages);
  const estranee = [...Object.keys(title), ...Object.keys(description)].filter(
    (l) => !chieste.has(l)
  );
  if (estranee.length > 0) {
    throw new ValidationError(
      `Languages not requested by the job: ${[...new Set(estranee)].join(', ')}`
    );
  }

  const esito = await prisma.$transaction(async (tx) => {
    const chiuso = await consegnaLavoroEvento(jobId, attempt, 'TRANSLATE_TEXT', tx);
    if (chiuso === null) return null;
    const salvata = await salvaTraduzioni(
      {
        eventId: payload.eventId,
        sourceLanguage: payload.sourceLanguage,
        sourceHash: payload.sourceHash,
        sourceTitle: payload.title,
        title,
        description,
        modelId: modelId ?? null,
        modelVersion: modelVersion ?? null,
      },
      tx
    );
    if (!salvata) throw new NotFoundError('Event');
    return applicaTraduzioni(
      {
        eventId: payload.eventId,
        sourceLanguage: payload.sourceLanguage,
        sourceHash: payload.sourceHash,
        targetLanguages: payload.targetLanguages,
        proposta: salvata,
        modelId: modelId ?? null,
      },
      tx
    );
  });
  if (!esito) {
    // Chiuso nel frattempo da un altro tentativo, o superato da un claim
    // successivo: chi consegna lo legge e si ferma.
    const ora = await statoLavoroEvento(jobId, attempt);
    if (ora.status === 'DONE') return Response.json({ ok: true, alreadyDelivered: true });
    if (ora.status === 'FAILED')
      return Response.json({ ok: false, closed: true, status: 'FAILED' });
    if (ora.superseded) return Response.json({ ok: false, superseded: true });
    throw new ConflictError('The text translation job cannot be delivered');
  }
  postprodJobsCompletedTotal.labels('TRANSLATE_TEXT', 'DONE').inc();
  const secondi = lavoro.startedAt ? (Date.now() - lavoro.startedAt.getTime()) / 1000 : 0;
  if (secondi > 0) postprodJobDurationSeconds.labels('TRANSLATE_TEXT').observe(secondi);
  // Un testo principale cambiato mentre si traduceva, o lingue aggiunte:
  // un'altra traduzione, sul testo di adesso.
  await riconciliaTraduzioni(payload.eventId, { request, actor: 'system', dopoConsegna: true });
  return Response.json({
    ok: true,
    languages: [...new Set([...Object.keys(title), ...Object.keys(description)])].sort(),
    applied: esito.applicate,
    ...(esito.superata && { stale: true }),
  });
});
