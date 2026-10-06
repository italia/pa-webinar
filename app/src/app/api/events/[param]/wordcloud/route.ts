import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import {
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
} from '@/lib/errors';
import { prisma } from '@/lib/db';
import { pokeLivePanel } from '@/lib/live-state/publish';
import { recordLiveAction } from '@/lib/live/actions';
import { createWordCloudRoundSchema } from '@/lib/validation/schemas';
import { isEventModerator, extractModeratorToken } from '@/lib/auth/moderator';
import { authorizePanelRead, PANEL_READ_EVENT_SELECT, type PanelReadEvent } from '@/lib/events/panel-read-access';
import { countWordsByPerson, isRoundExpired } from '@/lib/wordcloud/normalize';
import { WORDCLOUD_LITE_TTL_MS, forgetWordcloudLite, wordcloudLiteKey } from '@/lib/wordcloud/lite';
import { getCached, setCache } from '@/lib/cache';

export const dynamic = 'force-dynamic';

/** Lettura leggera: quanto restano in caldo l'evento e l'esito del controllo
 *  di un token. Brevi: lo stato dell'evento decide la finestra degli ospiti,
 *  e un accesso revocato smette di leggere entro un minuto. */
const LITE_EVENT_TTL_MS = 5_000;
const LITE_AUTH_TTL_MS = 60_000;

