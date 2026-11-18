// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * GET /api/admin/recording-removals/[id]/waveform
 *
 * La forma d'onda della registrazione (WAVEFORM_JSON), se la post-produzione
 * l'ha prodotta: aiuta a trovare dove la persona parla. In deroga e tracciata,
 * come il video.
 */
import { cookies } from 'next/headers';

import { withErrorHandling } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth/staff-session';
import { tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import {
  registraAccessoInDeroga,
  richiestaInDeroga,
} from '@/lib/recording/redaction/access';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (request, context) => {
  const { id } = await (context as { params: Promise<{ id: string }> }).params;
  const sessione = await requireAdmin(await cookies());
  const deroga = await richiestaInDeroga(sessione, id);
  const forma = await prisma.postprodArtifact.findFirst({
    where: { recordingId: deroga.recordingId, type: 'WAVEFORM_JSON' },
    select: { inlineBody: true },
  });
  const corpo = forma?.inlineBody ? tryDecryptPII(forma.inlineBody) : null;
  if (!corpo) throw new NotFoundError('Waveform');
  await registraAccessoInDeroga(request, deroga, 'waveform');
  return new Response(corpo, {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
});
