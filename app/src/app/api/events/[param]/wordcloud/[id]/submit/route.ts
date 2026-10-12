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
import { recordLiveAction } from '@/lib/live/actions';
import { forgetWordcloudLite } from '@/lib/wordcloud/lite';
import { submitWordCloudSchema } from '@/lib/validation/schemas';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { countWordsByPerson, isRoundExpired, normalizeWord } from '@/lib/wordcloud/normalize';

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
    select: {
      id: true,
      eventId: true,
      prompt: true,
      status: true,
      duration: true,
      createdAt: true,
    },
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
  if (isRoundExpired(round)) {
    const chiusi = await prisma.wordCloudRound.updateMany({
      where: { id: round.id, status: 'OPEN' },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    if (chiusi.count > 0) {
      forgetWordcloudLite(event.id);
      pokeLivePanel(event.id, 'wordcloud');
      // Nella cronologia il giro si chiude allo scadere, con le parole piu'
      // scritte (come la lettura in ../../route.ts).
      const visibili = await prisma.wordCloudSubmission.findMany({
        where: { roundId: round.id, hiddenAt: null },
        select: { word: true, registrationId: true, guestId: true },
      });
      await recordLiveAction({
        eventId: event.id,
        kind: 'wordcloud.closed',
        actor: 'system',
        data: {
          roundId: round.id,
          prompt: round.prompt,
          words: countWordsByPerson(visibili).slice(0, 15),
        },
        at: new Date(round.createdAt.getTime() + round.duration * 1000),
      });
    }
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
  // La forma con cui la parola si salva e si conta: «Chiarezza!» = «chiarezza».
  const parola = normalizeWord(word);
  if (!parola) {
    throw new AppError('Word must contain letters or digits', 422, 'WORD_INVALID');
  }

  const chi = registrationId ? { registrationId } : { guestId };

  // Controlli senza transazione: quando una domanda si apre scrive tutta la
  // sala insieme, e metterla in fila su una riga terrebbe occupata una
  // connessione per ogni invio in attesa. Le corse che restano sono rare e
  // innocue: una parola mandata nello stesso istante in cui il moderatore la
  // toglie (la si toglie di nuovo), un doppio invio della stessa persona
  // (la nuvola conta le persone, non le righe).

  // Tolta dal moderatore: in questo giro non torna, da nessuno.
  // Confronti sulla parola normalizzata, come la conta la nuvola: valgono
  // anche per le righe salvate prima della normalizzazione.
  const tolte = await prisma.wordCloudSubmission.findMany({
    where: { roundId: round.id, hiddenAt: { not: null } },
    select: { word: true },
  });
  if (tolte.some((s) => normalizeWord(s.word) === parola)) {
    throw new AppError('This word was removed by the moderator', 409, 'WORD_REMOVED');
  }

  // Una persona, una volta per parola: la grandezza dice quante PERSONE l'hanno
  // scritta. Ripeterla per farla sembrare piu' importante non deve funzionare.
  const mie = await prisma.wordCloudSubmission.findMany({
    where: { roundId: round.id, ...chi },
    select: { word: true },
  });
  if (mie.some((s) => normalizeWord(s.word) === parola)) {
    throw new AppError('You already sent this word', 409, 'WORD_DUPLICATE');
  }

  if (mie.length >= 5) {
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
      word: parola,
    },
  });

  pokeLivePanel(event.id, 'wordcloud');

  return Response.json({ ok: true }, { status: 201 });
});
