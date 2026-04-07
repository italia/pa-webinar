import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import {
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
} from '@/lib/errors';
import { prisma } from '@/lib/db';
import { timerActionSchema } from '@/lib/validation/schemas';
import { constantTimeEqual, extractModeratorToken } from '@/lib/auth/moderator';
import { getCached, setCache } from '@/lib/cache';

export const dynamic = 'force-dynamic';

interface TimerState {
  active: boolean;
  duration: number;
  remaining: number;
  visible: boolean;
  startedAt: number | null;
  pausedAt: number | null;
}

function getTimerKey(eventId: string): string {
  return `timer:${eventId}`;
}

function resolveRemaining(state: TimerState): number {
  if (!state.active || !state.startedAt) return state.remaining;
  if (state.pausedAt) return state.remaining;
  const elapsed = (Date.now() - state.startedAt) / 1000;
  return Math.max(0, state.remaining - elapsed);
}

// POST /api/events/[slug]/timer — moderator sets/updates timer
export const POST = withErrorHandling(async (request, context) => {
  const { param: slug } = await context.params;

  const token = extractModeratorToken(request);
  if (!token) throw new UnauthorizedError('Moderator token required');

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event || !constantTimeEqual(event.moderatorToken, token)) {
    throw new ForbiddenError('Unauthorized');
  }

  const body = await parseJsonBody(request);
  const parsed = timerActionSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Validation failed', parsed.error.issues.map((i) => ({ path: i.path, message: i.message })));
  }

  const { action, duration, visible } = parsed.data;
  const key = getTimerKey(event.id);
  let state = getCached<TimerState>(key);

  const TTL = 7200_000;

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
  }

  if (visible !== undefined && state) {
    state.visible = visible;
  }

  if (state) {
    setCache(key, state, TTL);
  }

  const remaining = state ? resolveRemaining(state) : 0;

  return Response.json({
    active: state?.active ?? false,
    duration: state?.duration ?? 0,
    remaining: Math.round(remaining),
    visible: state?.visible ?? false,
    paused: state?.pausedAt !== null && state?.pausedAt !== undefined,
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

  const key = getTimerKey(event.id);
  const state = getCached<TimerState>(key);

  if (!state) {
    return Response.json({
      active: false,
      duration: 0,
      remaining: 0,
      visible: false,
      paused: false,
    });
  }

  const remaining = resolveRemaining(state);

  // Auto-expire
  if (state.active && remaining <= 0) {
    state.active = false;
    state.remaining = 0;
    state.startedAt = null;
    setCache(key, state, 7200_000);
  }

  return Response.json({
    active: state.active,
    duration: state.duration,
    remaining: Math.round(Math.max(0, remaining)),
    visible: state.visible,
    paused: state.pausedAt !== null && state.pausedAt !== undefined,
  });
});
