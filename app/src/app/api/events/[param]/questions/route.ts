import type { QuestionStatus } from '@prisma/client';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import {
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  RateLimitError,
  ValidationError,
} from '@/lib/errors';
import { prisma } from '@/lib/db';
import { getRedis } from '@/lib/redis';
import { pokeLivePanel } from '@/lib/live-state/publish';
import { createQuestionSchema } from '@/lib/validation/schemas';
import { tryDecryptPII } from '@/lib/crypto/pii';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { authorizePanelRead } from '@/lib/events/panel-read-access';
import { guestWindowOpen } from '@/lib/events/guest-window';
import { getSettings } from '@/lib/settings';
import { getCached, setCache, deleteCacheByPrefix } from '@/lib/cache';

export const dynamic = 'force-dynamic';

const PARTICIPANT_VISIBLE: QuestionStatus[] = ['PENDING', 'HIGHLIGHTED', 'ANSWERED'];

// ── GET /api/events/[slug]/questions ─────────────────────────

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

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event) throw new NotFoundError('Event');

  // Regola di lettura condivisa con i sondaggi: ospiti e relatori sono in
  // sala e devono vedere il pannello. La lookup co-moderatore che sta dentro
  // resta cache-ata: questa GET è pollata via SWR da ogni partecipante e
  // sarebbe un miss DB garantito a ogni richiesta.
  const { isModerator, registrationId } = await authorizePanelRead(event, token);

  const statusFilter = url.searchParams.get('status') as QuestionStatus | null;

  const where: Record<string, unknown> = { eventId: event.id };
  if (isModerator) {
    if (statusFilter) {
      where.status = statusFilter;
    }
  } else {
    if (statusFilter && PARTICIPANT_VISIBLE.includes(statusFilter)) {
      where.status = statusFilter;
    } else {
      where.status = { in: PARTICIPANT_VISIBLE };
    }
  }

  // Short-lived cache for participant Q&A polling (2s TTL).
  // With 300 participants polling every 3s, this reduces DB queries
  // from ~100/s to ~1 every 2s per event.
  // Cache stores question data WITHOUT per-user hasUpvoted; that's
  // resolved per-request from a lightweight upvote lookup.
  //
  // La cache vale SOLO quando il push non è disponibile, cioè quando i client
  // stanno ancora interrogando ogni tre secondi. Con il push attivo i client
  // rileggono subito dopo una scrittura e non c'è un secondo giro a rimediare:
  // un processo diverso da quello che ha scritto risponderebbe con l'elenco di
  // prima, e quella risposta resterebbe sullo schermo. L'invalidazione locale
  // non basta, perché ogni richiesta può finire su una replica qualsiasi.
  const pushAttivo = getRedis()?.status === 'ready';
  const cacheKey =
    isModerator || pushAttivo ? null : `qa:${event.id}:${statusFilter ?? 'all'}`;

  interface CachedQuestion {
    id: string;
    authorName: string;
    text: string;
    status: string;
    upvoteCount: number;
    createdAt: string;
    highlightedAt: string | null;
    answeredAt: string | null;
  }

  interface QaResponse {
    questions: (CachedQuestion & { hasUpvoted: boolean })[];
    totalCount: number;
    /** Il pollice in su ha bisogno di un'identità che il server sappia
     *  riconoscere, e ce l'ha solo chi si è iscritto. Ospiti e relatori
     *  leggono; senza questo campo il pannello mostrava loro un pulsante che
     *  rispondeva 401 in silenzio. */
    canUpvote: boolean;
  }

  let cachedQuestions: CachedQuestion[] | null = null;

  if (cacheKey) {
    cachedQuestions = getCached<CachedQuestion[]>(cacheKey) ?? null;
  }

  if (!cachedQuestions) {
    const questions = await prisma.question.findMany({
      where,
      orderBy: [{ status: 'asc' }, { upvoteCount: 'desc' }, { createdAt: 'desc' }],
    });

    cachedQuestions = questions.map((q) => ({
      id: q.id,
      authorName: q.authorName,
      text: q.text,
      status: q.status,
      upvoteCount: q.upvoteCount,
      createdAt: q.createdAt.toISOString(),
      highlightedAt: q.highlightedAt?.toISOString() ?? null,
      answeredAt: q.answeredAt?.toISOString() ?? null,
    }));

    if (cacheKey) {
      setCache(cacheKey, cachedQuestions, 2000);
    }
  }

  let userUpvotedIds: Set<string> = new Set();
  if (registrationId && cachedQuestions.length > 0) {
    const upvotes = await prisma.questionUpvote.findMany({
      where: {
        registrationId,
        questionId: { in: cachedQuestions.map((q) => q.id) },
      },
      select: { questionId: true },
    });
    userUpvotedIds = new Set(upvotes.map((u) => u.questionId));
  }

  const result = cachedQuestions.map((q) => ({
    ...q,
    hasUpvoted: userUpvotedIds.has(q.id),
  }));

  const highlighted = result.filter((q) => q.status === 'HIGHLIGHTED');
  const rest = result.filter((q) => q.status !== 'HIGHLIGHTED');

  const response: QaResponse = {
    questions: [...highlighted, ...rest],
    totalCount: result.length,
    canUpvote: registrationId !== null,
  };

  return Response.json(response, {
    headers: { 'Cache-Control': 'no-store' },
  });
});

