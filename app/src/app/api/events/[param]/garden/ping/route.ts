/**
 * POST /api/events/:slug/garden/ping
 *
 * Called by the waiting-room garden client a few times per second
 * (throttled on the client at ~5 Hz) to advertise the user's
 * position and receive the current snapshot of peers. The server
 *
 *   1. validates that the event is in a state where the garden is
 *      meaningful (PUBLISHED / PROVISIONING / LIVE — not ENDED);
 *   2. writes the peer to Redis (`garden:<eventId>:pos`) with TTL;
 *   3. publishes on `garden:<eventId>` so subscribers of the SSE
 *      stream see the update;
 *   4. returns the current list of peers so the client also gets a
 *      ~200 ms-fresh snapshot even if the SSE is briefly behind — or says
 *      the snapshot is missing, which is not the same as saying it is empty.
 *
 * Chi ha accesso alla sala (token del moderatore, del relatore o
 * dell'iscrizione, oppure ospite mentre la stanza e' aperta a chi arriva col
 * link: la stessa regola dei pannelli, lib/events/panel-read-access) compare
 * nella piazza e vede i nomi degli altri. Chi conosce solo l'indirizzo
 * dell'evento non compare e vede soltanto quanti sono, senza nomi.
 * Rate-limited per IP. Not persistent: positions live only in Redis for 10 s.
 */

import { createHash, createHmac, randomBytes } from 'node:crypto';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  UnauthorizedError,
} from '@/lib/errors';
import { prisma } from '@/lib/db';
import { isGardenEmote } from '@/lib/garden/emotes';
import {
  listGardenPeers,
  publishGardenPing,
  removeGardenPeer,
  type GardenPeer,
} from '@/lib/garden/pubsub';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { extractModeratorToken } from '@/lib/auth/moderator';
import {
  authorizePanelRead,
  PANEL_READ_EVENT_SELECT,
  type PanelReadEvent,
} from '@/lib/events/panel-read-access';
import { getCached, setCache } from '@/lib/cache';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const pingSchema = z.object({
  userId: z.string().min(8).max(48),
  displayName: z.string().min(1).max(80),
  avatarId: z.string().min(1).max(16),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  facing: z.enum(['down', 'up', 'left', 'right']),
  walkPhase: z.number().min(0).max(1),
  /**
   * Gesto transiente (saluto, cuore, applauso…). `.optional()` NON è pigrizia: i client
   * già in giro non mandano il campo e devono continuare a pingare senza
   * beccarsi un 400. Il server fa solo da ripetitore — `at` è l'orologio del
   * mittente e serve al ricevente per deduplicare (vedi GardenPeer.emote).
   */
  emote: z
    .object({
      // Un nome breve qualsiasi: un gesto che questo server non conosce (un
      // client più nuovo, durante un aggiornamento) non deve far rifiutare il
      // ping intero, posizione compresa. Lo si scarta più sotto: agli altri
      // arrivano solo i gesti dell'elenco.
      type: z.string().max(16),
      at: z.number().int().nonnegative(),
    })
    .optional(),
  /** When true the server removes the peer — used on "Leave garden". */
  leave: z.boolean().optional(),
});

/** Quanto vale la decisione per un token: il ping arriva a 5 Hz per persona,
 *  e la regola dei pannelli legge il database (fino a tre letture). Come la
 *  cache del moderatore: una concessione revocata smette di valere entro
 *  pochi secondi anche qui. */
const ACCESSO_TTL_MS = 5_000;

/** Chiave per gli identificativi opachi della risposta anonima. */
const CHIAVE_ANONIMI = process.env.APP_SECRET || randomBytes(32).toString('hex');

/**
 * Chi non ha accesso non riceve l'identificativo vero di nessuno: con quello
 * potrebbe mandare `leave` a nome di altri e farli sparire dalla piazza. Gli
 * arriva un identificativo opaco ma stabile, cosi' gli avatar non si
 * rimescolano a ogni ping.
 */
function identificativoOpaco(eventId: string, userId: string): string {
  return `anon_${createHmac('sha256', CHIAVE_ANONIMI).update(`${eventId}:${userId}`).digest('hex').slice(0, 16)}`;
}

