// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * GET /api/admin/recording-removals/[id]
 *
 * Una richiesta di rimozione per l'amministrazione: chi, quale registrazione,
 * stato, intervalli proposti e confermati, cosa la rimozione non raggiunge
 * (una copia esterna, un video pubblicato che e' un altro file). Solo
 * metadati: il contenuto della registrazione si apre dalle rotte dell'editor,
 * in deroga (`accessAllowed`).
 */
import { cookies } from 'next/headers';

import { withErrorHandling } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth/staff-session';
import { prisma } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { derogaPerRimozione } from '@/lib/recording/redaction/access';
import { leggiRichiesta, vistaRichiesta } from '@/lib/recording/redaction/requests';
import { getRecordingsStorage } from '@/lib/storage';
import { isPostprodStorageConfigured } from '@/lib/storage/postprod';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withErrorHandling(async (_request, context) => {
  const { id } = await (context as { params: Promise<{ id: string }> }).params;
  const sessione = await requireAdmin(await cookies());
  if (!UUID_RE.test(id)) throw new NotFoundError('Removal request');
  const richiesta = await leggiRichiesta(id);
  const sito = await prisma.siteSetting.findUnique({
    where: { id: 'singleton' },
    select: { aiPipelineEnabled: true },
  });
  const indirizzo = richiesta.event.recordingUrl;
  const chiavePubblicata = indirizzo
    ? (getRecordingsStorage()?.keyFromUrl(indirizzo) ?? indirizzo)
    : null;
  const deroga = richiesta.recordingId
    ? await derogaPerRimozione(sessione, richiesta.recordingId, { requestId: id })
    : null;
  return Response.json({
    request: vistaRichiesta(richiesta, {
      pipelineEnabled: !!sito?.aiPipelineEnabled,
      storageConfigured: isPostprodStorageConfigured(),
      chiavePubblicata,
    }),
    accessAllowed: !!deroga,
  });
});
