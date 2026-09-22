import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import {
  NotFoundError,
  ForbiddenError,
  ConflictError,
  RateLimitError,
  ValidationError,
  AppError,
} from '@/lib/errors';
import { deleteCacheByPrefix } from '@/lib/cache';
import { prisma } from '@/lib/db';
import { guestWindowOpen } from '@/lib/events/guest-window';
import { hasJoinGrant } from '@/lib/events/join-grant';
import { pokeLivePanel } from '@/lib/live-state/publish';
import { pollVoteSchema } from '@/lib/validation/schemas';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// ── POST /api/events/[slug]/polls/[id]/vote ──

export const POST = withErrorHandling(async (request, context) => {
  const { param: slug, id: pollId } = await context.params;

  const body = await parseJsonBody(request);
  const parsed = pollVoteSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message }))
    );
  }

  const { optionIndex, accessToken, guestId } = parsed.data;

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event) throw new NotFoundError('Event');

  const ip = getClientIp(request);
  const ipRl = rateLimit(`poll-vote-ip:${ip}:${event.id}`, {
    limit: 60,
    windowMs: 60_000,
  });
  if (!ipRl.allowed) {
    throw new RateLimitError((ipRl.resetAt - Date.now()) / 1000);
  }

  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    select: { id: true, eventId: true, status: true, options: true },
  });

  if (!poll || poll.eventId !== event.id) {
    throw new NotFoundError('Poll');
  }

  if (poll.status !== 'OPEN') {
    throw new ConflictError('Poll is closed');
  }

  const options = poll.options as string[];
  if (optionIndex >= options.length) {
    throw new AppError('Invalid option index', 400, 'BAD_REQUEST');
  }

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

    const rl = rateLimit(`poll-vote:${reg.id}`, { limit: 10, windowMs: 60_000 });
    if (!rl.allowed) throw new RateLimitError();

    const existing = await prisma.pollVote.findUnique({
      where: { pollId_registrationId: { pollId, registrationId: reg.id } },
    });
    if (existing) throw new ConflictError('Already voted');
  } else if (guestId) {
    // Chi vota con l'identificativo del browser — ospiti, relatori e
    // moderatori, che una registrazione non ce l'hanno — passa di qui.
    // Attenzione a cosa questo controllo è e a cosa non è: verifica che la
    // STANZA sia aperta, con la stessa soglia della lettura, non chi bussa.
    // L'identificativo è scelto dal client, quindi la deduplica vale per
    // browser onesto: è la stessa garanzia delle reazioni all'agenda, e un
    // sondaggio in sala non è un'elezione. Legare il voto a un'identità
    // firmata è un lavoro a sé, non una riga in più qui.
    if (!guestWindowOpen(event)) {
      throw new ForbiddenError('Voting requires a participant token');
    }
    if (event.joinPasswordHash && !(await hasJoinGrant(event.id))) {
      throw new ForbiddenError('Voting requires the event join password');
    }

    const rl = rateLimit(`poll-vote-guest:${guestId}`, { limit: 10, windowMs: 60_000 });
    if (!rl.allowed) throw new RateLimitError();

    const existing = await prisma.pollVote.findUnique({
      where: { pollId_guestId: { pollId, guestId } },
    });
    if (existing) throw new ConflictError('Already voted');
  }

  try {
    await prisma.pollVote.create({
      data: {
        pollId,
        registrationId,
        guestId: guestId || null,
        optionIndex,
      },
    });
  } catch (e) {
    // Il controllo qui sopra e la scrittura non sono un'operazione sola: due
    // clic ravvicinati passano entrambi. È l'indice univoco a dire l'ultima
    // parola, e quel rifiuto è lo stesso «hai già votato» — non un errore
    // interno, che il pannello mostrerebbe come guasto.
    if ((e as { code?: string })?.code === 'P2002') {
      throw new ConflictError('Already voted');
    }
    throw e;
  }

  deleteCacheByPrefix(`polls:${event.id}`);
  pokeLivePanel(event.id, 'polls');

  return Response.json({ ok: true, optionIndex }, { status: 201 });
});
