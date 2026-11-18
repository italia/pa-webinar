// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * POST /api/admin/recording-removals/[id]/start
 *
 * L'amministrazione apre l'editor di rimozione: la richiesta aperta passa in
 * lavorazione e l'accesso in deroga si traccia (lib/recording/redaction/access).
 */
import { cookies } from 'next/headers';

import { withErrorHandling } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth/staff-session';
import {
  registraAccessoInDeroga,
  richiestaInDeroga,
} from '@/lib/recording/redaction/access';
import { prendiInCarico } from '@/lib/recording/redaction/requests';

export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(async (request, context) => {
  const { id } = await (context as { params: Promise<{ id: string }> }).params;
  const sessione = await requireAdmin(await cookies());
  const deroga = await richiestaInDeroga(sessione, id);
  await prendiInCarico(id);
  await registraAccessoInDeroga(request, deroga, 'editor');
  return Response.json({ ok: true });
});
