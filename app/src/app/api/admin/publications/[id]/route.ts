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
    },
  });

  return Response.json({
    id: updated.id,
    libraryListed: updated.libraryListed,
    postEventPublic: updated.postEventPublic,
    coverImageUrl: updated.coverImageUrl,
    youtubeUrl: updated.youtubeUrl,
  });
});
