/**
 * POST /api/events/[param]/listen-only
 *
 * Il browser di chi e' in solo ascolto dice quale endpoint del bridge e' il
 * suo, provandolo con il token della sala che il portale gli ha dato: il
 * token dice `listenOnly`, che e' cio' che il bridge applica
 * (mod_pa_media_lock). Chi modera lo vede nella scheda Partecipanti
 * (GET /seats, `listenOnly`) e non gli offre «Dai la parola». Un token che
 * non e' in solo ascolto non segna niente.
 */
import { z } from 'zod';

import { parseJsonBody, withErrorHandling } from '@/lib/api-handler';
import { postoDaTokenSala } from '@/lib/auth/jwt';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError, RateLimitError, ValidationError } from '@/lib/errors';
import { segnaSoloAscolto } from '@/lib/live/seats';
import { getClientIp, rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const schema = z
  .object({
    endpointId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    roomToken: z.string().min(1).max(4096),
  })
  .strict();

export const POST = withErrorHandling(async (request, context) => {
  const { param: slug } = await context.params;
  const rl = rateLimit(`listen-only:${getClientIp(request)}`, {
    limit: 30,
    windowMs: 60_000,
  });
  if (!rl.allowed) throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  const parsed = schema.safeParse(await parseJsonBody(request, 8192));
  if (!parsed.success) throw new ValidationError('Invalid body');

  const event = await prisma.event.findUnique({
    where: { slug },
    select: { id: true, jitsiRoomName: true },
  });
  if (!event) throw new NotFoundError('Event');
  const prova = await postoDaTokenSala(parsed.data.roomToken, event.jitsiRoomName);
  if (!prova)
    throw new AppError('No valid room token for this event', 401, 'ROOM_TOKEN_INVALID');
  if (prova.listenOnly) await segnaSoloAscolto(event.id, parsed.data.endpointId);
  return new Response(null, { status: 204 });
});
