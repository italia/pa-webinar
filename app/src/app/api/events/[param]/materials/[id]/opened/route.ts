/**
 * POST /api/events/[param]/materials/[id]/opened — qualcuno ha aperto un link
 * o scaricato un file fra i materiali dell'evento.
 *
 * Lo manda il browser al clic sul materiale, senza aspettare la risposta: il
 * link apre comunque la destinazione da solo. Serve a chi conduce per sapere
 * quanto è stato usato un materiale (`openCount`, che il GET dell'elenco
 * restituisce solo a chi vede tutte le fasi).
 *
 * COSA CONTA. Solo un materiale che il chiamante vedrebbe nell'elenco, con la
 * stessa regola del GET (lib/events/material-access): evento con una pagina
 * pubblica, fase del materiale visibile al pubblico, stanza aperta per un
 * evento protetto da password. Il token di sala è facoltativo (la scheda
 * pubblica non ne ha) e viaggia solo come Bearer.
 *
 * CHI NON CONTA. Chi vede tutte le fasi (il token di chi conduce) e chi ha una
 * sessione dello staff: i loro controlli, spesso prima dell'evento, non sono
 * pubblico e gonfierebbero il numero.
 *
 * SOLO DALLA SALA. La richiesta deve dichiarare `Content-Type:
 * application/json`: un'altra pagina non può mandarla senza la richiesta
 * preliminare CORS, che qui non è accolta, e quindi non può far contare
 * aperture a chi la visita. Senza, 204 e niente conta.
 *
 * QUANTE VOLTE. Una per chiamante e materiale ogni dieci minuti: un doppio
 * clic o una scheda riaperta non gonfiano il numero. Il chiamante è il suo
 * token di sala, se ne mostra uno valido per l'evento (con un hash: il token
 * non resta in memoria in chiaro), altrimenti l'indirizzo del client. Un token
 * qualsiasi non vale come identità: inventandone uno nuovo a ogni richiesta si
 * gonfierebbe il conteggio. L'indirizzo non finisce nei log. Il limite sta in
 * memoria nel processo, come gli altri limiti per minuto: con più repliche il
 * conteggio resta indicativo, non una statistica esatta.
 *
 * RISPOSTA. Sempre 204, contato o no: un materiale invisibile, di un altro
 * evento, inesistente o già contato rispondono allo stesso modo, e la
 * risposta non dice se un materiale esiste. Nessun avviso sul canale della
 * sala: un'apertura non cambia ciò che vede il pubblico, e chi conduce trova
 * il numero aggiornato alla rilettura successiva dell'elenco.
 */

import { createHash } from 'node:crypto';

import { cookies } from 'next/headers';
import { z } from 'zod';

import { withErrorHandling } from '@/lib/api-handler';
import { extractModeratorToken } from '@/lib/auth/moderator';
import { getStaffSession } from '@/lib/auth/staff-session';
import { prisma } from '@/lib/db';
import { UnauthorizedError } from '@/lib/errors';
import {
  MATERIAL_LIST_EVENT_SELECT,
  isRoomToken,
  materialAccessFor,
  type MaterialAccess,
} from '@/lib/events/material-access';
import { isEventPubliclyVisible } from '@/lib/events/visibility';
import { getClientIp, rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/** Quanto vale un'apertura per lo stesso chiamante e lo stesso materiale. */
const FINESTRA_MS = 10 * 60_000;

const paramsSchema = z.object({
  param: z.string().min(1).max(200),
  id: z.string().uuid(),
});

const senzaCorpo = () => new Response(null, { status: 204 });

/** Il corpo dichiarato come JSON (parametri come `charset` ammessi). */
function dichiaraJson(request: Request): boolean {
  const tipo = request.headers.get('content-type') ?? '';
  return (tipo.split(';')[0] ?? '').trim().toLowerCase() === 'application/json';
}

export const POST = withErrorHandling(async (request, context) => {
  if (!dichiaraJson(request)) return senzaCorpo();
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return senzaCorpo();
  const { param: slug, id } = params.data;

  const event = await prisma.event.findUnique({
    where: { slug },
    select: MATERIAL_LIST_EVENT_SELECT,
  });
  if (!event || !isEventPubliclyVisible(event)) return senzaCorpo();

  const token = extractModeratorToken(request);
  let access: MaterialAccess;
  try {
    access = await materialAccessFor(event, token);
  } catch (err) {
    // Evento protetto da password e chiamante fuori dalla stanza: per lui
    // l'elenco è chiuso, e niente conta.
    if (err instanceof UnauthorizedError) return senzaCorpo();
    throw err;
  }
  // Chi conduce o amministra controlla, non apre da pubblico.
  if (access.seesAll || (await getStaffSession(await cookies()))) return senzaCorpo();

  const material = await prisma.eventMaterial.findFirst({
    where: { ...access.where, id },
    select: { id: true },
  });
  if (!material) return senzaCorpo();

  const chiamante =
    token && (await isRoomToken(event, token))
      ? `t:${createHash('sha256').update(token).digest('base64url')}`
      : `ip:${getClientIp(request)}`;
  const rl = rateLimit(`material-opened:${material.id}:${chiamante}`, {
    limit: 1,
    windowMs: FINESTRA_MS,
  });
  if (!rl.allowed) return senzaCorpo();

  // Incremento atomico nel database; `updateMany` perché un materiale tolto
  // nel frattempo non è un errore: semplicemente non conta.
  await prisma.eventMaterial.updateMany({
    where: { id: material.id, eventId: event.id },
    data: { openCount: { increment: 1 } },
  });

  return senzaCorpo();
});
