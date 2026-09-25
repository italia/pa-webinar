import { parseJsonBody, withErrorHandling } from '@/lib/api-handler';
import {
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  RateLimitError,
  ValidationError,
} from '@/lib/errors';
import { deleteCacheByPrefix } from '@/lib/cache';
import { prisma } from '@/lib/db';
import {
  authorizePanelRead,
  PANEL_READ_EVENT_SELECT,
} from '@/lib/events/panel-read-access';
import { pokeLivePanel } from '@/lib/live-state/publish';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { upvoteQuestionSchema } from '@/lib/validation/schemas';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Con chi il server lega il voto: sempre UNA identità, mai un campo vuoto.
 *  Un `guestId: undefined` in una `where` di Prisma sparirebbe dal filtro, e
 *  il ritiro del voto toglierebbe quelli di tutti. La registrazione vota in
 *  `question_upvotes`, l'identificativo del browser in `question_guest_upvotes`. */
type Votante = { registrationId: string } | { guestId: string };

// ── POST /api/events/[slug]/questions/[id]/upvote — toggle ──

export const POST = withErrorHandling(async (request, context) => {
  const { param: slug, id: questionId } = await context.params;

  let body: unknown = null;
  try {
    body = await parseJsonBody(request);
  } catch {
    // Il corpo è facoltativo: l'iscritto può passare il token come ?token=.
  }
  const parsed = upvoteQuestionSchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }

  const accessToken =
    parsed.data.accessToken ?? new URL(request.url).searchParams.get('token') ?? undefined;
  const { guestId } = parsed.data;

  if (!accessToken && !guestId) throw new UnauthorizedError('Access token required');

  const event = await prisma.event.findUnique({
    where: { slug },
    select: PANEL_READ_EVENT_SELECT,
  });
  if (!event) throw new NotFoundError('Event');

  let votante: Votante;
  let rlKey: string;

  if (accessToken) {
    const registration = await prisma.registration.findUnique({
      where: { accessToken },
      select: { id: true, eventId: true },
    });
    if (!registration || registration.eventId !== event.id) {
      throw new ForbiddenError('Invalid access token');
    }
    votante = { registrationId: registration.id };
    rlKey = `upvote:${registration.id}`;
  } else if (guestId) {
    // Chi vota con l'identificativo del browser — ospiti, relatori e
    // moderatori — supera lo stesso cancello della lettura del pannello, come
    // nei sondaggi e nella nuvola: chi conduce mostra il proprio token di sala
    // (prova di presenza, non identità), l'ospite passa solo finché la stanza
    // è aperta a chi arriva col link e non è protetta da password.
    //
    // Il tetto per indirizzo viene PRIMA del resto: l'identificativo lo sceglie
    // il client, e senza tetto chi lo cambia a ogni clic gonfierebbe una
    // domanda a piacere. Largo come quello della nuvola, per la stessa
    // ragione: dietro l'uscita di un ente sta una sala intera, e ognuno può
    // sostenere più domande. Trecento sono sessanta persone da cinque voti.
    const ip = getClientIp(request);
    const ipRl = rateLimit(`upvote-ip:${event.id}:${ip}`, { limit: 300, windowMs: 60_000 });
    if (!ipRl.allowed) {
      throw new RateLimitError((ipRl.resetAt - Date.now()) / 1000, 'NETWORK_RATE_LIMIT');
    }

    const authHeader = request.headers.get('authorization');
    const bearer = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7).trim() || null
      : null;
    const reader = await authorizePanelRead(event, bearer);

    // Un iscritto che arriva con la propria registrazione come Bearer vota con
    // quella: se valesse anche l'identificativo del browser, la stessa persona
    // conterebbe due volte.
    if (reader.registrationId) {
      votante = { registrationId: reader.registrationId };
      rlKey = `upvote:${reader.registrationId}`;
    } else {
      votante = { guestId };
      rlKey = `upvote-guest:${event.id}:${guestId}`;
    }
  } else {
    throw new UnauthorizedError('Access token required');
  }

  const rl = rateLimit(rlKey, { limit: 10, windowMs: 60_000 });
  if (!rl.allowed) throw new RateLimitError((rl.resetAt - Date.now()) / 1000);

  // Un identificativo che non è un UUID non è una domanda: senza questo
  // controllo arriverebbe al DB, che lo rifiuta con un errore interno.
  if (!UUID_RE.test(questionId)) throw new NotFoundError('Question');

  const question = await prisma.question.findUnique({
    where: { id: questionId },
    select: { id: true, eventId: true },
  });
  if (!question || question.eventId !== event.id) {
    throw new NotFoundError('Question');
  }

  // Toglie il voto se c'è, altrimenti lo mette, e il contatore segue le righe
  // nella stessa transazione. Due clic ravvicinati non producono un errore:
  // l'inserimento che trova già il voto (indice univoco) non fa nulla, e il
  // contatore si muove di quante righe sono cambiate davvero. Il contatore è
  // uno solo per le due tabelle.
  const esito = await prisma.$transaction(async (tx) => {
    const tolti =
      'registrationId' in votante
        ? await tx.questionUpvote.deleteMany({
            where: { questionId, registrationId: votante.registrationId },
          })
        : await tx.questionGuestUpvote.deleteMany({
            where: { questionId, guestId: votante.guestId },
          });
    if (tolti.count > 0) {
      const q = await tx.question.update({
        where: { id: questionId },
        data: { upvoteCount: { decrement: tolti.count } },
        select: { upvoteCount: true },
      });
      return { upvoted: false, upvoteCount: Math.max(0, q.upvoteCount) };
    }
    const messi =
      'registrationId' in votante
        ? await tx.questionUpvote.createMany({
            data: [{ questionId, registrationId: votante.registrationId }],
            skipDuplicates: true,
          })
        : await tx.questionGuestUpvote.createMany({
            data: [{ questionId, guestId: votante.guestId }],
            skipDuplicates: true,
          });
    const q = await tx.question.update({
      where: { id: questionId },
      data: { upvoteCount: { increment: messi.count } },
      select: { upvoteCount: true },
    });
    return { upvoted: true, upvoteCount: q.upvoteCount };
  });

  deleteCacheByPrefix(`qa:${event.id}:`);
  pokeLivePanel(event.id, 'qa');

  return Response.json(esito);
});
