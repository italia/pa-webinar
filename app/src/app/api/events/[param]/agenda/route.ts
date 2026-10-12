/**
 * L'agenda dell'incontro. Funzione opt-in (Event.agendaEnabled). Pattern
 * allineato a Q&A/poll:
 *   GET  → gli argomenti in ordine, con stato e reazioni (chiunque sia in
 *          stanza). `?lite=1`: solo titoli e stati, per la barra della sala.
 *   POST → il moderatore aggiunge un argomento, o un elenco incollato.
 *   PUT  → il moderatore riordina l'agenda.
 * Mutazioni protette da token moderatore (Bearer o ?token).
 */

import { z } from 'zod';

import { parseJsonBody, withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { pokeLivePanel } from '@/lib/live-state/publish';
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
} from '@/lib/errors';
import { extractModeratorToken, verifyModeratorToken } from '@/lib/auth/moderator';
import { deleteCacheByPrefix, getCached, setCache } from '@/lib/cache';
import { MAX_AGENDA_ITEMS, plannedMinutesSchema } from '@/lib/agenda/status';

export const dynamic = 'force-dynamic';

const labelSchema = z.string().trim().min(1).max(500);

/** Un argomento, oppure un elenco incollato (un argomento per riga). */
const createSchema = z.union([
  z.object({ label: labelSchema, plannedMinutes: plannedMinutesSchema.nullable().optional() }),
  z.object({ labels: z.array(labelSchema).min(1).max(50) }),
]);

/** Il nuovo ordine: tutti gli argomenti dell'agenda, ciascuno una volta. */
const reorderSchema = z.object({
  order: z.array(z.string().uuid()).min(1).max(MAX_AGENDA_ITEMS),
});

const ITEM_SELECT = {
  id: true,
  label: true,
  completed: true,
  status: true,
  startedAt: true,
  completedAt: true,
  plannedMinutes: true,
  sortOrder: true,
} as const;

async function requireModerator(request: Request, slug: string) {
  const token = extractModeratorToken(request);
  if (!token) throw new UnauthorizedError('Moderator token required');
  const event = await verifyModeratorToken(slug, token);
  if (!event) throw new ForbiddenError('Moderator access required');
  return event;
}

/** Dopo ogni modifica: la lettura leggera di questo pod e' vecchia, e la sala
 *  va avvisata. */
function notify(eventId: string) {
  deleteCacheByPrefix(`agenda-lite:${eventId}`);
  pokeLivePanel(eventId, 'agenda');
}

export const GET = withErrorHandling(async (request, context) => {
  const { param: slug } = (await context.params) as { param: string };
  const event = await prisma.event.findUnique({
    where: { slug },
    select: { id: true, agendaEnabled: true },
  });
  if (!event) throw new NotFoundError('Event');

  const url = new URL(request.url);

  // Lettura leggera per l'anteprima nella barra della sala: titoli e stati,
  // niente reazioni e niente identita', uguale per tutti e tenuta in caldo
  // qualche secondo. La legge ogni presente, non solo chi apre il pannello.
  if (url.searchParams.get('lite') === '1') {
    const chiave = `agenda-lite:${event.id}`;
    const inCaldo = getCached<unknown>(chiave);
    if (inCaldo) return Response.json(inCaldo);
    const voci = await prisma.eventAgendaItem.findMany({
      where: { eventId: event.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        label: true,
        status: true,
        startedAt: true,
        completedAt: true,
        plannedMinutes: true,
      },
    });
    const corpo = {
      agendaEnabled: event.agendaEnabled,
      items: voci.map((v) => ({
        ...v,
        startedAt: v.startedAt?.toISOString() ?? null,
        completedAt: v.completedAt?.toISOString() ?? null,
      })),
    };
    // Breve: con piu' istanze dell'app, quella che risponde dopo un avviso
    // puo' avere in caldo lo stato di prima.
    setCache(chiave, corpo, 2000);
    return Response.json(corpo);
  }

  const items = await prisma.eventAgendaItem.findMany({
    where: { eventId: event.id },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: ITEM_SELECT,
  });

  // Audience-pulse tallies per item (assenso/dissenso). Aggregated in one
  // groupBy instead of N+1 counts.
  const counts = await prisma.agendaItemReaction.groupBy({
    by: ['agendaItemId', 'value'],
    where: { agendaItem: { eventId: event.id } },
    _count: { _all: true },
  });
  const tally = new Map<string, { agree: number; disagree: number }>();
  for (const c of counts) {
    const t = tally.get(c.agendaItemId) ?? { agree: 0, disagree: 0 };
    if (c.value === 'AGREE') t.agree = c._count._all;
    else t.disagree = c._count._all;
    tally.set(c.agendaItemId, t);
  }

  // The caller's own reaction per item, so the UI can highlight the chosen
  // button after a refresh. Identity comes from the participant accessToken
  // (Authorization: Bearer) or the anonymous guestId (?guestId= query).
  const guestId = url.searchParams.get('guestId');
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || null;
  let registrationId: string | null = null;
  if (bearer) {
    const reg = await prisma.registration.findUnique({
      where: { accessToken: bearer },
      select: { id: true, eventId: true },
    });
    if (reg && reg.eventId === event.id) registrationId = reg.id;
  }
  const mine = new Map<string, 'AGREE' | 'DISAGREE'>();
  if (registrationId || guestId) {
    const myRx = await prisma.agendaItemReaction.findMany({
      where: {
        agendaItem: { eventId: event.id },
        ...(registrationId ? { registrationId } : { guestId }),
      },
      select: { agendaItemId: true, value: true },
    });
    for (const r of myRx) mine.set(r.agendaItemId, r.value);
  }

  const itemsWithReactions = items.map((i) => ({
    ...i,
    agreeCount: tally.get(i.id)?.agree ?? 0,
    disagreeCount: tally.get(i.id)?.disagree ?? 0,
    myReaction: mine.get(i.id) ?? null,
  }));

  return Response.json({ agendaEnabled: event.agendaEnabled, items: itemsWithReactions });
});

