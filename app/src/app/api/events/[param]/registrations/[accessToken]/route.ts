import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ param: string; accessToken: string }>;
}

// ── GET /api/events/[slug]/registrations/[accessToken] ───────

export async function GET(_request: Request, context: RouteContext) {
  const { param: slug, accessToken } = await context.params;

  const registration = await prisma.registration.findUnique({
    where: { accessToken },
    include: { event: { select: { slug: true, titleIt: true, titleEn: true, status: true } } },
  });

  if (!registration || registration.event.slug !== slug) {
    return NextResponse.json(
      { error: 'Registration not found' },
      { status: 404 },
    );
  }

  return NextResponse.json({
    id: registration.id,
    displayName: registration.displayName,
    eventSlug: registration.event.slug,
    eventTitle: registration.event.titleIt,
    eventTitleEn: registration.event.titleEn,
    eventStatus: registration.event.status,
    joinedAt: registration.joinedAt?.toISOString() ?? null,
  });
}
