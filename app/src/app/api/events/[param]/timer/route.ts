import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import {
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  RateLimitError,
  ValidationError,
} from '@/lib/errors';
import { prisma } from '@/lib/db';
import { timerActionSchema } from '@/lib/validation/schemas';
import { isEventModerator, extractModeratorToken } from '@/lib/auth/moderator';
import { recordLiveAction } from '@/lib/live/actions';
import { leggiTimer, scriviTimer, type TimerState } from '@/lib/live/timer-state';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/** Quanto resta visibile «Tempo scaduto» prima che il timer si spenga. */
const SCADUTO_VISIBILE_MS = 30_000;

function resolveRemaining(state: TimerState): number {
  if (!state.active || !state.startedAt) return state.remaining;
  if (state.pausedAt) return state.remaining;
  const elapsed = (Date.now() - state.startedAt) / 1000;
  return Math.max(0, state.remaining - elapsed);
}

/**
 * Allo zero il timer resta acceso ancora un po', così «Tempo scaduto» si vede
 * anche da chi in quel momento guardava altrove; poi si spegne. Si calcola a
 * ogni lettura invece di riscrivere lo stato: lo stato e' condiviso fra le
 * istanze, e una lettura che riscrive potrebbe cancellare un comando del
 * moderatore arrivato nel frattempo a un'altra istanza.
 */
function spentoSeScaduto(state: TimerState): TimerState {
  const remaining = resolveRemaining(state);
  const scadutoAlle =
    state.active && state.startedAt && !state.pausedAt ? state.startedAt + state.remaining * 1000 : null;
  if (state.active && remaining <= 0 && (scadutoAlle === null || Date.now() - scadutoAlle >= SCADUTO_VISIBILE_MS)) {
    return { ...state, active: false, remaining: 0, startedAt: null };
  }
  return state;
}

/** Il timer dell'evento, già spento se è scaduto da un pezzo. */
async function timerDi(eventId: string): Promise<TimerState | null> {
  const state = await leggiTimer(eventId);
  return state ? spentoSeScaduto(state) : null;
}

// POST /api/events/[slug]/timer — moderator sets/updates timer
export const POST = withErrorHandling(async (request, context) => {
  const { param: slug } = await context.params;

  const token = extractModeratorToken(request);
  if (!token) throw new UnauthorizedError('Moderator token required');

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event || !(await isEventModerator(event, token))) {
    throw new ForbiddenError('Unauthorized');
  }

  const ip = getClientIp(request);
  const rl = rateLimit(`timer-set:${ip}:${event.id}`, {
    limit: 30,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  }

  const body = await parseJsonBody(request);
  const parsed = timerActionSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Validation failed', parsed.error.issues.map((i) => ({ path: i.path, message: i.message })));
  }

  const { action, duration, visible } = parsed.data;
  let state = await timerDi(event.id);
  // Il conto alla rovescia stava correndo? Pausa e azzeramento finiscono
  // nella cronologia solo se fermano davvero qualcosa.
  const correvaPrima =
    !!state && state.active && !!state.startedAt && !state.pausedAt && resolveRemaining(state) > 0;

  let ripreso = false;

  switch (action) {
    case 'start': {
      const dur = duration ?? state?.duration ?? 300;
      state = {
        active: true,
        duration: dur,
        remaining: dur,
        visible: visible ?? state?.visible ?? true,
        startedAt: Date.now(),
        pausedAt: null,
      };
      break;
    }
    case 'resume': {
      if (state && state.active && state.pausedAt) {
        state = { ...state, startedAt: Date.now(), pausedAt: null };
        ripreso = true;
      }
      break;
    }
    case 'pause': {
      if (state && state.active && state.startedAt && !state.pausedAt) {
        state = {
          ...state,
          remaining: resolveRemaining(state),
          pausedAt: Date.now(),
          startedAt: null,
        };
      }
      break;
    }
    case 'reset': {
      state = {
        active: false,
        duration: state?.duration ?? 300,
        remaining: state?.duration ?? 300,
        visible: state?.visible ?? true,
        startedAt: null,
        pausedAt: null,
      };
      break;
    }
    case 'visibility': {
      // No-op on the countdown itself: the show-to-all flag is applied by the
      // block below, preserving remaining/startedAt so a running timer keeps
      // ticking instead of restarting.
      break;
    }
  }

  if (visible !== undefined && state) {
    state = { ...state, visible };
  }

  if (state) {
    await scriviTimer(event.id, state);
  }

  if (action === 'start' && state) {
    await recordLiveAction({
      eventId: event.id,
      kind: 'timer.started',
      actor: 'moderator',
      data: { durationSec: state.duration },
    });
  } else if (ripreso && state) {
    await recordLiveAction({
      eventId: event.id,
      kind: 'timer.started',
      actor: 'moderator',
      data: { durationSec: state.duration, resumed: true },
    });
  } else if ((action === 'pause' || action === 'reset') && correvaPrima) {
    await recordLiveAction({ eventId: event.id, kind: 'timer.stopped', actor: 'moderator' });
  }

  const remaining = state ? resolveRemaining(state) : 0;

  return Response.json({
    active: state?.active ?? false,
    duration: state?.duration ?? 0,
    remaining: Math.round(remaining),
    visible: state?.visible ?? false,
    paused: state?.pausedAt !== null && state?.pausedAt !== undefined,
    serverNow: new Date().toISOString(),
  });
});

// GET /api/events/[slug]/timer — get timer state
export const GET = withErrorHandling(async (_request, context) => {
  const { param: slug } = await context.params;

  const event = await prisma.event.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!event) throw new NotFoundError('Event');

  const state = await timerDi(event.id);

  if (!state) {
    return Response.json({
      active: false,
      duration: 0,
      remaining: 0,
      visible: false,
      paused: false,
      serverNow: new Date().toISOString(),
    });
  }

  const remaining = resolveRemaining(state);

  return Response.json({
    active: state.active,
    duration: state.duration,
    remaining: Math.round(Math.max(0, remaining)),
    visible: state.visible,
    paused: state.pausedAt !== null && state.pausedAt !== undefined,
    // L'ora del server: la sala ne ricava lo scarto del proprio orologio.
    serverNow: new Date().toISOString(),
  });
});
