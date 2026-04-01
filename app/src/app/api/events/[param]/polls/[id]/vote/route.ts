import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import { pollVoteSchema } from '@/lib/validation/schemas';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ param: string; id: string }>;
}

// ── POST /api/events/[slug]/polls/[id]/vote ──

export async function POST(request: Request, context: RouteContext) {
  const { param: slug, id: pollId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = pollVoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) },
      { status: 422 },
    );
  }

  const { optionIndex, accessToken, guestId } = parsed.data;

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    select: { id: true, eventId: true, status: true, options: true },
  });

  if (!poll || poll.eventId !== event.id) {
    return NextResponse.json({ error: 'Poll not found' }, { status: 404 });
  }

  if (poll.status !== 'OPEN') {
    return NextResponse.json({ error: 'Poll is closed' }, { status: 409 });
  }

  const options = poll.options as string[];
  if (optionIndex >= options.length) {
    return NextResponse.json({ error: 'Invalid option index' }, { status: 400 });
  }

  let registrationId: string | null = null;

  if (accessToken) {
    const reg = await prisma.registration.findUnique({
      where: { accessToken },
      select: { id: true, eventId: true },
    });
    if (!reg || reg.eventId !== event.id) {
      return NextResponse.json({ error: 'Invalid access token' }, { status: 403 });
    }
    registrationId = reg.id;

    const rl = rateLimit(`poll-vote:${reg.id}`, { limit: 10, windowMs: 60_000 });
    if (!rl.allowed) {
      return NextResponse.json({ error: 'rate_limit' }, { status: 429 });
    }

    // Check for existing vote
    const existing = await prisma.pollVote.findUnique({
      where: { pollId_registrationId: { pollId, registrationId: reg.id } },
    });
    if (existing) {
      return NextResponse.json({ error: 'Already voted' }, { status: 409 });
    }
  } else if (guestId) {
    const existing = await prisma.pollVote.findUnique({
      where: { pollId_guestId: { pollId, guestId } },
    });
    if (existing) {
      return NextResponse.json({ error: 'Already voted' }, { status: 409 });
    }
  }

  await prisma.pollVote.create({
    data: {
      pollId,
      registrationId,
      guestId: guestId || null,
      optionIndex,
    },
  });

  return NextResponse.json({ ok: true, optionIndex }, { status: 201 });
}
