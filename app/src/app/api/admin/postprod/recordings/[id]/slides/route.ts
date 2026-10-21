/**
 * GET/PATCH /api/admin/postprod/recordings/[id]/slides
 *
 * Le slide presentate in sala accanto al video di questa registrazione, sulla
 * pagina pubblica dell'evento (lib/presentation/recording-slides-data).
 *
 *   GET   — le scelte (mostrarle, scarto in secondi), i fatti della
 *           presentazione sullo zero del video, se lo zero è esatto o
 *           stimato, i materiali presentati con il motivo per cui uno non si
 *           mostra, se questo video è quello pubblicato sulla pagina
 *           dell'evento e se la pagina mostra i materiali. L'anteprima del pannello ricalcola i tratti da qui a
 *           ogni correzione dello scarto, senza salvare.
 *   PATCH — `{ enabled?, offsetSec? }` (Zod). Audit log.
 *
 * Auth: chi gestisce l'evento della registrazione (ADR-014).
 */

import { cookies } from 'next/headers';

import { parseJsonBody, withErrorHandling } from '@/lib/api-handler';
import { requireRecordingManager } from '@/lib/auth/staff-session';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { registrazioneConVideo } from '@/lib/captions/transcript';
import { prisma } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import {
  RECORDING_SLIDES_SELECT,
  readRecordingSlides,
} from '@/lib/presentation/recording-slides-data';
import { recordingSlidesSettingsSchema } from '@/lib/validation/presentation';

export const dynamic = 'force-dynamic';

const nessunaCache = { 'Cache-Control': 'private, no-store' };

function idDa(context: { params: Promise<unknown> }): Promise<{ id: string }> {
  return context.params as Promise<{ id: string }>;
}

/** Dove il pannello legge il PDF per l'anteprima. */
function fileUrlStaff(recordingId: string, materialId: string): string {
  return `/api/admin/postprod/recordings/${recordingId}/slides/file?m=${encodeURIComponent(materialId)}`;
}

export const GET = withErrorHandling(async (_request, context) => {
  const { id } = await idDa(context);
  await requireRecordingManager(await cookies(), id);

  const recording = await prisma.recording.findUnique({
    where: { id },
    select: {
      ...RECORDING_SLIDES_SELECT,
      callSession: { select: { endedAt: true, recordingUrl: true } },
      event: {
        select: {
          slug: true,
          recordingUrl: true,
          recordingPublished: true,
          postEventShowMaterials: true,
        },
      },
    },
  });
  if (!recording) throw new NotFoundError('Recording');

  const data = await readRecordingSlides(recording);
  const conVideo = registrazioneConVideo(recording);
  // Il video della pagina pubblica è questo: lo stesso file della sessione.
  const videoDellEvento =
    !!recording.event.recordingUrl &&
    recording.callSession?.recordingUrl === recording.event.recordingUrl;

  return Response.json(
    {
      enabled: recording.slidesEnabled,
      offsetSec: recording.slidesOffsetSec,
      exactZero: data.exactZero,
      // La durata con cui si tagliano i tratti (anche senza quella del file).
      durationSec: data.durationSec,
      hasVideo: conVideo,
      isEventVideo: videoDellEvento,
      eventVideoPublished: recording.event.recordingPublished,
      // Le slide sono materiali: con la sezione spenta la pagina non le mostra.
      eventShowsMaterials: recording.event.postEventShowMaterials,
      eventSlug: recording.event.slug,
      mediaUrl: conVideo ? `/api/admin/postprod/recordings/${id}/media` : null,
      marks: data.marks,
      materials: data.materials.map((m) => ({
        id: m.id,
        title: m.title,
        problem: m.problem,
        fileUrl: m.problem === null ? fileUrlStaff(id, m.id) : null,
      })),
    },
    { headers: nessunaCache }
  );
});

export const PATCH = withErrorHandling(async (request, context) => {
  const { id } = await idDa(context);
  await requireRecordingManager(await cookies(), id);

  const parsed = recordingSlidesSettingsSchema.safeParse(await parseJsonBody(request));
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message }))
    );
  }

  // Una registrazione che non c'è: Prisma risponde P2025, cioè 404.
  const updated = await prisma.recording.update({
    where: { id },
    data: {
      ...(parsed.data.enabled !== undefined && { slidesEnabled: parsed.data.enabled }),
      ...(parsed.data.offsetSec !== undefined && {
        slidesOffsetSec: parsed.data.offsetSec,
      }),
    },
    select: { slidesEnabled: true, slidesOffsetSec: true },
  });

  await logAdminAction({
    request,
    action: 'POSTPROD_SLIDES_UPDATE',
    target: id,
    details: { ...parsed.data },
  });

  return Response.json(
    { enabled: updated.slidesEnabled, offsetSec: updated.slidesOffsetSec },
    { headers: nessunaCache }
  );
});
