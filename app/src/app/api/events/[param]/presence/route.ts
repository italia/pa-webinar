/**
 * POST /api/events/:slug/presence — chi c'è, e dove (vedi lib/live/presence).
 *
 * La sala d'attesa e la sala mandano un identificativo casuale e il proprio
 * luogo; la risposta porta i conteggi, così chi è in attesa sa quanti sono già
 * in diretta e quanti aspettano con lui. Nessun dato personale: niente nomi,
 * niente token salvati, niente indirizzi IP. Con `lascia` si esce dal conto.
 *
 * Conta e vede i conteggi solo chi ha accesso alla sala (token di moderatore,
 * relatore o iscrizione, oppure ospite mentre la stanza è aperta a chi arriva
 * col link: la stessa regola dei pannelli, lib/events/panel-read-access), e
 * solo mentre la sala esiste. Chi conosce soltanto l'indirizzo dell'evento non
 * può gonfiare i numeri che vedono gli altri.
 */

import { createHash } from 'node:crypto';

import { z } from 'zod';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import {
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  UnauthorizedError,
  ValidationError,
} from '@/lib/errors';
import { prisma } from '@/lib/db';
import { getCached, setCache } from '@/lib/cache';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { extractModeratorToken } from '@/lib/auth/moderator';
import {
  authorizePanelRead,
  PANEL_READ_EVENT_SELECT,
  type PanelReadEvent,
} from '@/lib/events/panel-read-access';
import { lasciaPresenza, segnaPresenza } from '@/lib/live/presence';

export const dynamic = 'force-dynamic';

const corpo = z.object({
  id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  luogo: z.enum(['attesa', 'diretta']),
  lascia: z.boolean().optional(),
});

/** Gli stati in cui c'è una sala d'attesa o una diretta da contare. */
const STATI_APERTI = new Set(['PUBLISHED', 'IDLE', 'PROVISIONING', 'LIVE']);
const SCONOSCIUTO = { inDiretta: null, inAttesa: null };

/** Quanto vale la decisione d'accesso per un token: ogni scheda segnala ogni
 *  15-30 secondi, e la regola dei pannelli legge il database. */
const ACCESSO_TTL_MS = 30_000;

async function haAccesso(event: PanelReadEvent, token: string | null): Promise<boolean> {
  const decidi = () =>
    authorizePanelRead(event, token).then(
      () => true,
      (err: unknown) => {
        if (err instanceof UnauthorizedError || err instanceof ForbiddenError) return false;
        throw err;
      },
    );
  if (!token) return decidi();
  const chiave = `presence-access:${event.id}:${createHash('sha256').update(token).digest('hex')}`;
  const memo = getCached<boolean>(chiave);
  if (memo !== null) return memo;
  const esito = await decidi();
  setCache(chiave, esito, ACCESSO_TTL_MS);
  return esito;
}

export const POST = withErrorHandling(async (request, context) => {
  const { param: slug } = await context.params;

  // Molte persone dietro la stessa rete di un ente: il limite per indirizzo è
  // largo (una scheda segnala al più quattro volte al minuto), e serve solo
  // contro chi martella.
  const rl = rateLimit(`presence:${getClientIp(request)}`, { limit: 2400, windowMs: 60_000 });
  if (!rl.allowed) throw new RateLimitError((rl.resetAt - Date.now()) / 1000);

  const parsed = corpo.safeParse(await parseJsonBody(request));
  if (!parsed.success) {
    throw new ValidationError('Validation failed', parsed.error.issues.map((i) => ({ path: i.path, message: i.message })));
  }

  // L'evento dallo slug, tenuto in memoria mezzo minuto.
  const chiaveCache = `presence-event:${slug}`;
  let evento = getCached<PanelReadEvent>(chiaveCache);
  if (!evento) {
    const trovato = await prisma.event.findUnique({ where: { slug }, select: PANEL_READ_EVENT_SELECT });
    if (!trovato) throw new NotFoundError('Event');
    evento = trovato;
    setCache(chiaveCache, evento, 30_000);
  }

  const { id, luogo, lascia } = parsed.data;
  if (lascia) {
    // Togliere un identificativo casuale non rivela nulla e non tocca altri.
    await lasciaPresenza(evento.id, id);
    return Response.json(SCONOSCIUTO);
  }
  // Un evento concluso non ha più né attesa né diretta; una bozza o un
  // archivio non hanno sala.
  if (evento.status === 'ENDED') return Response.json({ inDiretta: 0, inAttesa: 0 });
  if (!STATI_APERTI.has(evento.status)) return Response.json(SCONOSCIUTO);

  if (!(await haAccesso(evento, extractModeratorToken(request)))) {
    return Response.json(SCONOSCIUTO);
  }

  const presenze = await segnaPresenza(evento.id, id, luogo);
  return Response.json(presenze ?? SCONOSCIUTO, { headers: { 'Cache-Control': 'no-store' } });
});
