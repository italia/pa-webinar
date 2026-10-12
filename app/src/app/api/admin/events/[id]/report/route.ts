/**
 * /api/admin/events/[id]/report — il resoconto dell'evento (lib/report).
 *
 * GET  il resoconto, se c'e', con lo stato dell'ultima richiesta, i requisiti
 *      (evento concluso, pipeline AI accesa, dentro la conservazione dei dati)
 *      e quanto materiale c'e' (trascrizione, chat, domande, sondaggi,
 *      parole, valutazioni).
 * POST lo chiede (lavoro REPORT nella coda della post-produzione), con le
 *      lingue in cui tradurlo; si fa a mano, anche dopo aver raccolto i
 *      feedback.
 * PUT  { published } lo mostra o lo toglie dalla pagina dell'evento.
 *
 * Di chi gestisce l'evento: l'admin, chi l'ha creato o un altro organizzatore.
 */
import { cookies } from 'next/headers';
import { z } from 'zod';

import { parseJsonBody, withErrorHandling } from '@/lib/api-handler';
import { parseTargetLocales } from '@/lib/ai/providers';
import { languageCodeSchema } from '@/lib/ai/schemas';
import { requireEventManager } from '@/lib/auth/staff-session';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { conservazioneFinita, registrazionePubblica } from '@/lib/captions/transcript';
import { prisma } from '@/lib/db';
import { AppError, ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import {
  accodaResoconto,
  letturaResoconto,
  linguaResoconto,
  ultimoLavoroResoconto,
} from '@/lib/report/enqueue';
import { contaDomande } from '@/lib/report/metrics';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function idEvento(context: { params: Promise<Record<string, string>> }): Promise<string> {
  const { id } = await context.params;
  if (!id || !UUID_RE.test(id)) throw new AppError('Event ID must be a UUID', 400, 'BAD_REQUEST');
  await requireEventManager(await cookies(), id);
  return id;
}

export const GET = withErrorHandling(async (_request, context) => {
  const id = await idEvento(context);
  const [evento, impostazioni] = await Promise.all([
    prisma.event.findUnique({
      where: { id },
      select: {
        status: true,
        endsAt: true,
        dataRetentionDays: true,
        aiTargetLocales: true,
        postEventReport: true,
        postEventReportPublished: true,
      },
    }),
    prisma.siteSetting.findUnique({ where: { id: 'singleton' }, select: { aiPipelineEnabled: true } }),
  ]);
  if (!evento) throw new NotFoundError('Event');

  const pubblica = await registrazionePubblica(id, false);
  const [registrazione, messaggi, domande, sondaggi, parole, risposte, stelle, reazioni, lavoro] = await Promise.all([
    pubblica
      ? prisma.recording.findUnique({
          where: { id: pubblica },
          select: {
            artifacts: { where: { type: 'TRANSCRIPT_JSON', language: null }, select: { id: true } },
          },
        })
      : null,
    // I messaggi che il modello legge (lib/report/input.ts), domande comprese.
    prisma.chatMessage.count({ where: { eventId: id, hiddenAt: null, dismissedAt: null } }),
    contaDomande(id),
    prisma.poll.count({ where: { eventId: id, status: 'PUBLISHED' } }),
    prisma.wordCloudSubmission.count({ where: { round: { eventId: id }, hiddenAt: null } }),
    prisma.questionnaireResponse.count({ where: { questionnaire: { eventId: id, placement: 'POST_EVENT' } } }),
    prisma.eventFeedback.count({ where: { eventId: id } }),
    prisma.agendaItemReaction.count({ where: { agendaItem: { eventId: id } } }),
    ultimoLavoroResoconto(id),
  ]);
  // Mentre un lavoro e' in coda o in esecuzione vale la lingua in cui scrive;
  // il testo della trascrizione si legge solo quando non c'e' altro modo.
  const inCorso = lavoro && ['PENDING', 'CLAIMED', 'RUNNING'].includes(lavoro.status);
  const lingua = (inCorso && lavoro.sourceLanguage) || (await linguaResoconto(id, prisma, pubblica));
  const scadenza = new Date(evento.endsAt.getTime() + evento.dataRetentionDays * 86_400_000);

  return Response.json({
    report: letturaResoconto(evento.postEventReport),
    published: evento.postEventReportPublished,
    job: lavoro,
    requirements: {
      ended: evento.status === 'ENDED',
      aiEnabled: !!impostazioni?.aiPipelineEnabled,
      retentionEndsAt: scadenza.toISOString(),
      expired: conservazioneFinita(evento, new Date()),
    },
    inputs: {
      transcript: (registrazione?.artifacts.length ?? 0) > 0,
      chatMessages: messaggi,
      questions: domande.total,
      polls: sondaggi,
      words: parole,
      feedback: risposte + stelle,
      agendaReactions: reazioni,
    },
    languages: {
      source: lingua,
      targets: parseTargetLocales(evento.aiTargetLocales),
    },
  });
});

const richiestaSchema = z.object({ targetLanguages: z.array(languageCodeSchema).max(24).optional() });

export const POST = withErrorHandling(async (request, context) => {
  const id = await idEvento(context);
  const parsed = richiestaSchema.safeParse(await parseJsonBody(request).catch(() => ({})));
  if (!parsed.success) throw new ValidationError('Validation failed');
  const esito = await accodaResoconto(id, {
    targetLanguages: parsed.data.targetLanguages?.map((l) => l.toLowerCase()),
  });
  switch (esito.stato) {
    case 'evento-assente':
      throw new NotFoundError('Event');
    case 'non-concluso':
      throw new ConflictError('The event has not ended');
    case 'scaduto':
      throw new ConflictError("The event's data retention period has ended");
    case 'ai-spenta':
      throw new ConflictError('The AI pipeline is disabled');
    default:
      break;
  }
  if (esito.stato === 'accodato') {
    await logAdminAction({
      request,
      action: 'EVENT_REPORT_REQUESTED',
      target: id,
      details: { jobId: esito.jobId, targetLanguages: parsed.data.targetLanguages ?? null },
    });
  }
  return Response.json(esito, { status: esito.stato === 'accodato' ? 202 : 200 });
});

const pubblicazioneSchema = z.object({ published: z.boolean() });

export const PUT = withErrorHandling(async (request, context) => {
  const id = await idEvento(context);
  const parsed = pubblicazioneSchema.safeParse(await parseJsonBody(request));
  if (!parsed.success) throw new ValidationError('Validation failed');
  const evento = await prisma.event.findUnique({ where: { id }, select: { postEventReport: true } });
  if (!evento) throw new NotFoundError('Event');
  if (parsed.data.published && !letturaResoconto(evento.postEventReport)) {
    throw new ConflictError('There is no report to publish');
  }
  await prisma.event.update({ where: { id }, data: { postEventReportPublished: parsed.data.published } });
  await logAdminAction({
    request,
    action: parsed.data.published ? 'EVENT_REPORT_PUBLISHED' : 'EVENT_REPORT_WITHDRAWN',
    target: id,
  });
  return Response.json({ published: parsed.data.published });
});
