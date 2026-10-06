/**
 * Un argomento della scaletta (solo moderatore).
 *   PATCH { status?, label?, plannedMinutes? } → stato, titolo, durata
 *         prevista. `completed` resta accettato per i client precedenti.
 *   DELETE → toglie l'argomento.
 */

import { z } from 'zod';

import { parseJsonBody, withErrorHandling } from '@/lib/api-handler';
import { deleteCacheByPrefix } from '@/lib/cache';
import { prisma } from '@/lib/db';
import { pokeLivePanel } from '@/lib/live-state/publish';
import { recordLiveAction, recordLiveActions } from '@/lib/live/actions';
import { NotFoundError, UnauthorizedError, ForbiddenError } from '@/lib/errors';
import { extractModeratorToken, verifyModeratorToken } from '@/lib/auth/moderator';
import {
  AGENDA_STATUSES,
  agendaStatusData,
  plannedMinutesSchema,
  statusFromCompleted,
} from '@/lib/agenda/status';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  /** Lo stato dell'argomento. `completed` resta per i client precedenti. */
  status: z.enum(AGENDA_STATUSES).optional(),
  completed: z.boolean().optional(),
  label: z.string().trim().min(1).max(500).optional(),
  plannedMinutes: plannedMinutesSchema.nullable().optional(),
});

async function authItem(request: Request, slug: string, id: string) {
  const token = extractModeratorToken(request);
  if (!token) throw new UnauthorizedError('Moderator token required');
  const event = await verifyModeratorToken(slug, token);
  if (!event) throw new ForbiddenError('Moderator access required');
  const item = await prisma.eventAgendaItem.findUnique({ where: { id } });
  if (!item || item.eventId !== event.id) throw new NotFoundError('Agenda item');
  return { item, eventId: event.id };
}

export const PATCH = withErrorHandling(async (request, context) => {
  const { param: slug, id } = (await context.params) as { param: string; id: string };
  const { eventId } = await authItem(request, slug, id);
  const body = patchSchema.parse(await parseJsonBody(request));

  const status =
    body.status ?? (body.completed !== undefined ? statusFromCompleted(body.completed) : undefined);
  const now = new Date();

  const { updated, giaInCorso, chiusi } = await prisma.$transaction(async (tx) => {
    let giaInCorso = false;
    let chiusi: { id: string; label: string }[] = [];
    if (status === 'CURRENT') {
      // I cambi di stato della stessa scaletta in fila: sotto READ COMMITTED
      // due «prossimo argomento» contemporanei (due moderatori, o un doppio
      // clic) non vedrebbero l'uno l'argomento dell'altro, e ne resterebbero
      // due in corso. NO KEY UPDATE: mette in fila le scritture della
      // scaletta senza fermare chat, domande e iscrizioni dello stesso evento,
      // che sulla riga prendono solo il KEY SHARE della chiave esterna.
      await tx.$executeRaw`SELECT id FROM events WHERE id = ${eventId}::uuid FOR NO KEY UPDATE`;
      const attuale = await tx.eventAgendaItem.findUnique({ where: { id }, select: { status: true } });
      giaInCorso = attuale?.status === 'CURRENT';
      // Uno solo in corso: avviarne uno chiude il precedente come discusso.
      // Quali si chiudono lo leggiamo prima, per la cronologia della sala.
      const doveInCorso = { eventId, status: 'CURRENT' as const, id: { not: id } };
      chiusi = await tx.eventAgendaItem.findMany({
        where: doveInCorso,
        select: { id: true, label: true },
      });
      await tx.eventAgendaItem.updateMany({
        where: doveInCorso,
        data: agendaStatusData('DONE', now),
      });
    }
    const updated = await tx.eventAgendaItem.update({
      where: { id },
      data: {
        ...(body.label !== undefined && { label: body.label }),
        ...(body.plannedMinutes !== undefined && { plannedMinutes: body.plannedMinutes }),
        // Gia' in corso: l'orologio non riparte da zero.
        ...(status !== undefined && !giaInCorso && agendaStatusData(status, now)),
      },
      select: {
        id: true,
        label: true,
        completed: true,
        status: true,
        startedAt: true,
        completedAt: true,
        plannedMinutes: true,
        sortOrder: true,
      },
    });
    return { updated, giaInCorso, chiusi };
  });
  deleteCacheByPrefix(`agenda-lite:${eventId}`);
  pokeLivePanel(eventId, 'agenda');

  // Cronologia: prima gli argomenti chiusi dall'avvio, poi quello toccato
  // (se era gia' in corso non e' cambiato niente).
  if (status !== undefined) {
    await recordLiveActions(
      chiusi.map((c) => ({
        eventId,
        kind: 'agenda.topic' as const,
        actor: 'moderator' as const,
        data: { itemId: c.id, label: c.label, status: 'DONE' },
        at: now,
      })),
    );
    if (!(giaInCorso && status === 'CURRENT')) {
      // Un millisecondo dopo: nella cronologia il nuovo segue i chiusi.
      await recordLiveAction({
        eventId,
        kind: 'agenda.topic',
        actor: 'moderator',
        data: { itemId: updated.id, label: updated.label, status },
        at: new Date(now.getTime() + 1),
      });
    }
  }

  return Response.json(updated);
});

export const DELETE = withErrorHandling(async (request, context) => {
  const { param: slug, id } = (await context.params) as { param: string; id: string };
  const { eventId } = await authItem(request, slug, id);
  await prisma.eventAgendaItem.delete({ where: { id } });
  deleteCacheByPrefix(`agenda-lite:${eventId}`);
  pokeLivePanel(eventId, 'agenda');

  return new Response(null, { status: 204 });
});
