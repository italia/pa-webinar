import { NextResponse } from 'next/server';
import type { QuestionStatus } from '@prisma/client';

import { prisma } from '@/lib/db';
import { updateQuestionStatusSchema } from '@/lib/validation/schemas';
import { constantTimeEqual } from '@/lib/auth/moderator';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ param: string; id: string }>;
}

// ── PATCH /api/events/[slug]/questions/[id] — moderator only ─

export async function PATCH(request: Request, context: RouteContext) {
  const { param: slug, id } = await context.params;
  const url = new URL(request.url);
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : url.searchParams.get('token');

  if (!token) {
    return NextResponse.json({ error: 'Token required' }, { status: 401 });
  }

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  if (!constantTimeEqual(event.moderatorToken, token)) {
    return NextResponse.json({ error: 'Moderator access required' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = updateQuestionStatusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) },
      { status: 422 },
    );
  }

  const question = await prisma.question.findUnique({
    where: { id },
    select: { id: true, eventId: true },
  });
  if (!question || question.eventId !== event.id) {
    return NextResponse.json({ error: 'Question not found' }, { status: 404 });
  }

  const newStatus = parsed.data.status as QuestionStatus;
  const data: Record<string, unknown> = {
    status: newStatus,
    // Clear stale timestamps when changing status
    highlightedAt: newStatus === 'HIGHLIGHTED' ? new Date() : null,
    answeredAt: newStatus === 'ANSWERED' ? new Date() : null,
  };

  const updated = await prisma.question.update({
    where: { id },
    data,
  });

  return NextResponse.json({
    id: updated.id,
    authorName: updated.authorName,
    text: updated.text,
    status: updated.status,
    upvoteCount: updated.upvoteCount,
    createdAt: updated.createdAt.toISOString(),
    highlightedAt: updated.highlightedAt?.toISOString() ?? null,
    answeredAt: updated.answeredAt?.toISOString() ?? null,
  });
}
