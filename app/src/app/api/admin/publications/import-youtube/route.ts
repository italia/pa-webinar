/**
 * Import a legacy video from YouTube.
 *
 * Two modes:
 *   - GET ?url=<youtubeUrl>  → fetch oEmbed metadata (title, author,
 *     thumbnail) so the admin UI can pre-fill the form without asking
 *     for a YouTube API key.
 *   - POST <createLegacyEventSchema>  → persist an Event with
 *     `eventType=LEGACY`, `status=ENDED`, no Jitsi room, no
 *     registrations. If `libraryListed` is omitted we default to true
 *     because the only reason to import is usually to publish.
 *
 * Both paths require admin authentication.
 */

import { randomUUID } from 'crypto';
import { cookies } from 'next/headers';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { prisma } from '@/lib/db';
import { AppError, UnauthorizedError, ValidationError } from '@/lib/errors';
import { createLegacyEventSchema } from '@/lib/validation/schemas';
import { generateUniqueSlug } from '@/lib/utils/slug';

export const dynamic = 'force-dynamic';

interface OEmbedResponse {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
  html?: string;
}

/**
 * Extract the 11-char YouTube video id from any accepted URL shape.
 * Returns null when the URL doesn't point at a single video.
 */
function extractVideoId(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.hostname.includes('youtu.be')) {
      const id = u.pathname.replace(/^\//, '').split('/')[0];
      return id && id.length === 11 ? id : null;
    }
    if (u.hostname.includes('youtube.com')) {
      if (u.pathname.startsWith('/watch')) {
        return u.searchParams.get('v');
      }
      if (u.pathname.startsWith('/embed/')) {
        const id = u.pathname.split('/')[2];
        return id && id.length === 11 ? id : null;
      }
    }
  } catch { /* fall through */ }
  return null;
}

async function fetchOEmbed(youtubeUrl: string): Promise<OEmbedResponse | null> {
  const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(youtubeUrl)}&format=json`;
  try {
    const res = await fetch(endpoint, {
      cache: 'no-store',
      // oEmbed is a public API, no auth headers needed.
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    return (await res.json()) as OEmbedResponse;
  } catch {
    return null;
  }
}

export const GET = withErrorHandling(async (request) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const url = new URL(request.url);
  const targetUrl = url.searchParams.get('url');
  if (!targetUrl) {
    throw new AppError('Missing `url` query parameter', 400, 'BAD_REQUEST');
  }
  const videoId = extractVideoId(targetUrl);
  if (!videoId) {
    throw new AppError('URL does not point to a YouTube video', 400, 'BAD_REQUEST');
  }

  const oembed = await fetchOEmbed(targetUrl);

  // maxresdefault is not guaranteed to exist for every video; hqdefault
  // is — surface both so the UI can try the high-res first and fall
  // back. sddefault is an extra fallback for 4:3 / older uploads.
  const thumbnails = {
    maxres: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    high: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    standard: `https://i.ytimg.com/vi/${videoId}/sddefault.jpg`,
  };

  return Response.json(
    {
      videoId,
      title: oembed?.title ?? null,
      author: oembed?.author_name ?? null,
      thumbnailUrl: oembed?.thumbnail_url ?? thumbnails.high,
      thumbnails,
      canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    },
    { headers: { 'Cache-Control': 'public, max-age=3600' } },
  );
});

export const POST = withErrorHandling(async (request) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const body = await parseJsonBody(request);
  const parsed = createLegacyEventSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }
  const data = parsed.data;

  const videoId = extractVideoId(data.youtubeUrl);
  if (!videoId) {
    throw new ValidationError('Invalid YouTube URL', [
      { path: ['youtubeUrl'], message: 'URL does not reference a single video' },
    ]);
  }

  const titleIt = data.title.it ?? '';
  const slug = await generateUniqueSlug({ it: titleIt });
  const jitsiRoomName = `legacy-${randomUUID()}`;
  const moderatorToken = randomUUID();

  const event = await prisma.event.create({
    data: {
      slug,
      jitsiRoomName,
      moderatorToken,
      eventType: 'LEGACY',
      status: 'ENDED',
      title: data.title,
      description: data.description ?? { it: '' },
      startsAt: new Date(data.startsAt),
      endsAt: new Date(data.endsAt),
      timezone: 'Europe/Rome',
      maxParticipants: 0,
      qaEnabled: false,
      chatEnabled: false,
      recordingEnabled: false,
      participantsCanUnmute: false,
      participantsCanStartVideo: false,
      participantsCanShareScreen: false,
      dataRetentionDays: 3650, // 10y: legacy archives live ~indefinitely
      speakersInfo: data.speakersInfo ?? {},
      organizerName: data.organizerName ?? null,
      youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
      coverImageUrl: data.coverImageUrl ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      libraryListed: data.libraryListed ?? true,
      postEventPublic: true,
      feedbackEnabled: false,
    },
  });

  return Response.json(event, { status: 201 });
});
