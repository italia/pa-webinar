import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import {
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  ValidationError,
} from '@/lib/errors';
import { constantTimeEqual, extractModeratorToken } from '@/lib/auth/moderator';
import { prisma } from '@/lib/db';
import { createReminderSchema, REMINDER_PRESETS } from '@/lib/validation/schemas';

export const dynamic = 'force-dynamic';

// ── GET /api/events/[slug]/reminders ─────────────────────

export const GET = withErrorHandling(async (request, context) => {
  const { param: slug } = await context.params;

  const token = extractModeratorToken(request);
  if (!token) throw new UnauthorizedError('Moderator token required');

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event || !constantTimeEqual(event.moderatorToken, token)) {
    throw new ForbiddenError('Unauthorized');
  }

  const reminders = await prisma.eventReminder.findMany({
    where: { eventId: event.id },
    include: { _count: { select: { sentRecords: true } } },
    orderBy: { offsetMinutes: 'desc' },
  });

  return Response.json({
    reminders: reminders.map((r) => ({
      id: r.id,
      offsetMinutes: r.offsetMinutes,
      label: r.label,
      sentCount: r._count.sentRecords,
      createdAt: r.createdAt.toISOString(),
    })),
  });
});

// ── POST /api/events/[slug]/reminders ────────────────────

export const POST = withErrorHandling(async (request, context) => {
  const { param: slug } = await context.params;

  const token = extractModeratorToken(request);
  if (!token) throw new UnauthorizedError('Moderator token required');

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event || !constantTimeEqual(event.moderatorToken, token)) {
    throw new ForbiddenError('Unauthorized');
  }

  const body = await parseJsonBody(request);
  const parsed = createReminderSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Validation failed', parsed.error.issues.map((i) => ({ path: i.path, message: i.message })));
  }

  // Max 5 reminders per event
  const count = await prisma.eventReminder.count({ where: { eventId: event.id } });
  if (count >= 5) {
    throw new ValidationError('Maximum 5 reminders per event');
  }

  // Check for duplicate offset
  const existing = await prisma.eventReminder.findFirst({
    where: { eventId: event.id, offsetMinutes: parsed.data.offsetMinutes },
  });
  if (existing) {
    throw new ConflictError('Reminder with this offset already exists');
  }

  const preset = REMINDER_PRESETS.find((p) => p.offsetMinutes === parsed.data.offsetMinutes);
  const label = preset?.labelIt ?? `${parsed.data.offsetMinutes} min prima`;

  const reminder = await prisma.eventReminder.create({
    data: {
      eventId: event.id,
      offsetMinutes: parsed.data.offsetMinutes,
      label,
    },
  });

  return Response.json(
    {
      id: reminder.id,
      offsetMinutes: reminder.offsetMinutes,
      label: reminder.label,
      sentCount: 0,
      createdAt: reminder.createdAt.toISOString(),
    },
    { status: 201 },
  );
});
