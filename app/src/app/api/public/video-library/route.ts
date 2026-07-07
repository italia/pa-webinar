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
    Math.max(
      1,
      Number.isFinite(pageSizeRaw) ? Math.floor(pageSizeRaw) : PAGE_SIZE_DEFAULT
    ),
    PAGE_SIZE_MAX
  );

  const now = new Date();
  const where: Prisma.EventWhereInput = {
    status: 'ENDED',
    // `libraryListed` is the explicit "show in public library" switch.
    // Separate from `postEventPublic` so an admin can keep an event's
    // detail page public for registered attendees while hiding it from
    // the library index (common for internal instant calls).
    libraryListed: true,
    // Reconcile with the post-event page visibility gate (publicEventStatusWhere
    // ENDED branch / isEventPubliclyVisible): a library card links to the detail
    // page, so an event whose page is hidden (postEventPublic=false) or past its
    // postEventPublicUntil window must NOT appear here with a link that 404s.
    // Library membership is thus a subset of page-visible — you can still have a
    // public page that isn't in the library (libraryListed=false), just not the
    // reverse. Two OR groups can't sit at one level in Prisma, so combine under AND.
    postEventPublic: true,
    AND: [
      { OR: [{ postEventPublicUntil: null }, { postEventPublicUntil: { gt: now } }] },
      {
        OR: [
          { AND: [{ recordingPublished: true }, { recordingUrl: { not: null } }] },
          { youtubeUrl: { not: null } },
        ],
      },
    ],
  };

  const librarySelect = {
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
    coverImageUrl: true,
  } as const;
  const orderBy = [
    { recordingPublishedAt: 'desc' as const },
    { endsAt: 'desc' as const },
  ];

  const q = search.toLowerCase();

  let rows: Prisma.EventGetPayload<{ select: typeof librarySelect }>[];
  let total: number;
  if (q) {
    // Title/description are per-locale JSONB, so a case-insensitive substring
    // match across locales can't be expressed in the Prisma `where` — it must
    // run in JS. Fetch the full library set (hard-capped), filter, THEN paginate
    // in JS, so both `total` and the returned page reflect the SEARCH rather
    // than the whole library (the previous code filtered only the current DB
    // page and counted the unfiltered total → wrong counts + empty pages). The
    // public library is small (tens–low-hundreds of published events).
    const all = await prisma.event.findMany({
      where,
      orderBy,
      take: 1000,
      select: librarySelect,
    });
    const matched = all.filter((r) => {
      const t = getLocalized(r.title as LocalizedField, locale).toLowerCase();
      const d = getLocalized(r.description as LocalizedField, locale).toLowerCase();
      return t.includes(q) || d.includes(q);
    });
    total = matched.length;
    rows = matched.slice((page - 1) * pageSize, page * pageSize);
  } else {
    [rows, total] = await Promise.all([
      prisma.event.findMany({
        where,
        orderBy,
        take: pageSize,
        skip: (page - 1) * pageSize,
        select: librarySelect,
      }),
      prisma.event.count({ where }),
    ]);
  }

  return Response.json(
    {
      rows: rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        title: getLocalized(r.title as LocalizedField, locale),
        description: getLocalized(r.description as LocalizedField, locale),
        startsAt: r.startsAt.toISOString(),
        endsAt: r.endsAt.toISOString(),
        durationSeconds: r.recordingDuration,
        publishedAt: r.recordingPublishedAt?.toISOString() ?? null,
        // Prefer the curated cover banner; fall back to the generic
        // imageUrl; the client handles the final fallback gradient.
        imageUrl: r.coverImageUrl ?? r.imageUrl,
        hasYoutube: Boolean(r.youtubeUrl),
      })),
      page,
      pageSize,
      total,
    },
    { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' } }
  );
});
