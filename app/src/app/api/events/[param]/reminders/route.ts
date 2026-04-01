import { NextResponse } from 'next/server';

import { constantTimeEqual, extractModeratorToken } from '@/lib/auth/moderator';
import { prisma } from '@/lib/db';
import { createReminderSchema, REMINDER_PRESETS } from '@/lib/validation/schemas';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ param: string }>;
}

// ── GET /api/events/[slug]/reminders ─────────────────────
// Moderator only: list reminders with sent count

export async function GET(request: Request, context: RouteContext) {
  const { param: slug } = await context.params;

  const token = extractModeratorToken(request);
  if (!token) {
    return NextResponse.json({ error: 'Moderator token required' }, { status: 401 });
  }

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event || !constantTimeEqual(event.moderatorToken, token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const reminders = await prisma.eventReminder.findMany({
    where: { eventId: event.id },
    include: { _count: { select: { sentRecords: true } } },
    orderBy: { offsetMinutes: 'desc' },
  });

  return NextResponse.json({
    reminders: reminders.map((r) => ({
      id: r.id,
      offsetMinutes: r.offsetMinutes,
      label: r.label,
      sentCount: r._count.sentRecords,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}

// ── POST /api/events/[slug]/reminders ────────────────────
// Moderator only: add a reminder

export async function POST(request: Request, context: RouteContext) {
  const { param: slug } = await context.params;

  const token = extractModeratorToken(request);
  if (!token) {
    return NextResponse.json({ error: 'Moderator token required' }, { status: 401 });
  }

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event || !constantTimeEqual(event.moderatorToken, token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = createReminderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) },
      { status: 422 },
    );
  }

  // Max 5 reminders per event
  const count = await prisma.eventReminder.count({ where: { eventId: event.id } });
  if (count >= 5) {
    return NextResponse.json({ error: 'Maximum 5 reminders per event' }, { status: 422 });
  }

  // Check for duplicate offset
  const existing = await prisma.eventReminder.findFirst({
    where: { eventId: event.id, offsetMinutes: parsed.data.offsetMinutes },
  });
  if (existing) {
    return NextResponse.json({ error: 'Reminder with this offset already exists' }, { status: 409 });
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

  return NextResponse.json(
    {
      id: reminder.id,
      offsetMinutes: reminder.offsetMinutes,
      label: reminder.label,
      sentCount: 0,
      createdAt: reminder.createdAt.toISOString(),
    },
    { status: 201 },
  );
}
