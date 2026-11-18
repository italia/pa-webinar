// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * GET /api/admin/recording-removals/recordings?q=
 *
 * Le registrazioni da cui si puo' chiedere di togliere una persona (quelle con
 * un video o con tracce per persona), per il modulo che registra una richiesta
 * arrivata per altre vie. Solo metadati: evento, data, durata.
 */
import { cookies } from 'next/headers';

import { withErrorHandling } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth/staff-session';
import { registrazioneConMedia, registrazioneConVideo } from '@/lib/captions/transcript';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (request) => {
  await requireAdmin(await cookies());
  const cerca = (new URL(request.url).searchParams.get('q') ?? '').trim().slice(0, 100);
  // La ricerca sul titolo in ogni lingua la fa il database: una registrazione
  // di un anno fa si trova anche su un'istanza con migliaia di registrazioni.
  const trovate = cerca
    ? await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT r.id FROM recordings r JOIN events e ON e.id = r.event_id
        WHERE e.title::text ILIKE ${`%${cerca.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}
        ORDER BY r.created_at DESC
        LIMIT 500
      `
    : null;
  const righe = await prisma.recording.findMany({
    where: trovate ? { id: { in: trovate.map((t) => t.id) } } : {},
    orderBy: { createdAt: 'desc' },
    take: 500,
    select: {
      id: true,
      blobKey: true,
      mediaStartedAt: true,
      createdAt: true,
      durationSec: true,
      event: { select: { id: true, title: true, startsAt: true } },
    },
  });
  const recordings = righe
    .filter((r) => registrazioneConMedia(r))
    .slice(0, 100)
    .map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      durationSec: r.durationSec,
      hasVideo: registrazioneConVideo(r),
      event: {
        id: r.event.id,
        title: r.event.title,
        startsAt: r.event.startsAt.toISOString(),
      },
    }));
  return Response.json({ recordings });
});
