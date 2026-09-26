import { type PollStatus } from '@prisma/client';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import {
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
} from '@/lib/errors';
import {
  isEventModerator,
  extractModeratorToken,
} from '@/lib/auth/moderator';
import { getCached, setCache, deleteCacheByPrefix } from '@/lib/cache';
import { prisma } from '@/lib/db';
import {
  authorizePanelRead,
  PANEL_READ_EVENT_SELECT,
} from '@/lib/events/panel-read-access';
import { getRedis } from '@/lib/redis';
import { pokeLivePanel } from '@/lib/live-state/publish';
import { createPollSchema } from '@/lib/validation/schemas';

export const dynamic = 'force-dynamic';

// ── GET /api/events/[slug]/polls ─────────────────────────

export const GET = withErrorHandling(async (request, context) => {
  const { param: slug } = await context.params;

  const url = new URL(request.url);
  const authHeader = request.headers.get('authorization');
  const headerToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : null;
  // Bearer vuoto = ospite: la sala passa `token=""` a chi entra dal link, e
  // `Bearer ` senza valore non è un token sbagliato, è l'assenza di token.
  const token = headerToken || url.searchParams.get('token') || null;
  const guestId = url.searchParams.get('guestId');

  const event = await prisma.event.findUnique({
    where: { slug },
    select: PANEL_READ_EVENT_SELECT,
  });
  if (!event) throw new NotFoundError('Event');

  // Regola di lettura condivisa con il Q&A: ospiti e relatori sono in sala.
  const reader = await authorizePanelRead(event, token);
  const { isModerator, registrationId } = reader;

  const where = isModerator
    ? { eventId: event.id }
    : { eventId: event.id, status: { in: ['OPEN', 'PUBLISHED'] as PollStatus[] } };

  /** La parte di risposta uguale per tutto il pubblico: nessuna traccia di chi
   *  chiede. È questa che si può tenere in caldo. */
  interface PollPubblico {
    id: string;
    question: string;
    options: string[];
    status: string;
    totalVotes: number;
    optionCounts: number[] | null;
    createdAt: string;
    closedAt: string | null;
  }

  // Stessa ragione della cache del Q&A, e adesso stessa pressione: il pannello
  // dei sondaggi resta montato per tutta la sala — serve a poter accendere il
  // pallino su un'altra scheda — quindi questa GET la chiama ogni presente.
  // Vale SOLO senza push: col canale attivo i client rileggono subito dopo una
  // scrittura e non c'è un secondo giro a rimediare a una risposta vecchia.
  const pushAttivo = getRedis()?.status === 'ready';
  const cacheKey = isModerator || pushAttivo ? null : `polls:${event.id}`;

  let pubblici = cacheKey ? (getCached<PollPubblico[]>(cacheKey) ?? null) : null;

  if (!pubblici) {
    const polls = await prisma.poll.findMany({
      where,
      select: {
        id: true,
        question: true,
        options: true,
        status: true,
        createdAt: true,
        closedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // I conteggi si chiedono aggregati. Caricare ogni riga di voto per contarle
    // a mano significa, su un sondaggio da trecento persone, trecento righe
    // lette a ogni richiesta di ogni presente.
    const tally =
      polls.length > 0
        ? await prisma.pollVote.groupBy({
            by: ['pollId', 'optionIndex'],
            where: { pollId: { in: polls.map((p) => p.id) } },
            _count: { _all: true },
          })
        : [];

    const perPoll = new Map<string, Map<number, number>>();
    for (const riga of tally) {
      const m = perPoll.get(riga.pollId) ?? new Map<number, number>();
      m.set(riga.optionIndex, riga._count._all);
      perPoll.set(riga.pollId, m);
    }

    pubblici = polls.map((poll) => {
      const options = poll.options as string[];
      const conteggi = perPoll.get(poll.id) ?? new Map<number, number>();
      const optionCounts = options.map((_, idx) => conteggi.get(idx) ?? 0);
      const totalVotes = optionCounts.reduce((a, b) => a + b, 0);
      const showResults = isModerator || poll.status !== 'OPEN';

      return {
        id: poll.id,
        question: poll.question,
        options,
        status: poll.status,
        totalVotes,
        optionCounts: showResults ? optionCounts : null,
        createdAt: poll.createdAt.toISOString(),
        closedAt: poll.closedAt?.toISOString() ?? null,
      };
    });

    if (cacheKey) setCache(cacheKey, pubblici, 2000);
  }

  // L'identità del votante è la registrazione quando c'è, altrimenti
  // l'identificativo stabile del browser: è quello con cui ospiti, relatori e
  // moderatori votano, ed è anche la chiave di deduplica. Fuori dalla cache,
  // perché è l'unico pezzo di risposta che cambia da persona a persona.
  const miei = new Map<string, number>();
  if (pubblici.length > 0 && (registrationId || guestId)) {
    const righe = await prisma.pollVote.findMany({
      where: {
        pollId: { in: pubblici.map((p) => p.id) },
        ...(registrationId ? { registrationId } : { guestId: guestId as string }),
      },
      select: { pollId: true, optionIndex: true },
    });
    for (const r of righe) miei.set(r.pollId, r.optionIndex);
  }

  const result = pubblici.map((poll) => ({
    ...poll,
    hasVoted: miei.has(poll.id),
    votedOptionIndex: miei.get(poll.id) ?? null,
  }));

  return Response.json({ polls: result });
});

// ── POST /api/events/[slug]/polls ────────────────────────

export const POST = withErrorHandling(async (request, context) => {
  const { param: slug } = await context.params;

  const token = extractModeratorToken(request);
  if (!token) throw new UnauthorizedError('Moderator token required');

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event || !(await isEventModerator(event, token))) {
    throw new ForbiddenError('Unauthorized');
  }

  const body = await parseJsonBody(request);
  const parsed = createPollSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message }))
    );
  }

  const poll = await prisma.poll.create({
    data: {
      eventId: event.id,
      question: parsed.data.question,
      options: parsed.data.options,
    },
  });

  deleteCacheByPrefix(`polls:${event.id}`);
  pokeLivePanel(event.id, 'polls');

  return Response.json(
    {
      id: poll.id,
      question: poll.question,
      options: poll.options,
      status: poll.status,
      totalVotes: 0,
      optionCounts: (poll.options as string[]).map(() => 0),
      hasVoted: false,
      votedOptionIndex: null,
      createdAt: poll.createdAt.toISOString(),
      closedAt: null,
    },
    { status: 201 }
  );
});
