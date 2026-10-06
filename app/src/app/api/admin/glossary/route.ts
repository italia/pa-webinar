/**
 * Il glossario dell'istanza per la post-produzione AI (lib/ai/glossary.ts).
 *
 *   GET  — le voci dell'istanza, ciascuna con `canEdit`
 *   POST — aggiunge una voce
 *
 * Tutto lo staff legge il glossario e lo arricchisce; chi organizza modifica
 * e cancella solo le voci che ha aggiunto (./[id]/route.ts). Le voci valgono
 * per tutti gli eventi.
 */

import { cookies } from 'next/headers';

import {
  canEditInstanceTerm,
  createGlossaryTerm,
  glossaryTermInputSchema,
  listGlossary,
} from '@/lib/ai/glossary';
import { parseJsonBody, withErrorHandling } from '@/lib/api-handler';
import { requireStaff } from '@/lib/auth/staff-session';
import { logAdminAction } from '@/lib/audit/admin-audit';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async () => {
  const session = await requireStaff(await cookies());
  const terms = (await listGlossary(null)).map((t) => ({ ...t, canEdit: canEditInstanceTerm(session, t) }));
  return Response.json({ terms }, { headers: { 'Cache-Control': 'no-store' } });
});

export const POST = withErrorHandling(async (request) => {
  const session = await requireStaff(await cookies());
  const input = glossaryTermInputSchema.parse(await parseJsonBody(request));
  const term = await createGlossaryTerm(null, input, { createdById: session.accountId });
  await logAdminAction({ request, action: 'GLOSSARY_TERM_CREATE', target: term.id, details: { term: term.term } });
  return Response.json({ ...term, canEdit: true }, { status: 201 });
});
