// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { NextResponse } from 'next/server';

import { withErrorHandling } from '@/lib/api-handler';
import { assertCronApiKey } from '@/lib/auth/cron';
import { NotFoundError } from '@/lib/errors';
import { prisma } from '@/lib/db';
import { nomiOrganizzatori } from '@/lib/events/organizer-names';
import { tryDecryptPII } from '@/lib/crypto/pii';
import { nicknameDellIscrizione } from '@/lib/live/nickname';
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
      organizers: { select: { name: true }, orderBy: { sortOrder: 'asc' } },
      moderatorName: true,
      startsAt: true,
      endsAt: true,
      registrations: {
        where: { joinedAt: { not: null } },
        select: {
          displayName: true,
          nickname: true,
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

  // Chi ha scelto un nickname compare con quello, come in sala
  // (lib/live/nickname): i metadati finiscono nel file del video.
  const participants = event.registrations.map((r) => ({
    name: nicknameDellIscrizione(r) ?? tryDecryptPII(r.displayName) ?? r.displayName,
    joinedAt: r.joinedAt?.toISOString() ?? null,
    leftAt: r.leftAt?.toISOString() ?? null,
  }));

  return NextResponse.json({
    title,
    description: description.slice(0, 500),
    organizer: nomiOrganizzatori(event) || event.moderatorName || '',
    date: event.startsAt.toISOString().split('T')[0],
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    participants,
    participantNames: participants.map((p) => p.name),
  });
});
