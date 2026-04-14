import { NextResponse } from 'next/server';

import { withErrorHandling } from '@/lib/api-handler';
import { assertCronApiKey } from '@/lib/auth/cron';
import { NotFoundError } from '@/lib/errors';
import { prisma } from '@/lib/db';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (request) => {
  assertCronApiKey(request);

  const room = request.nextUrl.searchParams.get('room');
  if (!room) {
    return NextResponse.json({ error: 'room parameter required' }, { status: 400 });
  }

  const event = await prisma.event.findUnique({
    where: { jitsiRoomName: room },
    select: {
      title: true,
      description: true,
      organizerName: true,
      moderatorName: true,
      startsAt: true,
      endsAt: true,
      registrations: {
        where: { joinedAt: { not: null } },
        select: {
          displayName: true,
          joinedAt: true,
          leftAt: true,
        },
        orderBy: { joinedAt: 'asc' },
      },
    },
  });

  if (!event) throw new NotFoundError('Event');

  const title = getLocalized(event.title as LocalizedField, 'it');
  const description = getLocalized(event.description as LocalizedField, 'it');

  const participants = event.registrations.map((r) => ({
    name: r.displayName,
    joinedAt: r.joinedAt?.toISOString() ?? null,
    leftAt: r.leftAt?.toISOString() ?? null,
  }));

  return NextResponse.json({
    title,
    description: description.slice(0, 500),
    organizer: event.organizerName || event.moderatorName || '',
    date: event.startsAt.toISOString().split('T')[0],
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    participants,
    participantNames: participants.map((p) => p.name),
  });
});
