import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import { updatePollStatusSchema } from '@/lib/validation/schemas';
import { constantTimeEqual, extractModeratorToken } from '@/lib/auth/moderator';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ param: string; id: string }>;
}

// ── PATCH /api/events/[slug]/polls/[id] — update status ──

export async function PATCH(request: Request, context: RouteContext) {
  const { param: slug, id: pollId } = await context.params;

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

  const parsed = updatePollStatusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) },
      { status: 422 },
    );
  }

  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    select: { id: true, eventId: true },
  });

  if (!poll || poll.eventId !== event.id) {
    return NextResponse.json({ error: 'Poll not found' }, { status: 404 });
  }

  const updated = await prisma.poll.update({
    where: { id: pollId },
    data: {
      status: parsed.data.status,
      closedAt: parsed.data.status !== 'OPEN' ? new Date() : null,
    },
  });

  return NextResponse.json({
    id: updated.id,
    status: updated.status,
    closedAt: updated.closedAt?.toISOString() ?? null,
  });
}

// ── DELETE /api/events/[slug]/polls/[id] ──

export async function DELETE(request: Request, context: RouteContext) {
  const { param: slug, id: pollId } = await context.params;

  const token = extractModeratorToken(request);
  if (!token) {
    return NextResponse.json({ error: 'Moderator token required' }, { status: 401 });
  }

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event || !constantTimeEqual(event.moderatorToken, token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    select: { id: true, eventId: true },
  });

  if (!poll || poll.eventId !== event.id) {
    return NextResponse.json({ error: 'Poll not found' }, { status: 404 });
  }

  await prisma.poll.delete({ where: { id: pollId } });

  return NextResponse.json({ ok: true });
}
