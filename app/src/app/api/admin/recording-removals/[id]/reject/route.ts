// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * POST /api/admin/recording-removals/[id]/reject
 *
 * Lo staff respinge una richiesta aperta, con il motivo (per esempio: la
 * persona non compare nella registrazione). La nota resta cifrata con la
 * richiesta; il registro GDPR ne tiene il fatto, senza il testo. Non apre il
 * contenuto della registrazione: basta essere amministratori.
 */
import { cookies } from 'next/headers';
import { z } from 'zod';

import { parseJsonBody, withErrorHandling } from '@/lib/api-handler';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { requireAdmin } from '@/lib/auth/staff-session';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { respingi } from '@/lib/recording/redaction/requests';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const corpoSchema = z.object({ note: z.string().trim().min(1).max(2000) }).strict();

export const POST = withErrorHandling(async (request, context) => {
  const { id } = await (context as { params: Promise<{ id: string }> }).params;
  await requireAdmin(await cookies());
  if (!UUID_RE.test(id)) throw new NotFoundError('Removal request');
  const parsed = corpoSchema.safeParse(await parseJsonBody(request, 16 * 1024));
  if (!parsed.success) throw new ValidationError('A reason is required');
  await respingi(id, parsed.data.note);
  await logAdminAction({ request, action: 'RECORDING_REDACTION_REJECT', target: id });
  return Response.json({ status: 'REJECTED' });
});
