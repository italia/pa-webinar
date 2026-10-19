/**
 * /api/admin/events/[id]/text-translation — la traduzione automatica di
 * titolo e descrizione dell'evento (lib/text-translation).
 *
 * GET  lo stato dell'ultima richiesta, la proposta salvata, se la traduzione
 *      c'e' nell'installazione (pipeline AI accesa e motore su CPU
 *      installato) e le lingue in cui la proposta riempirebbe campi vuoti del
 *      testo salvato.
 * POST { sourceLanguage, title, description, targetLanguages } la chiede: un
 *      lavoro TRANSLATE_TEXT con il testo del modulo, anche non salvato, nelle
 *      lingue attive dell'istanza (senza quella di partenza). Una alla volta
 *      per evento; la stessa richiesta con la proposta gia' pronta non accoda
 *      niente.
 *
 * Il risultato e' una proposta (Event.textTranslations): titolo e
 * descrizione non cambiano finche' qualcuno non la rilegge e la salva nel
 * wizard. Di chi gestisce l'evento: l'admin, chi l'ha creato o un altro
 * organizzatore.
 */
import { cookies } from 'next/headers';
import { z } from 'zod';

import { parseJsonBody, withErrorHandling } from '@/lib/api-handler';
import {
  languageCodeSchema,
  TEXT_TRANSLATION_DESCRIPTION_MAX,
  TEXT_TRANSLATION_TITLE_MAX,
} from '@/lib/ai/schemas';
import { resolveMtProvider } from '@/lib/ai/providers';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { requireEventManager } from '@/lib/auth/staff-session';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError, ValidationError } from '@/lib/errors';
import {
  accodaTraduzioneTesti,
  traduzioneDisponibile,
  ultimoLavoroTraduzione,
} from '@/lib/text-translation/enqueue';
import { letturaTraduzioni, proposteApplicabili } from '@/lib/text-translation/proposals';
import { improntaSorgente, testoSorgente } from '@/lib/text-translation/source';

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

/** Le lingue dei contenuti attive nell'istanza (come il wizard). */
function lingueAttive(valore: unknown): string[] {
  return Array.isArray(valore) && valore.length > 0
    ? valore.filter((l): l is string => typeof l === 'string')
    : ['it', 'en'];
}

const testo = (v: unknown): Record<string, string> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string>) : {};

export const GET = withErrorHandling(async (_request, context) => {
  const id = await idEvento(context);
  const [evento, impostazioni, lavoro] = await Promise.all([
    prisma.event.findUnique({
      where: { id },
      select: { title: true, description: true, textTranslations: true },
    }),
    prisma.siteSetting.findUnique({
      where: { id: 'singleton' },
      select: { aiPipelineEnabled: true },
    }),
    ultimoLavoroTraduzione(id),
  ]);
  if (!evento) throw new NotFoundError('Event');
  const proposta = letturaTraduzioni(evento.textTranslations);
  // Le lingue che la proposta riempirebbe nel testo salvato, se ne viene.
  const pending = proposta
    ? proposteApplicabili(
        proposta,
        await improntaSorgente(
          testoSorgente(
            proposta.sourceLanguage,
            testo(evento.title),
            testo(evento.description)
          )
        ),
        testo(evento.title),
        testo(evento.description)
      )
    : [];
  return Response.json({
    available: traduzioneDisponibile(impostazioni),
    job: lavoro,
    proposals: proposta,
    pending,
  });
});

const richiestaSchema = z.object({
  sourceLanguage: languageCodeSchema,
  title: z.string().max(TEXT_TRANSLATION_TITLE_MAX),
  description: z.string().max(TEXT_TRANSLATION_DESCRIPTION_MAX),
  targetLanguages: z.array(languageCodeSchema).min(1).max(24),
});

export const POST = withErrorHandling(async (request, context) => {
  const id = await idEvento(context);
  // Titolo e descrizione: qualche decina di KB al massimo.
  const parsed = richiestaSchema.safeParse(await parseJsonBody(request, 256 * 1024));
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message }))
    );
  }
  const impostazioni = await prisma.siteSetting.findUnique({
    where: { id: 'singleton' },
    select: { aiPipelineEnabled: true, availableLocales: true },
  });
  // Come le altre richieste alla pipeline: con l'interruttore spento il
  // lavoro resterebbe in coda per sempre, e senza motore non partirebbe mai.
  if (!impostazioni?.aiPipelineEnabled) {
    throw new AppError('The AI pipeline is disabled', 422, 'AI_PIPELINE_DISABLED');
  }
  if (!resolveMtProvider()) {
    throw new AppError(
      'No machine translation engine is configured',
      422,
      'MT_UNAVAILABLE'
    );
  }

  const { sourceLanguage, targetLanguages } = parsed.data;
  const attive = lingueAttive(impostazioni.availableLocales);
  if (!attive.includes(sourceLanguage)) {
    throw new ValidationError(`The source language ${sourceLanguage} is not enabled`);
  }
  const estranee = targetLanguages.filter(
    (l) => !attive.includes(l) || l === sourceLanguage
  );
  if (estranee.length > 0) {
    throw new ValidationError(
      `Target languages not enabled or equal to the source: ${estranee.join(', ')}`
    );
  }
  const sorgente = testoSorgente(
    sourceLanguage,
    { [sourceLanguage]: parsed.data.title },
    { [sourceLanguage]: parsed.data.description }
  );
  if (!sorgente.title && !sorgente.description) {
    throw new ValidationError('There is no text to translate in the source language');
  }

  const esito = await accodaTraduzioneTesti(id, sorgente, targetLanguages);
  switch (esito.stato) {
    case 'evento-assente':
      throw new NotFoundError('Event');
    case 'ai-spenta':
      throw new AppError('The AI pipeline is disabled', 422, 'AI_PIPELINE_DISABLED');
    case 'motore-assente':
      throw new AppError(
        'No machine translation engine is configured',
        422,
        'MT_UNAVAILABLE'
      );
    case 'accodato':
      await logAdminAction({
        request,
        action: 'EVENT_TEXT_TRANSLATION_REQUESTED',
        target: id,
        details: { jobId: esito.jobId, sourceLanguage, targetLanguages },
      });
      return Response.json(esito, { status: 202 });
    default:
      return Response.json(esito);
  }
});
