import { NextResponse } from 'next/server';

import { constantTimeEqual, extractModeratorToken } from '@/lib/auth/moderator';
import { prisma } from '@/lib/db';
import { createMaterialSchema } from '@/lib/validation/schemas';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ param: string }>;
}

// ── GET /api/events/[slug]/materials ─────────────────────
// Public: no auth needed

export async function GET(_request: Request, context: RouteContext) {
  const { param: slug } = await context.params;

  const event = await prisma.event.findUnique({
    where: { slug },
    select: { id: true, status: true },
  });

  if (!event || !['PUBLISHED', 'LIVE', 'ENDED'].includes(event.status)) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  const materials = await prisma.eventMaterial.findMany({
    where: { eventId: event.id },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({
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
}

// ── POST /api/events/[slug]/materials ────────────────────
// Moderator only

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

  const parsed = createMaterialSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) },
      { status: 422 },
    );
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

  return NextResponse.json(
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
}
