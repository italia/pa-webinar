/**
 * Publications hub — unified feed of every event that has a playable
 * recording (self-hosted or YouTube) or is otherwise relevant to an
 * admin curating the public library.
 *
 * Sources aggregated:
 *   1. SCHEDULED event with `recordingPublished=true` and a blob URL
 *   2. SCHEDULED/INSTANT event with a `youtubeUrl`
 *   3. LEGACY import (always has a youtubeUrl)
 *   4. INSTANT event with at least one CallSession.recordingUrl — the
 *      session recording is pending admin promotion to a proper library
 *      entry. Surfaced so the admin notices and decides.
 *
 * Each row carries enough metadata for the admin UI (title, type,
 * library-listed flag, cover preview, number of linked recordings, …)
 * without returning the bulky per-row prisma payload.
 */

import { cookies } from 'next/headers';
import type { EventType } from '@prisma/client';

import { withErrorHandling } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { prisma } from '@/lib/db';
import { UnauthorizedError } from '@/lib/errors';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import { resolveLocale } from '@/lib/utils/locale';

export const dynamic = 'force-dynamic';

type PublicationSource = 'scheduled' | 'instant' | 'legacy';

interface PublicationRow {
  id: string;
  slug: string;
  title: string;
  description: string;
  source: PublicationSource;
  eventType: EventType;
  status: string;
  startsAt: string;
  endsAt: string;
  libraryListed: boolean;
  postEventPublic: boolean;
  coverImageUrl: string | null;
  imageUrl: string | null;
  youtubeUrl: string | null;
  hasPublishedRecording: boolean;
  recordingPublishedAt: string | null;
  pendingSessionRecordings: number;
  registrationCount: number;
}

export const GET = withErrorHandling(async (request) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const url = new URL(request.url);
  const locale = resolveLocale(request);
  const sourceFilter = url.searchParams.get('source'); // scheduled|instant|legacy|pending|all
  const listedFilter = url.searchParams.get('listed'); // yes|no|any
  const search = url.searchParams.get('q')?.trim() ?? '';

  // Pull every event that *could* be a publication: ENDED schedule with
  // a recording or youtubeUrl, legacy imports, and instant calls that
  // have ever had a recording. We then post-process into PublicationRow.
  const events = await prisma.event.findMany({
    where: {
      OR: [
        { AND: [{ recordingPublished: true }, { recordingUrl: { not: null } }] },
        { youtubeUrl: { not: null } },
        { eventType: 'LEGACY' },
        {
          AND: [
            { eventType: 'INSTANT' },
            { callSessions: { some: { recordingUrl: { not: null } } } },
          ],
        },
      ],
    },
    orderBy: [{ recordingPublishedAt: 'desc' }, { endsAt: 'desc' }],
    include: {
      _count: {
        select: {
          registrations: true,
          callSessions: true,
        },
      },
      callSessions: {
        where: { recordingUrl: { not: null } },
        select: { id: true },
      },
    },
  });

  const rowsRaw: PublicationRow[] = events.map((e) => {
    const source: PublicationSource =
      e.eventType === 'LEGACY'
        ? 'legacy'
        : e.eventType === 'INSTANT'
          ? 'instant'
          : 'scheduled';
    return {
      id: e.id,
      slug: e.slug,
      title: getLocalized(e.title as LocalizedField, locale),
      description: getLocalized(e.description as LocalizedField, locale),
      source,
      eventType: e.eventType,
      status: e.status,
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt.toISOString(),
      libraryListed: e.libraryListed,
      postEventPublic: e.postEventPublic,
      coverImageUrl: e.coverImageUrl,
      imageUrl: e.imageUrl,
      youtubeUrl: e.youtubeUrl,
      hasPublishedRecording: Boolean(e.recordingPublished && e.recordingUrl),
      recordingPublishedAt: e.recordingPublishedAt?.toISOString() ?? null,
      pendingSessionRecordings: e.callSessions.length,
      registrationCount: e._count.registrations,
    };
  });

  // Client-side filters (post-fetch to keep the Prisma query simple and
  // able to fall back to sourceFilter=pending without a second query).
  const rows = rowsRaw.filter((r) => {
    if (sourceFilter && sourceFilter !== 'all') {
      if (sourceFilter === 'pending') {
        if (r.pendingSessionRecordings === 0 || r.libraryListed) return false;
      } else if (r.source !== sourceFilter) {
        return false;
      }
    }
    if (listedFilter === 'yes' && !r.libraryListed) return false;
    if (listedFilter === 'no' && r.libraryListed) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !r.title.toLowerCase().includes(q) &&
        !r.description.toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    return true;
  });

  return Response.json(
    {
      rows,
      total: rows.length,
      counters: {
        scheduled: rowsRaw.filter((r) => r.source === 'scheduled').length,
        instant: rowsRaw.filter((r) => r.source === 'instant').length,
        legacy: rowsRaw.filter((r) => r.source === 'legacy').length,
        pending: rowsRaw.filter((r) => r.pendingSessionRecordings > 0 && !r.libraryListed).length,
        listed: rowsRaw.filter((r) => r.libraryListed).length,
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});