/**
 * Un token che non risolve conta come nessun accesso: qui non c'e' nulla da
 * far fallire a voce alta, la persona vede la piazza senza nomi. Un errore
 * del database invece risale (500), e non resta in memoria come un rifiuto.
 */
async function haAccessoAllaSala(
  event: PanelReadEvent,
  token: string | null,
): Promise<boolean> {
  const decidi = () =>
    authorizePanelRead(event, token).then(
      () => true,
      (err: unknown) => {
        if (err instanceof UnauthorizedError || err instanceof ForbiddenError) return false;
        throw err;
      },
    );
  // Senza token la regola non tocca il database (finestra ospiti, cookie della
  // password): niente da memorizzare.
  if (!token) return decidi();
  const chiave = `garden-access:${event.id}:${createHash('sha256').update(token).digest('hex')}`;
  const memo = getCached<boolean>(chiave);
  if (memo !== null) return memo;
  const esito = await decidi();
  setCache(chiave, esito, ACCESSO_TTL_MS);
  return esito;
}

export const POST = withErrorHandling(async (request, context) => {
  const { param } = await context.params;

  const ip = getClientIp(request);
  // Generous cap: ~5 Hz × 60 s = 300 pings/min. Well above what a
  // well-behaved client sends; catches runaway loops.
  const rl = rateLimit(`garden-ping:${ip}`, { limit: 600, windowMs: 60_000 });
  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  }

  const body = await parseJsonBody(request);
  const parsed = pingSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError('Invalid ping', 400, 'BAD_REQUEST');
  }

  const isUuid = UUID_RE.test(param);
  const event = await prisma.event.findFirst({
    where: isUuid ? { OR: [{ id: param }, { slug: param }] } : { slug: param },
    select: PANEL_READ_EVENT_SELECT,
  });
  if (!event) throw new NotFoundError('Event');

  // Garden is only meaningful before/during the live call. After
  // ENDED there's nothing to wait for — reject silently so stragglers
  // don't keep writing.
  if (event.status === 'ENDED' || event.status === 'DRAFT' || event.status === 'IDLE') {
    return NextResponse.json({ peers: [], active: false });
  }

  if (parsed.data.leave) {
    await removeGardenPeer(event.id, parsed.data.userId);
    return NextResponse.json({ peers: [], active: true, left: true });
  }

  // Senza accesso alla sala: nessuna presenza scritta, e degli altri solo il
  // numero (posizioni senza nomi).
  if (!(await haAccessoAllaSala(event, extractModeratorToken(request)))) {
    const altri = await listGardenPeers(event.id);
    if (altri === null) return NextResponse.json({ peers: [], active: true, degraded: true });
    return NextResponse.json({
      peers: altri.map((p) => ({
        ...p,
        userId: identificativoOpaco(event.id, p.userId),
        displayName: '',
      })),
      active: true,
      anonymous: true,
    });
  }

  const peer: GardenPeer = {
    userId: parsed.data.userId,
    displayName: parsed.data.displayName.slice(0, 80),
    avatarId: parsed.data.avatarId,
    x: parsed.data.x,
    y: parsed.data.y,
    facing: parsed.data.facing,
    walkPhase: parsed.data.walkPhase,
    updatedAt: Date.now(),
    // Presente solo quando il client la manda: mettere `emote: undefined` la
    // farebbe sparire comunque nel JSON, ma così il record Redis resta
    // identico a prima per i client che non emotano.
    ...(parsed.data.emote && isGardenEmote(parsed.data.emote.type)
      ? { emote: { type: parsed.data.emote.type, at: parsed.data.emote.at } }
      : {}),
  };

  await publishGardenPing(event.id, peer);
  const peers = await listGardenPeers(event.id);
  // `degraded` is ADDITIVE: clients that don't know it read `peers` as
  // before. It exists because an empty list and a read that didn't happen
  // are indistinguishable on the wire, and the client reacts to them in
  // opposite ways — to the first it takes the avatars away, to the second it
  // has to keep them.
  if (peers === null) {
    return NextResponse.json({ peers: [], active: true, degraded: true });
  }

  return NextResponse.json({ peers, active: true });
});
