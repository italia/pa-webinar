import { NextResponse } from 'next/server';
import type { QuestionStatus } from '@prisma/client';

import { prisma } from '@/lib/db';
import { createQuestionSchema } from '@/lib/validation/schemas';
import { rateLimit } from '@/lib/rate-limit';
import { constantTimeEqual } from '@/lib/auth/moderator';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ param: string }>;
}

const PARTICIPANT_VISIBLE: QuestionStatus[] = ['PENDING', 'HIGHLIGHTED', 'ANSWERED'];

// ── GET /api/events/[slug]/questions ─────────────────────────

export async function GET(request: Request, context: RouteContext) {
  const { param: slug } = await context.params;
  const url = new URL(request.url);
  // Accept token from Authorization header (preferred) or query param (fallback)
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

  const isModerator = constantTimeEqual(event.moderatorToken, token);
  let registrationId: string | null = null;

  if (!isModerator) {
    const reg = await prisma.registration.findUnique({
      where: { accessToken: token },
      select: { id: true, eventId: true },
    });
    if (!reg || reg.eventId !== event.id) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 403 });
    }
    registrationId = reg.id;
  }

  const statusFilter = url.searchParams.get('status') as QuestionStatus | null;

  const where: Record<string, unknown> = { eventId: event.id };
  if (isModerator) {
    // Moderators can filter by any status
    if (statusFilter) {
      where.status = statusFilter;
    }
  } else {
    // Participants can only see PARTICIPANT_VISIBLE statuses
    if (statusFilter && PARTICIPANT_VISIBLE.includes(statusFilter)) {
      where.status = statusFilter;
    } else {
      where.status = { in: PARTICIPANT_VISIBLE };
    }
  }

  const questions = await prisma.question.findMany({
    where,
    include: {
      upvotes: registrationId
        ? { where: { registrationId }, select: { id: true } }
        : false,
    },
    orderBy: [
      { status: 'asc' },
      { upvoteCount: 'desc' },
      { createdAt: 'desc' },
    ],
  });

  const result = questions.map((q) => ({
    id: q.id,
    authorName: q.authorName,
    text: q.text,
    status: q.status,
    upvoteCount: q.upvoteCount,
    hasUpvoted: Array.isArray(q.upvotes) ? q.upvotes.length > 0 : false,
    createdAt: q.createdAt.toISOString(),
    highlightedAt: q.highlightedAt?.toISOString() ?? null,
    answeredAt: q.answeredAt?.toISOString() ?? null,
  }));

  const highlighted = result.filter((q) => q.status === 'HIGHLIGHTED');
  const rest = result.filter((q) => q.status !== 'HIGHLIGHTED');

  return NextResponse.json({
    questions: [...highlighted, ...rest],
    totalCount: result.length,
  });
}

// ── POST /api/events/[slug]/questions ────────────────────────

export async function POST(request: Request, context: RouteContext) {
  const { param: slug } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const bodyObj = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const { accessToken, ...rest } = bodyObj;
  const token =
    (typeof accessToken === 'string' ? accessToken : undefined) ??
    new URL(request.url).searchParams.get('token');

  if (!token) {
    return NextResponse.json({ error: 'Access token required' }, { status: 401 });
  }

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event || !event.qaEnabled) {
    return NextResponse.json({ error: 'Event not found or Q&A disabled' }, { status: 404 });
  }

  const registration = await prisma.registration.findUnique({
    where: { accessToken: token as string },
    select: { id: true, eventId: true, displayName: true },
  });
  if (!registration || registration.eventId !== event.id) {
    return NextResponse.json({ error: 'Invalid access token' }, { status: 403 });
  }

  const parsed = createQuestionSchema.safeParse(rest);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) },
      { status: 422 },
    );
  }

  const rl = rateLimit(`qa:${registration.id}`, { limit: 1, windowMs: 30_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'rate_limit', message: 'Wait before submitting another question' },
      { status: 429 },
    );
  }

  const question = await prisma.question.create({
    data: {
      eventId: event.id,
      registrationId: registration.id,
      authorName: registration.displayName,
      text: parsed.data.text,
    },
  });

  return NextResponse.json(
    {
      id: question.id,
      authorName: question.authorName,
      text: question.text,
      status: question.status,
      upvoteCount: question.upvoteCount,
      hasUpvoted: false,
      createdAt: question.createdAt.toISOString(),
      highlightedAt: null,
      answeredAt: null,
    },
    { status: 201 },
  );
}