// POST /api/events/[slug]/wordcloud — create round (moderator)
export const POST = withErrorHandling(async (request, context) => {
  const { param: slug } = await context.params;

  const token = extractModeratorToken(request);
  if (!token) throw new UnauthorizedError('Moderator token required');

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event || !(await isEventModerator(event, token))) {
    throw new ForbiddenError('Unauthorized');
  }

  const body = await parseJsonBody(request);
  const parsed = createWordCloudRoundSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message }))
    );
  }

  // Due aperture ravvicinate (doppio click, due schede del moderatore) possono
  // incrociarsi e lasciare due giri aperti: la lettura ne mostra uno solo, e le
  // parole di chi ha in mano l'altro spariscono senza errore.
  //
  // La sola transazione NON basta: con l'isolamento predefinito di PostgreSQL
  // nessuna delle due vede il giro non ancora confermato dell'altra, quindi
  // entrambe chiudono il vecchio e ne creano uno nuovo. Si serializza prendendo
  // il lucchetto sulla riga dell'evento: la seconda apertura aspetta la prima e
  // ne chiude il giro.
  // Le domande ancora aperte che la nuova chiude: nella cronologia della sala
  // ci vanno chiuse, con le loro parole, come una chiusura del moderatore.
  let chiuseDallaNuova: Array<{
    id: string;
    prompt: string;
    duration: number;
    createdAt: Date;
    submissions: Array<{ word: string; registrationId: string | null; guestId: string | null }>;
  }> = [];
  const round = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM events WHERE id = ${event.id}::uuid FOR UPDATE`;
    chiuseDallaNuova = await tx.wordCloudRound.findMany({
      where: { eventId: event.id, status: 'OPEN' },
      select: {
        id: true,
        prompt: true,
        duration: true,
        createdAt: true,
        submissions: {
          where: { hiddenAt: null },
          select: { word: true, registrationId: true, guestId: true },
        },
      },
    });
    await tx.wordCloudRound.updateMany({
      where: { eventId: event.id, status: 'OPEN' },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    return tx.wordCloudRound.create({
      data: {
        eventId: event.id,
        prompt: parsed.data.prompt,
        duration: parsed.data.duration,
      },
    });
  });

  forgetWordcloudLite(event.id);
  pokeLivePanel(event.id, 'wordcloud');

  const adesso = Date.now();
  for (const vecchia of chiuseDallaNuova) {
    // Scaduta e non ancora chiusa da una lettura: e' finita allo scadere.
    const scadenza =
      vecchia.duration > 0 ? vecchia.createdAt.getTime() + vecchia.duration * 1000 : Infinity;
    await recordLiveAction({
      eventId: event.id,
      kind: 'wordcloud.closed',
      actor: 'moderator',
      at: new Date(Math.min(adesso, scadenza)),
      data: {
        roundId: vecchia.id,
        prompt: vecchia.prompt,
        words: countWordsByPerson(vecchia.submissions).slice(0, 15),
      },
    });
  }

  await recordLiveAction({
    eventId: event.id,
    kind: 'wordcloud.opened',
    actor: 'moderator',
    data: { roundId: round.id, prompt: round.prompt, duration: round.duration },
  });

  return Response.json(
    {
      id: round.id,
      prompt: round.prompt,
      status: round.status,
      duration: round.duration,
      createdAt: round.createdAt.toISOString(),
      words: [],
    },
    { status: 201 }
  );
});

// GET /api/events/[slug]/wordcloud — get active round with aggregated words
export const GET = withErrorHandling(async (request, context) => {
  const { param: slug } = await context.params;

  // Lettura leggera per il pallino sulla scheda: c'e' una domanda aperta, e
  // quale. Niente parole e nessuna scrittura (la chiusura allo scadere la fa
  // la lettura completa). Passa la stessa regola di lettura del pannello;
  // la risposta, uguale per tutti, si tiene in caldo.
  if (new URL(request.url).searchParams.get('lite') === '1') {
    // La segue ogni presente a ogni parola inviata: l'evento e l'esito del
    // controllo di chi ha un token restano in caldo, cosi' una rilettura e'
    // fatta di memoria e non di query.
    let ev = getCached<PanelReadEvent>(`wordcloud-lite-event:${slug}`);
    if (!ev) {
      ev = await prisma.event.findUnique({ where: { slug }, select: PANEL_READ_EVENT_SELECT });
      if (!ev) throw new NotFoundError('Event');
      setCache(`wordcloud-lite-event:${slug}`, ev, LITE_EVENT_TTL_MS);
    }
    const token = extractModeratorToken(request) || null;
    const autorizzato = token ? `wordcloud-lite-auth:${ev.id}:${token}` : null;
    if (!autorizzato || !getCached<true>(autorizzato)) {
      await authorizePanelRead(ev, token);
      if (autorizzato) setCache(autorizzato, true, LITE_AUTH_TTL_MS);
    }
    const inCaldo = getCached<{ active: boolean; id?: string }>(wordcloudLiteKey(ev.id));
    if (inCaldo) return Response.json(inCaldo);
    const ultimo = await prisma.wordCloudRound.findFirst({
      where: { eventId: ev.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, duration: true, createdAt: true },
    });
    const corpo = ultimo
      ? { active: ultimo.status === 'OPEN' && !isRoundExpired(ultimo), id: ultimo.id }
      : { active: false };
    setCache(wordcloudLiteKey(ev.id), corpo, WORDCLOUD_LITE_TTL_MS);
    return Response.json(corpo);
  }

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event) throw new NotFoundError('Event');

  // Stessa regola di lettura di domande e sondaggi: la nuvola è fatta delle
  // parole di chi sta in sala, e chi non può entrare — fuori dalla finestra
  // degli ospiti, o senza la password di un evento protetto — non la legge.
  // Il `Bearer ` vuoto che manda l'ospite è l'assenza di token.
  await authorizePanelRead(event, extractModeratorToken(request) || null);

  const round = await prisma.wordCloudRound.findFirst({
    where: { eventId: event.id },
    orderBy: { createdAt: 'desc' },
    include: {
      submissions: {
        select: { word: true, registrationId: true, guestId: true, hiddenAt: true },
      },
    },
  });

  if (!round) {
    return Response.json({ active: false });
  }

  // Aggregate word counts
  // Si contano le PERSONE per parola, non gli invii: anche le righe salvate
  // prima della regola «una volta per parola» non gonfiano niente. Le parole
  // tolte dal moderatore non ci sono.
  const visibili = round.submissions.filter((s) => !s.hiddenAt);
  const words = countWordsByPerson(visibili);

  // Auto-close if duration exceeded
  if (round.status === 'OPEN') {
    if (isRoundExpired(round)) {
      // Allo scadere del conto alla rovescia la sala intera rilegge nello
      // stesso secondo: la condizione sullo stato fa scrivere solo la prima.
      const closedAt = new Date();
      const chiusi = await prisma.wordCloudRound.updateMany({
        where: { id: round.id, status: 'OPEN' },
        data: { status: 'CLOSED', closedAt },
      });
      round.status = 'CLOSED';
      round.closedAt = closedAt;
      // Chi l'ha chiuso lo dice alla sala: chi ha l'orologio avanti ha già
      // riletto trovandolo aperto, e senza avviso lo vedrebbe aperto fino al
      // prossimo giro periodico, con le parole respinte.
      if (chiusi.count > 0) {
        forgetWordcloudLite(event.id);
        pokeLivePanel(event.id, 'wordcloud');
        // Nella cronologia il giro si chiude allo scadere, non alla lettura
        // che se ne accorge.
        await recordLiveAction({
          eventId: event.id,
          kind: 'wordcloud.closed',
          actor: 'system',
          data: { roundId: round.id, prompt: round.prompt, words: words.slice(0, 15) },
          at: new Date(round.createdAt.getTime() + round.duration * 1000),
        });
      }
    }
  }

  return Response.json({
    active: round.status === 'OPEN',
    id: round.id,
    prompt: round.prompt,
    status: round.status,
    duration: round.duration,
    createdAt: round.createdAt.toISOString(),
    closedAt: round.closedAt?.toISOString() ?? null,
    totalSubmissions: visibili.length,
    words,
  });
});
