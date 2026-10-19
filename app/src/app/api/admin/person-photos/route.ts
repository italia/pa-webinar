/**
 * POST /api/admin/person-photos — carica la foto di una persona dell'evento
 * (organizzatore principale, moderatore, relatore).
 *
 * La persona manda la foto a chi organizza, che la carica dal wizard mentre
 * crea o modifica l'evento. Il corpo è l'immagine (JPEG, PNG o WebP, già
 * ritagliata quadrata dal browser); il server la ricodifica in un JPEG di
 * PERSON_PHOTO_SIDE di lato senza metadati e la salva nel database
 * (EventPersonPhoto). Risponde 201 con l'id da scrivere sulla persona e il
 * percorso da cui si serve.
 *
 * La foto appena caricata non è ancora di nessun evento: la usa il salvataggio
 * del wizard. Se nessuno la usa, la pulizia periodica la toglie dopo qualche
 * giorno (cron/cleanup).
 *
 * Chi: lo staff (amministratore o organizzatore), come per le immagini
 * dell'evento. Il link di conduzione non basta.
 */

import { cookies } from 'next/headers';

import { readBodyBytes, withErrorHandling } from '@/lib/api-handler';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { requireStaff } from '@/lib/auth/staff-session';
import { AppError, RateLimitError } from '@/lib/errors';
import { MAX_PERSON_PHOTO_BYTES, personPhotoPath } from '@/lib/events/person-photo';
import { normalizePersonPhoto, savePersonPhoto } from '@/lib/events/person-photo-store';
import { getClientIp, rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(async (request) => {
  await requireStaff(await cookies());

  const rl = rateLimit(`person-photo:${getClientIp(request)}`, {
    limit: 30,
    windowMs: 60_000,
  });
  if (!rl.allowed) throw new RateLimitError((rl.resetAt - Date.now()) / 1000);

  let bytes: Uint8Array;
  try {
    bytes = await readBodyBytes(request, MAX_PERSON_PHOTO_BYTES);
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 413) {
      throw new AppError('Photo too large', 413, 'PHOTO_TOO_LARGE');
    }
    throw err;
  }
  const jpeg = bytes.length > 0 ? await normalizePersonPhoto(bytes) : null;
  if (!jpeg)
    throw new AppError('Not a readable JPEG, PNG or WebP image', 422, 'PHOTO_INVALID');

  const id = await savePersonPhoto(jpeg);
  await logAdminAction({
    request,
    action: 'PERSON_PHOTO_UPLOAD',
    target: id,
    details: { size: jpeg.byteLength },
  });
  return Response.json({ id, url: personPhotoPath(id) }, { status: 201 });
});
