/**
 * Una voce del glossario di un evento (vedi ../route.ts per chi puo' usarla).
 *
 *   PATCH  — modifica la voce
 *   DELETE — la cancella
 */

import { cookies } from 'next/headers';

import { deleteGlossaryTerm, glossaryTermPatchSchema, updateGlossaryTerm } from '@/lib/ai/glossary';
import { eventoDelGlossario } from '@/lib/ai/glossary-access';
import { parseJsonBody, withErrorHandling } from '@/lib/api-handler';
import { requireEventManager } from '@/lib/auth/staff-session';
import { AppError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function voce(request: Request, context: { params: Promise<Record<string, string>> }) {
  const { id, termId } = await context.params;
  const eventId = await eventoDelGlossario(request, id ?? '', async () => {
    await requireEventManager(await cookies(), id ?? '');
  });
  if (!termId || !UUID_RE.test(termId)) throw new AppError('termId must be a UUID', 400, 'BAD_REQUEST');
  return { eventId, termId };
}

export const PATCH = withErrorHandling(async (request, context) => {
  const { eventId, termId } = await voce(request, context);
  const patch = glossaryTermPatchSchema.parse(await parseJsonBody(request));
  return Response.json({ ...(await updateGlossaryTerm(termId, eventId, patch)), canEdit: true });
});

export const DELETE = withErrorHandling(async (request, context) => {
  const { eventId, termId } = await voce(request, context);
  await deleteGlossaryTerm(termId, eventId);
  return Response.json({ deleted: true, id: termId });
});
