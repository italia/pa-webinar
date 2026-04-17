/**
 * Update the publication-visible fields of an event from the admin hub.
 *
 * Authenticates via the admin session cookie (not the moderator magic
 * link), so the admin managing the library doesn't need the per-event
 * moderator token for a quick list/unlist action. Scope is intentionally
 * narrow: `libraryListed`, `coverImageUrl`, `postEventPublic`,
 * `youtubeUrl`. Anything else still goes through the moderator-scoped
 * /api/events/[param] route.
 */

import { cookies } from 'next/headers';
import { z } from 'zod';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { prisma } from '@/lib/db';
import { AppError, UnauthorizedError, ValidationError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const updatePublicationSchema = z.object({
  libraryListed: z.boolean().optional(),
  postEventPublic: z.boolean().optional(),
  coverImageUrl: z.string().url().nullable().optional(),
  youtubeUrl: z
    .string()
    .url()
    .refine((u) => /(?:youtube\.com|youtu\.be)/i.test(u), {
      message: 'URL must point to youtube.com or youtu.be',
    })
    .nullable()
    .optional(),
  // Attach an already-uploaded blob to the event as its primary
  // recording. The admin reaches this after the direct-to-Azure upload
  // has completed, so the URL is guaranteed to point at an existing
  // blob in our container. Setting recordingUrl implies publishing
  // unless the caller explicitly passes recordingPublished: false.
  recordingUrl: z.string().url().nullable().optional(),
  recordingPublished: z.boolean().optional(),
  recordingFileSize: z.number().int().positive().nullable().optional(),
  recordingDuration: z.number().int().positive().nullable().optional(),
});

export const PATCH = withErrorHandling(async (request, context) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    throw new AppError('id must be a UUID', 400, 'BAD_REQUEST');
  }

  const body = await parseJsonBody(request);
  const parsed = updatePublicationSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }

  // Attaching a recording URL means we also flip the published switch
  // on by default — uploading a file from the admin panel is an
  // explicit intent to publish. The caller can still opt out by
  // passing recordingPublished: false alongside recordingUrl.
  const setsRecording = parsed.data.recordingUrl !== undefined;
  const publishWith =
    parsed.data.recordingPublished ??
    (setsRecording && parsed.data.recordingUrl !== null ? true : undefined);

  const updated = await prisma.event.update({
    where: { id },
    data: {
      ...(parsed.data.libraryListed !== undefined && {
        libraryListed: parsed.data.libraryListed,
      }),
      ...(parsed.data.postEventPublic !== undefined && {
        postEventPublic: parsed.data.postEventPublic,
      }),
      ...(parsed.data.coverImageUrl !== undefined && {
        coverImageUrl: parsed.data.coverImageUrl,
      }),
      ...(parsed.data.youtubeUrl !== undefined && {
        youtubeUrl: parsed.data.youtubeUrl,
      }),
      ...(setsRecording && {
        recordingUrl: parsed.data.recordingUrl,
        // Enable the flag even on retroactive uploads (Jibri was off
        // during the event) so the detail page surfaces the player.
        recordingEnabled: true,
        ...(parsed.data.recordingUrl === null && { recordingPublished: false }),
      }),
      ...(publishWith !== undefined && {
        recordingPublished: publishWith,
        ...(publishWith && { recordingPublishedAt: new Date() }),
      }),
      ...(parsed.data.recordingFileSize !== undefined && {
        recordingFileSize:
          parsed.data.recordingFileSize === null
            ? null
            : BigInt(parsed.data.recordingFileSize),
      }),
      ...(parsed.data.recordingDuration !== undefined && {
        recordingDuration: parsed.data.recordingDuration,
      }),
    },
  });

  return Response.json({
    id: updated.id,
    libraryListed: updated.libraryListed,
    postEventPublic: updated.postEventPublic,
    coverImageUrl: updated.coverImageUrl,
    youtubeUrl: updated.youtubeUrl,
    recordingUrl: updated.recordingUrl,
    recordingPublished: updated.recordingPublished,
  });
});
