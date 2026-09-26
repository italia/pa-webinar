/**
 * Chiude (POST) o annulla (DELETE) un caricamento a parti aperto da
 * POST /api/admin/publications/upload-url con protocollo `s3-multipart`.
 *
 * La chiusura non si fida del browser: il server rilegge le parti dallo
 * storage e ricompone l'oggetto solo se coprono esattamente `sizeBytes`,
 * altrimenti risponde 409 e il caricamento resta aperto. La chiusura si può
 * ripetere: se è già avvenuta e l'oggetto ha la dimensione dichiarata
 * risponde di nuovo 200. L'annullamento libera le parti già caricate, che
 * altrimenti restano a pagamento nel bucket finché una regola di ciclo di
 * vita non le rimuove; su un caricamento già chiuso non tocca l'oggetto.
 *
 * Accetta solo oggetti con la forma di quelli aperti dalla rotta sorella
 * (`publications/<anno>/<uuid>.<ext>`), mai una chiave qualsiasi delle
 * registrazioni.
 */

import { cookies } from 'next/headers';
import { z } from 'zod';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { requireStaff } from '@/lib/auth/staff-session';
import { AppError, ValidationError } from '@/lib/errors';
import { IncompleteUploadError } from '@/lib/storage/provider';
import {
  MAX_PUBLICATION_UPLOAD_BYTES,
  PUBLICATION_OBJECT_NAME_RE,
} from '@/lib/storage/publication-upload';
import {
  abortRecordingBrowserUpload,
  completeRecordingBrowserUpload,
  isRecordingStorageConfigured,
} from '@/lib/storage/recordings';

export const dynamic = 'force-dynamic';

const uploadRefSchema = z.object({
  objectName: z.string().regex(PUBLICATION_OBJECT_NAME_RE),
  uploadId: z.string().min(1).max(1024),
});

const completeSchema = uploadRefSchema.extend({
  sizeBytes: z.number().int().positive().max(MAX_PUBLICATION_UPLOAD_BYTES),
});

async function authorizeAndParse<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  // Stessa guardia della rotta che apre il caricamento (ADR-014).
  await requireStaff(await cookies());
  if (!isRecordingStorageConfigured()) {
    // Configurazione ammessa, non un guasto: `warn` nel log (vedi la rotta che
    // apre il caricamento).
    const err = new AppError('Recording storage not configured', 503, 'STORAGE_UNAVAILABLE');
    err.expected = true;
    throw err;
  }
  const parsed = schema.safeParse(await parseJsonBody(request));
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((i) => i.message).join(', '),
    );
  }
  return parsed.data;
}

export const POST = withErrorHandling(async (request) => {
  const { objectName, uploadId, sizeBytes } = await authorizeAndParse(
    request,
    completeSchema,
  );
  try {
    await completeRecordingBrowserUpload(objectName, { uploadId, sizeBytes });
  } catch (e) {
    if (e instanceof IncompleteUploadError) {
      throw new AppError(e.message, 409, 'UPLOAD_INCOMPLETE');
    }
    console.error('[publications/multipart] complete failed:', e);
    throw new AppError('Failed to complete upload', 502, 'STORAGE_ERROR');
  }
  return Response.json({ completed: true });
});

export const DELETE = withErrorHandling(async (request) => {
  const { objectName, uploadId } = await authorizeAndParse(request, uploadRefSchema);
  try {
    await abortRecordingBrowserUpload(objectName, uploadId);
  } catch (e) {
    console.error('[publications/multipart] abort failed:', e);
    throw new AppError('Failed to abort upload', 502, 'STORAGE_ERROR');
  }
  return new Response(null, { status: 204 });
});
