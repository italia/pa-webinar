/**
 * GET /api/admin/postprod/recordings/[id]/slides/file?m=<materialId>
 *
 * Il PDF di una slide per l'anteprima dello staff, prima e dopo la
 * pubblicazione del video: solo un materiale presentato nella sala
 * dell'evento che la pagina pubblica potrebbe mostrare (presente, PDF,
 * visibile dopo l'evento; lib/presentation/recording-slides-data). Non solo
 * quelli nel tempo di questo video: la correzione dell'allineamento che lo
 * staff sta provando può portarne dentro altri. Chi gestisce l'evento vede
 * comunque tutti i suoi materiali dall'area di amministrazione.
 *
 * Auth: chi gestisce l'evento della registrazione (ADR-014).
 */

import { cookies } from 'next/headers';

import { withErrorHandling } from '@/lib/api-handler';
import { requireRecordingManager } from '@/lib/auth/staff-session';
import { prisma } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import {
  RECORDING_SLIDES_SELECT,
  readRecordingSlides,
} from '@/lib/presentation/recording-slides-data';
import { streamMaterialPdf } from '@/lib/presentation/serve-pdf';
import { recordingSlidesFileQuerySchema } from '@/lib/validation/presentation';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (request, context) => {
  const { id } = (await context.params) as { id: string };
  await requireRecordingManager(await cookies(), id);

  const query = recordingSlidesFileQuerySchema.safeParse({
    m: new URL(request.url).searchParams.get('m') ?? undefined,
  });
  if (!query.success) throw new NotFoundError('Slides');

  const recording = await prisma.recording.findUnique({
    where: { id },
    select: RECORDING_SLIDES_SELECT,
  });
  if (!recording) throw new NotFoundError('Recording');

  const data = await readRecordingSlides(recording);
  const chiave = data.materials.find(
    (m) => m.id === query.data.m && m.problem === null
  )?.blobPath;
  if (!chiave) throw new NotFoundError('Slides');

  return streamMaterialPdf(chiave, 'admin/slides/file');
});
