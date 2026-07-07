import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import {
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  RateLimitError,
  ValidationError,
} from '@/lib/errors';
import { isEventModerator, extractModeratorToken } from '@/lib/auth/moderator';
import { prisma } from '@/lib/db';
import { isEventPubliclyVisible } from '@/lib/events/visibility';
import { createMaterialSchema } from '@/lib/validation/schemas';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// ── GET /api/events/[slug]/materials ─────────────────────

export const GET = withErrorHandling(async (_request, context) => {
  const { param: slug } = await context.params;

  const event = await prisma.event.findUnique({
    where: { slug },
    select: {
      id: true,
      status: true,
      eventType: true,
      endsAt: true,
      postEventPublic: true,
      postEventPublicUntil: true,
    },
  });

  // Stessa regola delle pagine pubbliche (lib/events/visibility): i materiali
  // devono restare accessibili anche durante il pre-warm PROVISIONING/IDLE.
  if (!event || !isEventPubliclyVisible(event)) {
    throw new NotFoundError('Event');
  }

  const materials = await prisma.eventMaterial.findMany({
    where: { eventId: event.id },
    orderBy: { createdAt: 'desc' },
  });

  return Response.json({
    materials: materials.map((m) => ({
      id: m.id,
      type: m.type,
      title: m.title,
      url: m.url,
      description: m.description,
      addedBy: m.addedBy,
      createdAt: m.createdAt.toISOString(),
    })),
  });
});

// ── POST /api/events/[slug]/materials ────────────────────

export const POST = withErrorHandling(async (request, context) => {
  const { param: slug } = await context.params;

  const token = extractModeratorToken(request);
  if (!token) throw new UnauthorizedError('Moderator token required');

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event || !(await isEventModerator(event, token))) {
    throw new ForbiddenError('Unauthorized');
  }

  const ip = getClientIp(request);
  const rl = rateLimit(`materials-add:${ip}:${event.id}`, {
    limit: 20,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  }

  const body = await parseJsonBody(request);
  const parsed = createMaterialSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Validation failed', parsed.error.issues.map((i) => ({ path: i.path, message: i.message })));
  }

  const material = await prisma.eventMaterial.create({
    data: {
      eventId: event.id,
      title: parsed.data.title,
      url: parsed.data.url,
      description: parsed.data.description ?? null,
      addedBy: event.moderatorName ?? 'Moderator',
    },
  });

  return Response.json(
    {
      id: material.id,
      type: material.type,
      title: material.title,
      url: material.url,
      description: material.description,
      addedBy: material.addedBy,
      createdAt: material.createdAt.toISOString(),
    },
    { status: 201 },
  );
});
