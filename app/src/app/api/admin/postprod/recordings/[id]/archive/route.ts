/**
 * POST /api/admin/postprod/recordings/[id]/archive
 *
 * Genera (on-demand) l'archivio scaricabile multi-traccia: un MKV con
 * il video Jibri + una traccia audio per-partecipante (etichettata col
 * nome, allineata via cross-correlazione) + i sottotitoli VTT embedded.
 *
 * Additivo: NON tocca runCount né lo stato della registrazione. Accoda
 * un singolo job ARCHIVE (idempotente) che dipende dal job che ha
 * prodotto il transcript. Vedi enqueueArchiveJob.
 *
 * L'audio isolato per-partecipante è PII sensibile → l'archivio è
 * scaricabile solo da admin/moderatore (mai esposto pubblicamente).
 */

import { cookies } from 'next/headers';

import { withErrorHandling } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { enqueueArchiveJob } from '@/lib/ai/enqueue';
import { prisma } from '@/lib/db';
import { NotFoundError, UnauthorizedError, ValidationError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(async (request, context) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const { id } = await (context as { params: Promise<{ id: string }> }).params;

  const site = await prisma.siteSetting.findUnique({
    where: { id: 'singleton' },
    select: { aiPipelineEnabled: true },
  });
  if (!site?.aiPipelineEnabled) {
    throw new ValidationError(
      'AI pipeline is currently disabled (SiteSetting.aiPipelineEnabled=false).',
    );
  }

  const recording = await prisma.recording.findUnique({
    where: { id },
    select: {
      id: true,
      _count: {
        select: {
          tracks: { where: { audioPurgedAt: null } },
        },
      },
    },
  });
  if (!recording) throw new NotFoundError('Recording');

  // Senza tracce ancora presenti l'archivio non avrebbe le tracce audio
  // separate (solo video+sottotitoli) → blocchiamo con un errore chiaro
  // invece di produrre un archivio degradato a sorpresa.
  // NB: la trascrizione NON è richiesta — l'archivio si genera comunque
  // senza sottotitoli (subtitle_path è opzionale nel worker), quindi non
  // imponiamo un TRANSCRIPT_JSON qui.
  if (recording._count.tracks === 0) {
    throw new ValidationError(
      'No participant tracks available for this recording (none recorded, or already purged). Enable multi-track recording + track retention before the event.',
    );
  }

  const result = await prisma.$transaction((tx) =>
    enqueueArchiveJob(tx, { recordingId: recording.id }),
  );

  await logAdminAction({
    request,
    action: 'POSTPROD_ARCHIVE',
    target: id,
    details: { enqueued: result.enqueued, jobId: result.jobId },
  });

  return Response.json({ ok: true, ...result });
});
