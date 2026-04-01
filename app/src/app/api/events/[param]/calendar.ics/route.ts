import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import { generateEventICal } from '@/lib/ical/generate';
import { resolveLocale, localiseEvent } from '@/lib/utils/locale';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ param: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const { param: slug } = await context.params;

  const event = await prisma.event.findUnique({ where: { slug } });

  if (!event || event.status === 'DRAFT') {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  const locale = resolveLocale(request);
  const { title, description } = localiseEvent(event, locale);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const eventUrl = `${baseUrl}/${locale}/eventi/${slug}`;

  const ics = generateEventICal({
    title,
    description,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    timezone: event.timezone,
    url: eventUrl,
    organizerName: event.moderatorName ?? 'Eventi DTD',
    organizerEmail:
      event.moderatorEmail ??
      process.env.SMTP_FROM ??
      'noreply@dominio.gov.it',
  });

  return new NextResponse(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="evento-${slug}.ics"`,
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
