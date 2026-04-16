/**
 * Public video library feed.
 *
 * Lists every event that has a playable recording — either a published
 * self-hosted file (`recordingUrl` + `recordingPublished`) or a YouTube
 * URL. Only events whose post-event page is public make the list, so an
 * admin can hide a recording from the library by unpublishing the
 * event's post-event page without deleting the recording itself.
 *
 * Shape is intentionally compact: no accessTokens, no participant data,
 * just what the browsable library page needs.
 */

import type { Prisma } from '@prisma/client';

import { withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import { resolveLocale } from '@/lib/utils/locale';

export const dynamic = 'force-dynamic';

const PAGE_SIZE_DEFAULT = 24;
const PAGE_SIZE_MAX = 100;

export const GET = withErrorHandling(async (request) => {
  const url = new URL(request.url);
  const locale = resolveLocale(request);
  const search = url.searchParams.get('q')?.trim() ?? '';
  const pageRaw = Number(url.searchParams.get('page') ?? '1');
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  const pageSizeRaw = Number(url.searchParams.get('pageSize') ?? PAGE_SIZE_DEFAULT);
  const pageSize = Math.min(
    Math.max(1, Number.isFinite(pageSizeRaw) ? Math.floor(pageSizeRaw) : PAGE_SIZE_DEFAULT),
    PAGE_SIZE_MAX,
  );

  const where: Prisma.EventWhereInput = {
    status: 'ENDED',
    postEventPublic: true,
    OR: [
      { AND: [{ recordingPublished: true }, { recordingUrl: { not: null } }] },
      { youtubeUrl: { not: null } },
    ],
  };

  const [rows, total] = await Promise.all([
    prisma.event.findMany({
      where,
      orderBy: [{ recordingPublishedAt: 'desc' }, { endsAt: 'desc' }],
      take: pageSize,
      skip: (page - 1) * pageSize,
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        startsAt: true,
        endsAt: true,
        recordingDuration: true,
        recordingPublishedAt: true,
        youtubeUrl: true,
        imageUrl: true,
      },
    }),
    prisma.event.count({ where }),
  ]);

  const q = search.toLowerCase();
  const filtered = q
    ? rows.filter((r) => {
        const t = getLocalized(r.title as LocalizedField, locale).toLowerCase();
        const d = getLocalized(r.description as LocalizedField, locale).toLowerCase();
        return t.includes(q) || d.includes(q);
      })
    : rows;

  return Response.json(
    {
      rows: filtered.map((r) => ({
        id: r.id,
        slug: r.slug,
        title: getLocalized(r.title as LocalizedField, locale),
        description: getLocalized(r.description as LocalizedField, locale),
        startsAt: r.startsAt.toISOString(),
        endsAt: r.endsAt.toISOString(),
        durationSeconds: r.recordingDuration,
        publishedAt: r.recordingPublishedAt?.toISOString() ?? null,
        imageUrl: r.imageUrl,
        hasYoutube: Boolean(r.youtubeUrl),
      })),
      page,
      pageSize,
      total,
    },
    { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' } },
  );
});
