/**
 * Il glossario di un evento per la post-produzione AI (lib/ai/glossary.ts):
 * i termini propri dell'evento, che si aggiungono a quelli dell'istanza e su
 * un termine uguale li sostituiscono.
 *
 *   GET  — le voci dell'evento, e in sola lettura quelle dell'istanza
 *   POST — aggiunge una voce all'evento
 *
 * Chi: l'amministrazione e chi organizza l'evento (sessione dello staff),
 * oppure chi lo modera, con il proprio token in `Authorization: Bearer`.
 */

import { cookies } from 'next/headers';

import { createGlossaryTerm, glossaryTermInputSchema, listGlossary } from '@/lib/ai/glossary';
import { eventoDelGlossario } from '@/lib/ai/glossary-access';
import { parseJsonBody, withErrorHandling } from '@/lib/api-handler';
import { requireEventManager } from '@/lib/auth/staff-session';

export const dynamic = 'force-dynamic';

/** Chi modera l'evento passa col proprio token; gli altri con la sessione
 *  dello staff che gestisce l'evento. */
const guardia = (request: Request, id: string) =>
  eventoDelGlossario(request, id, async () => {
    await requireEventManager(await cookies(), id);
  });

export const GET = withErrorHandling(async (request, context) => {
  const { id } = (await context.params) as { id: string };
  const eventId = await guardia(request, id);
  const [terms, instance] = await Promise.all([listGlossary(eventId), listGlossary(null)]);
  return Response.json(
    {
      terms: terms.map((t) => ({ ...t, canEdit: true })),
      // In sola lettura qui: si arricchiscono dalla pagina del glossario.
      instance: instance.map((t) => ({ ...t, canEdit: false })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});

export const POST = withErrorHandling(async (request, context) => {
  const { id } = (await context.params) as { id: string };
  const eventId = await guardia(request, id);
  const input = glossaryTermInputSchema.parse(await parseJsonBody(request));
  return Response.json({ ...(await createGlossaryTerm(eventId, input)), canEdit: true }, { status: 201 });
});
