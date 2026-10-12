/**
 * Una voce del glossario dell'istanza.
 *
 *   PATCH  — modifica la voce
 *   DELETE — la cancella
 *
 * L'amministrazione su ogni voce; chi organizza solo su quelle che ha
 * aggiunto (lib/ai/glossary canEditInstanceTerm), altrimenti 403.
 */

import { cookies } from 'next/headers';

import {
  canEditInstanceTerm,
  deleteGlossaryTerm,
  getGlossaryTerm,
  glossaryTermPatchSchema,
  updateGlossaryTerm,
} from '@/lib/ai/glossary';
import { parseJsonBody, withErrorHandling } from '@/lib/api-handler';
import { requireStaff, type StaffSession } from '@/lib/auth/staff-session';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { AppError, ForbiddenError, NotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function voceModificabile(
  context: { params: Promise<Record<string, string>> },
): Promise<{ id: string; session: StaffSession }> {
  const session = await requireStaff(await cookies());
  const { id } = await context.params;
  if (!id || !UUID_RE.test(id)) throw new AppError('id must be a UUID', 400, 'BAD_REQUEST');
  if (session.role !== 'admin') {
    const voce = await getGlossaryTerm(id, null);
    if (!voce) throw new NotFoundError('Glossary term');
    if (!canEditInstanceTerm(session, voce)) throw new ForbiddenError();
  }
  return { id, session };
}

export const PATCH = withErrorHandling(async (request, context) => {
  const { id } = await voceModificabile(context);
  const patch = glossaryTermPatchSchema.parse(await parseJsonBody(request));
  const term = await updateGlossaryTerm(id, null, patch);
  await logAdminAction({ request, action: 'GLOSSARY_TERM_UPDATE', target: id, details: { term: term.term } });
  return Response.json({ ...term, canEdit: true });
});

export const DELETE = withErrorHandling(async (request, context) => {
  const { id } = await voceModificabile(context);
  await deleteGlossaryTerm(id, null);
  await logAdminAction({ request, action: 'GLOSSARY_TERM_DELETE', target: id });
  return Response.json({ deleted: true, id });
});
