// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * GET /api/internal/recording-metadata?room=<stanza>
 *
 * I metadati che lo script di fine registrazione scrive nel file del video:
 * titolo, chi organizza, data, descrizione e chi conduce. Nel video compare solo
 * chi conduce (ADR-022): moderatori e relatori, con il nome di chi modera dal
 * link primario e delle concessioni nominali ancora valide. Chi partecipa non
 * compare, e non compare nemmeno qui, ne' con il nome ne' con il nickname: il
 * file del video circola oltre la piattaforma e la sua conservazione. Solo con
 * la chiave delle macchine (`CRON_API_KEY`).
 */
import { NextResponse } from 'next/server';

import { withErrorHandling } from '@/lib/api-handler';
import { assertCronApiKey } from '@/lib/auth/cron';
import { NotFoundError } from '@/lib/errors';
import { prisma } from '@/lib/db';
import { nomiOrganizzatori } from '@/lib/events/organizer-names';
import { tryDecryptPII } from '@/lib/crypto/pii';
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
      additionalMods: {
        where: { revokedAt: null },
        select: { name: true, role: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!event) throw new NotFoundError('Event');

  const title = getLocalized(event.title as LocalizedField, 'it');
  const description = getLocalized(event.description as LocalizedField, 'it');

  // Chi conduce, una volta per nome: chi modera dal link primario e le
  // concessioni nominali.
  const hosts: Array<{ name: string; role: 'moderator' | 'speaker' }> = [];
  const aggiungi = (nome: string | null | undefined, role: 'moderator' | 'speaker') => {
    const name = nome?.trim();
    if (name && !hosts.some((h) => h.name === name)) hosts.push({ name, role });
  };
  aggiungi(
    event.moderatorName ? (tryDecryptPII(event.moderatorName) ?? event.moderatorName) : null,
    'moderator'
  );
  for (const m of event.additionalMods) {
    aggiungi(tryDecryptPII(m.name) ?? m.name, m.role === 'SPEAKER' ? 'speaker' : 'moderator');
  }

  return NextResponse.json({
    title,
    description: description.slice(0, 500),
    organizer: nomiOrganizzatori(event) || event.moderatorName || '',
    date: event.startsAt.toISOString().split('T')[0],
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    hosts,
  });
});
