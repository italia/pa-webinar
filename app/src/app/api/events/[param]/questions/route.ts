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
  // Chi non ha una registrazione (ospiti, relatori, moderatori) vota con
  // l'identificativo stabile del browser, come nei sondaggi: è con quello che
  // il pannello sa quali domande ha già sostenuto. Oltre i cento caratteri
  // non è un identificativo che il voto accetterebbe, quindi non lo è nemmeno
  // qui.
  const guestIdParam = url.searchParams.get('guestId')?.trim() ?? '';
  const guestId = guestIdParam.length > 0 && guestIdParam.length <= 100 ? guestIdParam : null;

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
     *  riconoscere: la registrazione di un iscritto, o l'identificativo del
     *  browser che chi non è iscritto manda come `?guestId=`. Senza nessuna
     *  delle due il pannello mostra il numero e non il pulsante, che
     *  risponderebbe 401. */
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

  // I voti di chi chiede: per registrazione se c'è, altrimenti per browser.
  // Stessa precedenza del voto, che lega alla registrazione anche l'iscritto
  // che manda l'identificativo del browser.
  const votante = registrationId ? { registrationId } : guestId ? { guestId } : null;

  // Questa ricerca non passa dalla cache: è una query in più per ogni
  // lettura di chi ha un'identità di voto, e la sala manda l'identificativo
  // del browser a tutti quelli che non sono iscritti. Si cercano solo le
  // domande che hanno almeno un voto: finché nessuna ne ha, la query non
  // parte affatto.
  const conVoti = cachedQuestions.filter((q) => q.upvoteCount > 0).map((q) => q.id);
  let userUpvotedIds: Set<string> = new Set();
  if (votante && conVoti.length > 0) {
    const upvotes =
      'registrationId' in votante
        ? await prisma.questionUpvote.findMany({
            where: { registrationId: votante.registrationId, questionId: { in: conVoti } },
            select: { questionId: true },
          })
        : await prisma.questionGuestUpvote.findMany({
            where: { guestId: votante.guestId, questionId: { in: conVoti } },
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
    canUpvote: votante !== null,
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
  let grantId: string | null = null;
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
        select: { id: true, eventId: true, revokedAt: true, name: true },
      });
      if (!grant || grant.eventId !== event.id || grant.revokedAt !== null) {
        throw new ForbiddenError('Invalid access token');
      }
      grantId = grant.id;
      authorName = (tryDecryptPII(grant.name) ?? grant.name).slice(0, 80);
    }
  } else {
    // Un ospite chiede solo se può stare nella stanza: stesso cancello della
    // lettura del pannello (finestra degli ospiti, che tiene conto anche
    // dell'accesso ospiti deciso dall'amministrazione, e password
    // d'ingresso). Chi ha solo il link di un evento protetto non legge le
    // domande, e non deve poterne scrivere.
    await authorizePanelRead(event, null);
    // L'ospite firma col nome scelto in sala d'attesa.
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

  // Una domanda ogni trenta secondi PER PERSONA. La chiave per indirizzo IP
  // era condivisa da chiunque stia dietro lo stesso NAT — un ufficio, una
  // rete di ente — e da relatori e ospiti insieme: in una chiamata rapida,
  // dove sono tutti ospiti, la prima domanda bloccava quelle dei colleghi per
  // mezzo minuto, e a loro il pannello diceva di aspettare prima di inviarne
  // "un'altra". Il relatore ha il proprio grant; l'ospite l'identificativo
  // del browser, scelto dal client: per questo sull'IP resta un tetto per
  // evento che ferma chi cambia identificativo a ogni domanda. Sessanta al
  // minuto: una sala di sessanta persone dietro un solo NAT che chiedono
  // tutte nello stesso minuto, la stessa capienza del tetto dei sondaggi.
  // Ha un codice suo, perché il pannello non dica a chi non ha ancora chiesto
  // nulla di aspettare prima di un'«altra» domanda. Senza identificativo
  // (client vecchio, chiamata diretta) vale la chiave per IP di prima.
  const guestId = parsed.data.guestId;
  const ip = getClientIp(request);
  // Il tetto viene PRIMA del limite personale, come per sondaggi, agenda e
  // nuvola: la chiave personale dell'ospite la sceglie il client, e se la si
  // registrasse prima ogni identificativo inventato aggiungerebbe una voce
  // alla memoria del limitatore anche quando il tetto poi respinge la
  // domanda. Così un ospite fermato dal tetto non si trova anche il proprio
  // mezzo minuto consumato.
  if (!registrationId && !grantId && guestId) {
    const ipRl = rateLimit(`qa-guest-ip:${event.id}:${ip}`, {
      limit: 60,
      windowMs: 60_000,
    });
    if (!ipRl.allowed) {
      throw new RateLimitError((ipRl.resetAt - Date.now()) / 1000, 'NETWORK_RATE_LIMIT');
    }
  }
  const rlKey = registrationId
    ? `qa:${registrationId}`
    : grantId
      ? `qa-grant:${grantId}`
      : guestId
        ? `qa-guest:${event.id}:${guestId}`
        : `qa-guest:${ip}`;
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