export const POST = withErrorHandling(async (request, context) => {
  const { param: slug } = (await context.params) as { param: string };
  const event = await requireModerator(request, slug);
  const body = createSchema.parse(await parseJsonBody(request));

  const nuovi =
    'labels' in body
      ? body.labels.map((label) => ({ label, plannedMinutes: null }))
      : [{ label: body.label, plannedMinutes: body.plannedMinutes ?? null }];

  const creati = await prisma.$transaction(async (tx) => {
    // In fila con le altre scritture dell'agenda: due aggiunte insieme
    // supererebbero il tetto e prenderebbero le stesse posizioni.
    await tx.$executeRaw`SELECT id FROM events WHERE id = ${event.id}::uuid FOR NO KEY UPDATE`;
    const max = await tx.eventAgendaItem.aggregate({
      where: { eventId: event.id },
      _max: { sortOrder: true },
      _count: { _all: true },
    });
    if (max._count._all + nuovi.length > MAX_AGENDA_ITEMS) {
      throw new ValidationError('Too many agenda items', [
        { path: ['labels'], message: `At most ${MAX_AGENDA_ITEMS} agenda items` },
      ]);
    }
    const base = max._max.sortOrder ?? 0;
    const out = [];
    // In fila, non in parallelo: una transazione e' una connessione sola.
    for (const [i, n] of nuovi.entries()) {
      out.push(
        await tx.eventAgendaItem.create({
          data: {
            eventId: event.id,
            label: n.label,
            plannedMinutes: n.plannedMinutes,
            sortOrder: base + i + 1,
          },
          select: ITEM_SELECT,
        }),
      );
    }
    return out;
  });

  notify(event.id);

  // Un argomento solo: la risposta di sempre, l'argomento creato.
  return Response.json('labels' in body ? { items: creati } : creati[0], { status: 201 });
});

export const PUT = withErrorHandling(async (request, context) => {
  const { param: slug } = (await context.params) as { param: string };
  const event = await requireModerator(request, slug);
  const { order } = reorderSchema.parse(await parseJsonBody(request));

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM events WHERE id = ${event.id}::uuid FOR NO KEY UPDATE`;
    const esistenti = await tx.eventAgendaItem.findMany({
      where: { eventId: event.id },
      select: { id: true },
    });
    const ids = new Set(esistenti.map((e) => e.id));
    // L'ordine deve dire dove va OGNI argomento, una volta sola: un elenco
    // vecchio (qualcuno ha appena aggiunto o tolto un argomento) si rifiuta,
    // invece di lasciare quelli mancanti in una posizione a caso.
    const completo =
      new Set(order).size === order.length &&
      order.length === ids.size &&
      order.every((id) => ids.has(id));
    if (!completo) throw new ConflictError('The agenda changed: reload it and try again');
    for (const [i, id] of order.entries()) {
      await tx.eventAgendaItem.update({ where: { id }, data: { sortOrder: i + 1 } });
    }
  });

  notify(event.id);
  return new Response(null, { status: 204 });
});
