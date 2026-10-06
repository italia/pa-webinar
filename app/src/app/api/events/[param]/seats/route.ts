/**
 * Chi c'e' dietro ogni riquadro della chiamata (vedi lib/live/seats).
 *
 *   POST { endpointId } → il browser dichiara il proprio endpoint nella
 *        chiamata, con il token della sala come `Authorization: Bearer`.
 *        204 sempre: un endpoint gia' di un altro posto diventa conteso, e la
 *        risposta non lo dice.
 *   GET  → solo per chi modera: { seats: { [endpointId]: { kind, name, email } } }
 *        con nome ed email dell'iscrizione o della concessione.
 */

import { createHash } from 'crypto';

import { z } from 'zod';

import { parseJsonBody, withErrorHandling } from '@/lib/api-handler';
import {
  extractModeratorToken,
  isEventModerator,
  resolveGrantForEvent,
} from '@/lib/auth/moderator';
import { tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { ForbiddenError, NotFoundError, RateLimitError, UnauthorizedError, ValidationError } from '@/lib/errors';
import { readOwnedEventAccessToken } from '@/lib/event-session';
import { claimSeat, readSeats, type Seat } from '@/lib/live/seats';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const claimSchema = z.object({
  // L'endpoint id di Jitsi: poche cifre esadecimali; un tetto largo basta.
  endpointId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
});

async function loadEvent(slug: string) {
  const event = await prisma.event.findUnique({
    where: { slug },
    select: { id: true, moderatorToken: true, moderatorName: true },
  });
  if (!event) throw new NotFoundError('Event');
  return event;
}

export const POST = withErrorHandling(async (request, context) => {
  const { param: slug } = (await context.params) as { param: string };
  const token = extractModeratorToken(request);
  if (!token) throw new UnauthorizedError('Room token required');
  const parsed = claimSchema.safeParse(await parseJsonBody(request, 1024));
  if (!parsed.success) throw new ValidationError('Invalid endpoint id');

  const chiave = createHash('sha256').update(token).digest('hex').slice(0, 32);
  // Un browser dichiara un endpoint a ogni ingresso: poche volte per evento.
  const rl = rateLimit(`seat-claim:${chiave}`, { limit: 12, windowMs: 10 * 60_000 });
  if (!rl.allowed) throw new RateLimitError((rl.resetAt - Date.now()) / 1000);

  const event = await loadEvent(slug);
  let seat: Seat | null = null;
  const registration = await prisma.registration.findUnique({
    where: { accessToken: token },
    select: { id: true, eventId: true },
  });
  if (registration && registration.eventId === event.id) {
    // Come per il token di Jitsi: l'identita' e' del browser che si e'
    // iscritto; un link inoltrato resta riconoscibile come tale.
    const suo = (await readOwnedEventAccessToken(event.id)) === token;
    seat = { k: suo ? 'reg' : 'fwd', id: registration.id };
  } else {
    const grant = await resolveGrantForEvent(event, token);
    if (grant?.isPrimaryShared) seat = { k: 'primary' };
    else if (grant?.grantId) seat = { k: 'grant', id: grant.grantId };
  }
  if (!seat) throw new ForbiddenError('Unknown room token');

  await claimSeat(event.id, parsed.data.endpointId, seat);
  return new Response(null, { status: 204 });
});

type SeatView = {
  kind: 'registration' | 'forwardedLink' | 'grant' | 'sharedModeratorLink' | 'contested';
  name: string | null;
  email: string | null;
};

export const GET = withErrorHandling(async (request, context) => {
  const { param: slug } = (await context.params) as { param: string };
  const event = await loadEvent(slug);
  if (!(await isEventModerator(event, extractModeratorToken(request)))) {
    throw new ForbiddenError('Moderator access required');
  }

  const seats = await readSeats(event.id);
  const regIds = new Set<string>();
  const grantIds = new Set<string>();
  for (const s of Object.values(seats)) {
    if (s.k === 'reg' || s.k === 'fwd') regIds.add(s.id);
    else if (s.k === 'grant') grantIds.add(s.id);
  }
  const [regs, grants] = await Promise.all([
    regIds.size
      ? prisma.registration.findMany({
          where: { id: { in: [...regIds] }, eventId: event.id },
          select: { id: true, displayName: true, email: true },
        })
      : Promise.resolve([]),
    grantIds.size
      ? prisma.eventModerator.findMany({
          where: { id: { in: [...grantIds] }, eventId: event.id },
          select: { id: true, name: true, email: true },
        })
      : Promise.resolve([]),
  ]);
  const chiaro = (v: string | null) => (v ? (tryDecryptPII(v) ?? null) : null);
  const perReg = new Map(regs.map((r) => [r.id, { name: chiaro(r.displayName), email: chiaro(r.email) }]));
  const perGrant = new Map(grants.map((g) => [g.id, { name: chiaro(g.name), email: chiaro(g.email) }]));

  const out: Record<string, SeatView> = {};
  for (const [endpointId, s] of Object.entries(seats)) {
    if (s.k === 'primary' || s.k === 'conflict') {
      out[endpointId] = {
        kind: s.k === 'primary' ? 'sharedModeratorLink' : 'contested',
        name: null,
        email: null,
      };
      continue;
    }
    // Un'iscrizione cancellata nel frattempo non dice piu' niente.
    const dati = s.k === 'grant' ? perGrant.get(s.id) : perReg.get(s.id);
    if (!dati) continue;
    out[endpointId] = {
      kind: s.k === 'reg' ? 'registration' : s.k === 'fwd' ? 'forwardedLink' : 'grant',
      ...dati,
    };
  }
  return Response.json({ seats: out }, { headers: { 'Cache-Control': 'no-store' } });
});