// ── POST /api/events/[slug]/questions ────────────────────────

export const POST = withErrorHandling(async (request, context) => {
  const { param: slug } = await context.params;

  const body = await parseJsonBody(request);

  const bodyObj =
    body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const { accessToken, guestName, ...rest } = bodyObj;
  const token =
    (typeof accessToken === 'string' ? accessToken : undefined) ??
    new URL(request.url).searchParams.get('token');

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event || !event.qaEnabled) throw new NotFoundError('Event');

  let registrationId: string | null = null;
  let authorName = '';

  if (token) {
    const registration = await prisma.registration.findUnique({
      where: { accessToken: token as string },
      select: { id: true, eventId: true, displayName: true },
    });
    if (registration && registration.eventId === event.id) {
      registrationId = registration.id;
      authorName = tryDecryptPII(registration.displayName) ?? registration.displayName;
    } else {
      // Un relatore ha un grant nominale, non una registrazione: cercarlo
      // solo fra gli iscritti gli faceva rifiutare la domanda con un errore
      // generico, davanti a un modulo che il pannello gli mostrava comunque.
      // Il nome e' quello del grant, cifrato a riposo.
      const grant = await prisma.eventModerator.findUnique({
        where: { token: token as string },
        select: { eventId: true, revokedAt: true, name: true },
      });
      if (!grant || grant.eventId !== event.id || grant.revokedAt !== null) {
        throw new ForbiddenError('Invalid access token');
      }
      authorName = (tryDecryptPII(grant.name) ?? grant.name).slice(0, 80);
    }
  } else {
    // Un ospite chiede solo finché la stanza è aperta a chi arriva senza
    // token: stessa finestra di chat e sondaggi, che tiene conto anche
    // dell'accesso ospiti deciso dall'amministrazione. Fuori da lì in sala
    // non c'è nessun ospite, e la domanda arriverebbe da chi non può entrare.
    if (!guestWindowOpen(event, (await getSettings()).guestAccessEnabled)) {
      throw new UnauthorizedError('Token required');
    }
    // Guest path: requires a non-empty display name, rate-limited by IP
    // since there's no stable participant id to key on.
    const name = typeof guestName === 'string' ? guestName.trim() : '';
    if (name.length < 2) {
      throw new UnauthorizedError('guestName required for anonymous Q&A');
    }
    authorName = name.slice(0, 80);
  }

  const parsed = createQuestionSchema.safeParse(rest);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message }))
    );
  }

  const rlKey = registrationId
    ? `qa:${registrationId}`
    : `qa-guest:${getClientIp(request)}`;
  const rl = rateLimit(rlKey, { limit: 1, windowMs: 30_000 });
  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  }

  const question = await prisma.question.create({
    data: {
      eventId: event.id,
      registrationId: registrationId ?? undefined,
      authorName,
      text: parsed.data.text,
    },
  });

  deleteCacheByPrefix(`qa:${event.id}:`);
  pokeLivePanel(event.id, 'qa');

  return Response.json(
    {
      id: question.id,
      authorName: question.authorName,
      text: question.text,
      status: question.status,
      upvoteCount: question.upvoteCount,
      hasUpvoted: false,
      createdAt: question.createdAt.toISOString(),
      highlightedAt: null,
      answeredAt: null,
    },
    { status: 201 }
  );
});
