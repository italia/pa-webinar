/**
 * /api/admin/events/[id]/text-translation — le lingue di titolo e
 * descrizione dell'evento e la loro traduzione automatica
 * (lib/text-translation).
 *
 * GET  lo stato di ogni lingua dell'evento (`state`: lib/text-translation/
 *      stato-lingue), se la traduzione automatica c'e' per l'evento
 *      (`engine`), l'ultimo lavoro e i testi salvati nelle lingue diverse
 *      dalla principale: il wizard li porta nelle lingue che non ha toccato
 *      quando una traduzione arriva a pagina aperta.
 * POST { lingue } «Riprova»: la traduzione del testo principale salvato in
 *      quelle lingue (attive sul sito, non la principale), se sono lingue
 *      della pagina vuote o tradotte in automatico: mai sopra il testo di una
 *      persona. Una traduzione alla volta per evento.
 *
 * La traduzione ordinaria non passa di qui: la chiede il server dopo ogni
 * salvataggio dell'evento (lib/text-translation/auto). Di chi gestisce
 * l'evento: l'admin, chi l'ha creato o un altro organizzatore.
 */
import { cookies } from 'next/headers';
import { z } from 'zod';

import { parseJsonBody, withErrorHandling } from '@/lib/api-handler';
import { languageCodeSchema } from '@/lib/ai/schemas';
import { resolveMtProvider } from '@/lib/ai/providers';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { requireEventManager } from '@/lib/auth/staff-session';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError, ValidationError } from '@/lib/errors';
import { statoTestiEvento } from '@/lib/text-translation/auto';
import { accodaTraduzioneTesti, lingueAttive } from '@/lib/text-translation/enqueue';
import { linguaPrincipale } from '@/lib/text-translation/stato-lingue';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function idEvento(context: {
  params: Promise<Record<string, string>>;
}): Promise<string> {
  const { id } = await context.params;
  if (!id || !UUID_RE.test(id))
    throw new AppError('Event ID must be a UUID', 400, 'BAD_REQUEST');
  await requireEventManager(await cookies(), id);
  return id;
}

export const GET = withErrorHandling(async (_request, context) => {
  const id = await idEvento(context);
  const stato = await statoTestiEvento(id);
  if (!stato) throw new NotFoundError('Event');
  return Response.json(stato);
});

const richiestaSchema = z.object({
  lingue: z.array(languageCodeSchema).min(1).max(24),
});

export const POST = withErrorHandling(async (request, context) => {
  const id = await idEvento(context);
  const parsed = richiestaSchema.safeParse(await parseJsonBody(request, 16 * 1024));
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message }))
    );
  }
  const impostazioni = await prisma.siteSetting.findUnique({
    where: { id: 'singleton' },
    select: { aiPipelineEnabled: true, availableLocales: true, defaultLocale: true },
  });
  // Come le altre richieste alla pipeline: con l'interruttore spento il
  // lavoro resterebbe in coda per sempre, e senza motore non partirebbe mai.
  if (!impostazioni?.aiPipelineEnabled) {
    throw new AppError('The AI pipeline is disabled', 422, 'AI_PIPELINE_DISABLED');
  }
  if (!resolveMtProvider()) {
    throw new AppError('No machine translation engine is configured', 422, 'MT_UNAVAILABLE');
  }
  const principale = linguaPrincipale(impostazioni);
  const attive = lingueAttive(impostazioni.availableLocales);
  const lingue = parsed.data.lingue.map((l) => l.toLowerCase());
  const estranee = lingue.filter((l) => !attive.includes(l) || l === principale);
  if (estranee.length > 0) {
    throw new ValidationError(
      `Languages not enabled on the site or equal to the main one: ${estranee.join(', ')}`
    );
  }
  const esito = await accodaTraduzioneTesti(id, { lingue });
  switch (esito.stato) {
    case 'evento-assente':
      throw new NotFoundError('Event');
    case 'ai-spenta':
      throw new AppError('The AI pipeline is disabled', 422, 'AI_PIPELINE_DISABLED');
    case 'motore-assente':
      throw new AppError('No machine translation engine is configured', 422, 'MT_UNAVAILABLE');
    case 'senza-testo':
      throw new ValidationError('There is no text to translate in the main language');
    case 'accodato':
      await logAdminAction({
        request,
        action: 'EVENT_TEXT_TRANSLATION_REQUESTED',
        target: id,
        details: {
          jobId: esito.jobId,
          sourceLanguage: principale,
          targetLanguages: esito.lingue,
        },
      });
      return Response.json(esito, { status: 202 });
    default:
      return Response.json(esito);
  }
});
