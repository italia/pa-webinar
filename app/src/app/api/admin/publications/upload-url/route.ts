/**
 * Apre il caricamento diretto dal browser di un video (MP4 / WebM / MOV /
 * M4V) nello storage delle registrazioni, senza passare dall'app: nessun
 * collo di bottiglia in uscita, nessun 5xx sui file grandi.
 *
 * Flusso:
 *   1. L'amministrazione (nuova pubblicazione o registrazione di un evento
 *      esistente) sceglie il file.
 *   2. POST qui con { filename, contentType, sizeBytes }: la risposta dice
 *      l'URL canonico (`recordingUrl`) e come caricare (`upload`), in base
 *      al fornitore configurato:
 *        - `azure-block`   blocchi Azure con l'SDK del browser (SAS);
 *        - `s3-put`        un PUT firmato, per i file fino a una parte;
 *        - `s3-multipart`  PUT firmati per parte, poi POST su
 *                          `./multipart` per chiudere (DELETE per annullare).
 *   3. Il client salva `recordingUrl` su /api/admin/publications (nuova
 *      pubblicazione) o con PATCH su /api/admin/publications/:id.
 *
 * Gli URL firmati valgono per un solo oggetto e 60 minuti: abbastanza per
 * l'esportazione di un'ora di riunione su una linea domestica, poco per
 * limitare il danno se un log con la firma finisce in giro.
 */

import { cookies } from 'next/headers';
import { z } from 'zod';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { requireStaff } from '@/lib/auth/staff-session';
import { AppError, ValidationError } from '@/lib/errors';
import {
  MAX_PUBLICATION_UPLOAD_BYTES,
  planPublicationObject,
} from '@/lib/storage/publication-upload';
import {
  createRecordingBrowserUpload,
  isRecordingStorageConfigured,
} from '@/lib/storage/recordings';

export const dynamic = 'force-dynamic';

const SAS_EXPIRY_MINUTES = 60;

const startUploadSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  // Il tipo rilevato dal browser; se non è un video ammesso vale
  // l'estensione (vedi planPublicationObject).
  contentType: z.string().max(100).optional(),
  sizeBytes: z.number().int().positive().max(MAX_PUBLICATION_UPLOAD_BYTES),
});

export const POST = withErrorHandling(async (request) => {
  // Anche l'organizzatore carica la registrazione dei propri eventi; il file
  // si aggancia all'evento con il PATCH di /publications/:id, che controlla
  // il proprietario (ADR-014).
  await requireStaff(await cookies());

  if (!isRecordingStorageConfigured()) {
    // Un'installazione senza storage delle registrazioni e' una
    // configurazione ammessa, non un guasto: 503 per il client, `warn` nel log.
    const err = new AppError('Recording storage not configured', 503, 'STORAGE_UNAVAILABLE');
    err.expected = true;
    throw err;
  }

  const parsed = startUploadSchema.safeParse(await parseJsonBody(request));
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((i) => i.message).join(', '),
    );
  }

  const { objectName, contentType } = planPublicationObject(
    parsed.data.filename,
    parsed.data.contentType,
  );
  const result = await createRecordingBrowserUpload(objectName, {
    contentType,
    sizeBytes: parsed.data.sizeBytes,
    expiresInMinutes: SAS_EXPIRY_MINUTES,
  });
  if (!result) {
    throw new AppError(
      'Unable to generate upload URL',
      500,
      'STORAGE_ERROR',
    );
  }

  return Response.json({
    recordingUrl: result.recordingUrl,
    objectName,
    contentType,
    expiresInSeconds: SAS_EXPIRY_MINUTES * 60,
    upload: result.upload,
  });
});
