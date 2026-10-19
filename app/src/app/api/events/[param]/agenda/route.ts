/**
 * L'agenda dell'incontro. Funzione opt-in (Event.agendaEnabled). Pattern
 * allineato a Q&A/poll:
 *   GET  → gli argomenti in ordine, con stato e reazioni (chiunque sia in
 *          stanza). `?lite=1`: solo titoli e stati, per la barra della sala.
 *          Nessuna delle due dice chi interviene: la lettura non chiede
 *          token, e la pagina pubblica mostra solo le persone presentate.
 *   POST → il moderatore aggiunge un argomento, o un elenco incollato.
 *   PUT  → il moderatore riordina l'agenda (`{order}`), oppure salva il
 *          programma preparato prima dell'evento (`{base, plan}`): argomenti,
 *          durate e chi interviene, in una richiesta sola.
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
import { agendaSpeakerSchema, verificaRelatori } from '@/lib/agenda/speaker';
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

/**
 * Il programma preparato prima dell'evento (il wizard): l'elenco intero, al
 * posto di quello che c'era. `base` sono gli argomenti che chi scrive aveva
 * letto: se nel frattempo l'agenda e' cambiata (la sala, un'altra scheda),
 * la richiesta si rifiuta invece di cancellare cio' che non conosceva. Un
 * argomento con `id` si aggiorna, uno senza si crea, uno di `base` che non
 * c'e' piu' si toglie.
 */
const planSchema = z.object({
  base: z.array(z.string().uuid()).max(MAX_AGENDA_ITEMS),
  plan: z
    .array(
      z
        .object({
          id: z.string().uuid().optional(),
          label: labelSchema,
          plannedMinutes: plannedMinutesSchema.nullable().optional(),
        })
        .merge(agendaSpeakerSchema),
    )
    .max(MAX_AGENDA_ITEMS),
});

/** Cio' che legge chiunque (GET): senza chi interviene. */
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

/** Cio' che torna a chi ha salvato il programma: anche chi interviene. */
const PLAN_SELECT = {
  ...ITEM_SELECT,
  speakerGrantId: true,
  speakerPrimary: true,
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
  const body = await parseJsonBody(request);
  if (body && typeof body === 'object' && 'plan' in body) {
    return salvaProgramma(event.id, planSchema.parse(body));
  }
  const { order } = reorderSchema.parse(body);

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
    if (!stessoInsieme(order, ids)) {
      throw new ConflictError('The agenda changed: reload it and try again');
    }
    for (const [i, id] of order.entries()) {
      await tx.eventAgendaItem.update({ where: { id }, data: { sortOrder: i + 1 } });
    }
  });

  notify(event.id);
  return new Response(null, { status: 204 });
});

/** Vero se `elenco` nomina ogni id di `ids` una volta sola, e nient'altro. */
function stessoInsieme(elenco: string[], ids: Set<string>): boolean {
  return (
    new Set(elenco).size === elenco.length &&
    elenco.length === ids.size &&
    elenco.every((id) => ids.has(id))
  );
}

/**
 * Il programma preparato prima dell'evento, al posto dell'agenda che c'era.
 *
 * Solo finche' l'agenda non e' stata usata: un argomento gia' avviato,
 * discusso o saltato, o con le reazioni del pubblico, e' la storia della
 * riunione, e da li' in poi l'agenda si guida dalla sala (409). Chi
 * interviene dev'essere una persona di questo evento, non revocata (422).
 */
async function salvaProgramma(eventId: string, { base, plan }: z.infer<typeof planSchema>) {
  const items = await prisma.$transaction(async (tx) => {
    // In fila con le altre scritture dell'agenda (aggiunte, riordini, cambi
    // di stato dalla sala).
    await tx.$executeRaw`SELECT id FROM events WHERE id = ${eventId}::uuid FOR NO KEY UPDATE`;
    const esistenti = await tx.eventAgendaItem.findMany({
      where: { eventId },
      select: { id: true, status: true, _count: { select: { reactions: true } } },
    });
    const ids = new Set(esistenti.map((e) => e.id));
    if (!stessoInsieme(base, ids)) {
      throw new ConflictError('The agenda changed: reload it and try again');
    }
    if (esistenti.some((e) => e.status !== 'PENDING' || e._count.reactions > 0)) {
      throw new ConflictError('The agenda is already in use: change it from the room');
    }

    // Un argomento da aggiornare dev'essere di questa agenda, e una volta sola.
    const visti = new Set<string>();
    const problemi: Array<{ path: (string | number)[]; message: string }> = [];
    plan.forEach((v, i) => {
      if (!v.id) return;
      if (!ids.has(v.id) || visti.has(v.id)) {
        problemi.push({ path: ['plan', i, 'id'], message: 'Unknown or repeated agenda item' });
      }
      visti.add(v.id);
    });
    problemi.push(...(await verificaRelatori(tx, eventId, plan, (i, campo) => ['plan', i, campo])));
    if (problemi.length > 0) throw new ValidationError('Invalid agenda plan', problemi);

    const daTogliere = base.filter((id) => !visti.has(id));
    if (daTogliere.length > 0) {
      await tx.eventAgendaItem.deleteMany({ where: { eventId, id: { in: daTogliere } } });
    }
    const out = [];
    // In fila, non in parallelo: una transazione e' una connessione sola.
    for (const [i, v] of plan.entries()) {
      const data = {
        label: v.label,
        plannedMinutes: v.plannedMinutes ?? null,
        speakerGrantId: v.speakerGrantId ?? null,
        speakerPrimary: v.speakerPrimary ?? false,
        sortOrder: i + 1,
      };
      out.push(
        v.id
          ? await tx.eventAgendaItem.update({ where: { id: v.id }, data, select: PLAN_SELECT })
          : await tx.eventAgendaItem.create({ data: { eventId, ...data }, select: PLAN_SELECT }),
      );
    }
    return out;
  });

  notify(eventId);
  return Response.json({ items });
}
