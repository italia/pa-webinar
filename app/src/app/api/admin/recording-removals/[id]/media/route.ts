// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * GET /api/admin/recording-removals/[id]/media
 *
 * Il video della registrazione per l'editor di rimozione: un rinvio a un
 * indirizzo firmato di breve durata, solo in deroga (amministratore con un
 * account nominale, richiesta aperta) e tracciato a ogni apertura.
 */
import { cookies } from 'next/headers';

import { withErrorHandling } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth/staff-session';
import { registrazioneConVideo } from '@/lib/captions/transcript';
import { prisma } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import {
  registraAccessoInDeroga,
  richiestaInDeroga,
} from '@/lib/recording/redaction/access';
import {
  isPostprodStorageConfigured,
  presignArtifactDownload,
} from '@/lib/storage/postprod';

export const dynamic = 'force-dynamic';

/** Abbastanza per lavorare sugli intervalli; la pagina lo richiede se scade. */
const DURATA_MINUTI = 60;

export const GET = withErrorHandling(async (request, context) => {
  const { id } = await (context as { params: Promise<{ id: string }> }).params;
  const sessione = await requireAdmin(await cookies());
  const deroga = await richiestaInDeroga(sessione, id);
  const registrazione = await prisma.recording.findUnique({
    where: { id: deroga.recordingId },
    select: { blobKey: true },
  });
  if (!registrazione || !registrazioneConVideo(registrazione))
    throw new NotFoundError('Recording media');
  if (!isPostprodStorageConfigured()) throw new NotFoundError('Recording storage');
  const url = await presignArtifactDownload({
    blobKey: registrazione.blobKey,
    expiresInMinutes: DURATA_MINUTI,
  });
  await registraAccessoInDeroga(request, deroga, 'media');
  return new Response(null, {
    status: 302,
    headers: { Location: url, 'Cache-Control': 'no-store' },
  });
});
