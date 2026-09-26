import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import {
  AppError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
  RateLimitError,
  ValidationError,
} from '@/lib/errors';
import { prisma } from '@/lib/db';
import { authorizePanelRead } from '@/lib/events/panel-read-access';
import { pokeLivePanel } from '@/lib/live-state/publish';
import { submitWordCloudSchema } from '@/lib/validation/schemas';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// POST /api/events/[slug]/wordcloud/[id]/submit
export const POST = withErrorHandling(async (request, context) => {
  const { param: slug, id: roundId } = await context.params;

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event) throw new NotFoundError('Event');

  // Tetto per indirizzo contro chi cambia identificativo del browser a ogni
  // parola. Largo di proposito: dietro l'uscita di un ente o di un ufficio
  // sta una sala intera, e ognuno scrive fino a cinque parole appena il giro
  // si apre. Con sessanta al minuto dodici colleghi bastavano a esaurirlo e
  // le parole dei successivi si perdevano. Trecento sono sessanta persone
  // da cinque parole, la stessa capienza del tetto dei sondaggi, dove si vota
  // una volta sola. Il limite vero a testa è quello per identità più sotto.
  const ip = getClientIp(request);
  const ipRl = rateLimit(`wc-submit-ip:${ip}:${event.id}`, {
    limit: 300,
    windowMs: 60_000,
  });
  if (!ipRl.allowed) {
    throw new RateLimitError((ipRl.resetAt - Date.now()) / 1000);
  }

  const round = await prisma.wordCloudRound.findUnique({
    where: { id: roundId },
    select: { id: true, eventId: true, status: true, duration: true, createdAt: true },
  });

  if (!round || round.eventId !== event.id) {
    throw new NotFoundError('Word cloud round');
  }

  if (round.status !== 'OPEN') {
    throw new ConflictError('Word cloud round is closed');
  }

  // Tempo scaduto: il giro si chiude qui, e chi lo chiude lo dice alla sala
  // (come la lettura in ../../route.ts). La condizione sullo stato fa scrivere
  // e avvisare solo il primo.
  const elapsedMs = Date.now() - round.createdAt.getTime();
  if (elapsedMs > round.duration * 1000) {
    const chiusi = await prisma.wordCloudRound.updateMany({
      where: { id: round.id, status: 'OPEN' },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    if (chiusi.count > 0) pokeLivePanel(event.id, 'wordcloud');
    throw new ConflictError('Word cloud round has expired');
  }

  const body = await parseJsonBody(request);
  const parsed = submitWordCloudSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message }))
    );
  }

  const { word, accessToken, guestId } = parsed.data;
  let rateLimitKey: string;
  let registrationId: string | null = null;

  if (accessToken) {
    const reg = await prisma.registration.findUnique({
      where: { accessToken },
      select: { id: true, eventId: true },
    });
    if (!reg || reg.eventId !== event.id) {
      throw new ForbiddenError('Invalid access token');
    }
    registrationId = reg.id;
    rateLimitKey = `wc:${reg.id}:${round.id}`;
  } else if (guestId) {
    // Chi non ha una registrazione — ospiti, relatori, moderatori — scrive
    // con l'identificativo stabile del browser, come nei sondaggi, e supera lo
    // stesso cancello della lettura dei pannelli: chi conduce mostra il
    // proprio token di sala (prova di presenza, non identità: il server lo
    // cercherebbe fra le registrazioni), l'ospite passa solo finché la stanza
    // è aperta a chi arriva col link e non è protetta da password.
    const authHeader = request.headers.get('authorization');
    const bearer = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7).trim() || null
      : null;
    await authorizePanelRead(event, bearer);
    rateLimitKey = `wc:guest:${guestId}:${round.id}`;
  } else {
    throw new ForbiddenError('Authentication required');
  }

  // Al massimo cinque parole a testa per giro. Il codice distinto dice al
  // pannello perché la parola non entra: il giro chiuso ha la stessa 409.
  const count = await prisma.wordCloudSubmission.count({
    where: registrationId
      ? { roundId: round.id, registrationId }
      : { roundId: round.id, guestId },
  });
  if (count >= 5) {
    throw new AppError(
      'Maximum submissions reached for this round',
      409,
      'WORD_LIMIT_REACHED',
    );
  }

  const rl = rateLimit(rateLimitKey, { limit: 5, windowMs: 30_000 });
  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  }

  await prisma.wordCloudSubmission.create({
    data: {
      roundId: round.id,
      registrationId,
      guestId: registrationId ? null : (guestId ?? null),
      word: word.toLowerCase().trim(),
    },
  });

  pokeLivePanel(event.id, 'wordcloud');

  return Response.json({ ok: true }, { status: 201 });
});
