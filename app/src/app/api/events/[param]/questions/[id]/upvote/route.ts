import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ param: string; id: string }>;
}

// ── POST /api/events/[slug]/questions/[id]/upvote — toggle ──

export async function POST(request: Request, context: RouteContext) {
  const { param: slug, id: questionId } = await context.params;

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // body is optional, token can be in query
  }

  const token =
    (body.accessToken as string | undefined) ??
    new URL(request.url).searchParams.get('token');

  if (!token) {
    return NextResponse.json({ error: 'Access token required' }, { status: 401 });
  }

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  const registration = await prisma.registration.findUnique({
    where: { accessToken: token },
    select: { id: true, eventId: true },
  });
  if (!registration || registration.eventId !== event.id) {
    return NextResponse.json({ error: 'Invalid access token' }, { status: 403 });
  }

  const question = await prisma.question.findUnique({
    where: { id: questionId },
    select: { id: true, eventId: true },
  });
  if (!question || question.eventId !== event.id) {
    return NextResponse.json({ error: 'Question not found' }, { status: 404 });
  }

  const existing = await prisma.questionUpvote.findUnique({
    where: {
      questionId_registrationId: {
        questionId,
        registrationId: registration.id,
      },
    },
  });

  if (existing) {
    const [, updated] = await prisma.$transaction([
      prisma.questionUpvote.delete({ where: { id: existing.id } }),
      prisma.question.update({
        where: { id: questionId },
        data: { upvoteCount: { decrement: 1 } },
      }),
    ]);

    return NextResponse.json({
      upvoted: false,
      upvoteCount: Math.max(0, updated.upvoteCount),
    });
  }

  const [, updated] = await prisma.$transaction([
    prisma.questionUpvote.create({
      data: { questionId, registrationId: registration.id },
    }),
    prisma.question.update({
      where: { id: questionId },
      data: { upvoteCount: { increment: 1 } },
    }),
  ]);

  return NextResponse.json({
    upvoted: true,
    upvoteCount: updated.upvoteCount,
  });
}
