import { type PollStatus } from '@prisma/client';
import { NextResponse } from 'next/server';

import { constantTimeEqual, extractModeratorToken } from '@/lib/auth/moderator';
import { prisma } from '@/lib/db';
import { createPollSchema } from '@/lib/validation/schemas';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ param: string }>;
}

// ── GET /api/events/[slug]/polls ─────────────────────────

export async function GET(request: Request, context: RouteContext) {
  const { param: slug } = await context.params;

  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : new URL(request.url).searchParams.get('token');

  if (!token) {
    return NextResponse.json({ error: 'Token required' }, { status: 401 });
  }

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  const isModerator = constantTimeEqual(event.moderatorToken, token);

  // Participants/guests can only see OPEN and PUBLISHED polls
  const where = isModerator
    ? { eventId: event.id }
    : { eventId: event.id, status: { in: ['OPEN', 'PUBLISHED'] as PollStatus[] } };

  const polls = await prisma.poll.findMany({
    where,
    include: {
      _count: { select: { votes: true } },
      votes: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  // Determine if the user has voted on each poll
  let registrationId: string | null = null;
  if (!isModerator) {
    const reg = await prisma.registration.findUnique({
      where: { accessToken: token },
      select: { id: true },
    });
    registrationId = reg?.id ?? null;
  }

  const result = polls.map((poll) => {
    const options = poll.options as string[];
    const totalVotes = poll._count.votes;

    // Count votes per option
    const optionCounts = options.map((_, idx) =>
      poll.votes.filter((v) => v.optionIndex === idx).length,
    );

    // Check if user has voted
    const hasVoted = registrationId
      ? poll.votes.some((v) => v.registrationId === registrationId)
      : false;

    const votedOptionIndex = registrationId
      ? poll.votes.find((v) => v.registrationId === registrationId)?.optionIndex ?? null
      : null;

    // Show results to moderators always, to participants only when PUBLISHED or CLOSED
    const showResults = isModerator || poll.status !== 'OPEN';

    return {
      id: poll.id,
      question: poll.question,
      options,
      status: poll.status,
      totalVotes,
      optionCounts: showResults ? optionCounts : null,
      hasVoted,
      votedOptionIndex,
      createdAt: poll.createdAt.toISOString(),
      closedAt: poll.closedAt?.toISOString() ?? null,
    };
  });

  return NextResponse.json({ polls: result });
}

// ── POST /api/events/[slug]/polls ────────────────────────

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

  const parsed = createPollSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) },
      { status: 422 },
    );
  }

  const poll = await prisma.poll.create({
    data: {
      eventId: event.id,
      question: parsed.data.question,
      options: parsed.data.options,
    },
  });

  return NextResponse.json(
    {
      id: poll.id,
      question: poll.question,
      options: poll.options,
      status: poll.status,
      totalVotes: 0,
      optionCounts: (poll.options as string[]).map(() => 0),
      hasVoted: false,
      votedOptionIndex: null,
      createdAt: poll.createdAt.toISOString(),
      closedAt: null,
    },
    { status: 201 },
  );
}
