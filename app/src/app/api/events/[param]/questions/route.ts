import type { QuestionStatus } from '@prisma/client';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import {
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  RateLimitError,
  ValidationError,
} from '@/lib/errors';
import { prisma } from '@/lib/db';
import { createQuestionSchema } from '@/lib/validation/schemas';
import { rateLimit } from '@/lib/rate-limit';
import { constantTimeEqual } from '@/lib/auth/moderator';
import { getCached, setCache } from '@/lib/cache';

export const dynamic = 'force-dynamic';

const PARTICIPANT_VISIBLE: QuestionStatus[] = ['PENDING', 'HIGHLIGHTED', 'ANSWERED'];

// ── GET /api/events/[slug]/questions ─────────────────────────

export const GET = withErrorHandling(async (request, context) => {
  const { param: slug } = await context.params;
  const url = new URL(request.url);
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : url.searchParams.get('token');

  if (!token) throw new UnauthorizedError('Token required');

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event) throw new NotFoundError('Event');

  const isModerator = constantTimeEqual(event.moderatorToken, token);
  let registrationId: string | null = null;

  if (!isModerator) {
    const reg = await prisma.registration.findUnique({
      where: { accessToken: token },
      select: { id: true, eventId: true },
    });
    if (!reg || reg.eventId !== event.id) {
      throw new ForbiddenError('Invalid token');
    }
    registrationId = reg.id;
  }

  const statusFilter = url.searchParams.get('status') as QuestionStatus | null;

  const where: Record<string, unknown> = { eventId: event.id };
  if (isModerator) {
    if (statusFilter) {
      where.status = statusFilter;
    }
  } else {
    if (statusFilter && PARTICIPANT_VISIBLE.includes(statusFilter)) {
      where.status = statusFilter;
    } else {
      where.status = { in: PARTICIPANT_VISIBLE };
    }
  }

  // Short-lived cache for participant Q&A polling (2s TTL).
  // With 300 participants polling every 3s, this reduces DB queries
  // from ~100/s to ~1 every 2s per event.
  const cacheKey = isModerator
    ? null
    : `qa:${event.id}:${statusFilter ?? 'all'}`;

  interface QaResponse {
    questions: {
      id: string;
      authorName: string;
      text: string;
      status: string;
      upvoteCount: number;
      hasUpvoted: boolean;
      createdAt: string;
      highlightedAt: string | null;
      answeredAt: string | null;
    }[];
    totalCount: number;
  }

  if (cacheKey) {
    const cached = getCached<QaResponse>(cacheKey);
    if (cached) {
      return Response.json(cached, {
        headers: { 'Cache-Control': 'no-store' },
      });
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

  const response: QaResponse = {
    questions: [...highlighted, ...rest],
    totalCount: result.length,
  };

  if (cacheKey) {
    setCache(cacheKey, response, 2000);
  }

  return Response.json(response, {
    headers: { 'Cache-Control': 'no-store' },
  });
});

// ── POST /api/events/[slug]/questions ────────────────────────

export const POST = withErrorHandling(async (request, context) => {
  const { param: slug } = await context.params;

  const body = await parseJsonBody(request);

  const bodyObj = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const { accessToken, ...rest } = bodyObj;
  const token =
    (typeof accessToken === 'string' ? accessToken : undefined) ??
    new URL(request.url).searchParams.get('token');

  if (!token) throw new UnauthorizedError('Access token required');

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event || !event.qaEnabled) throw new NotFoundError('Event');

  const registration = await prisma.registration.findUnique({
    where: { accessToken: token as string },
    select: { id: true, eventId: true, displayName: true },
  });
  if (!registration || registration.eventId !== event.id) {
    throw new ForbiddenError('Invalid access token');
  }

  const parsed = createQuestionSchema.safeParse(rest);
  if (!parsed.success) {
    throw new ValidationError('Validation failed', parsed.error.issues.map((i) => ({ path: i.path, message: i.message })));
  }

  const rl = rateLimit(`qa:${registration.id}`, { limit: 1, windowMs: 30_000 });
  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  }

  const question = await prisma.question.create({
    data: {
      eventId: event.id,
      registrationId: registration.id,
      authorName: registration.displayName,
      text: parsed.data.text,
    },
  });

  return Response.json(
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
});
