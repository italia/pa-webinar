/**
 * La foto profilo di chi entra in sala (vedi lib/profile-photo).
 *
 *   GET    → { canUpload, needsEmailProof, photo: { url } | null }
 *   POST   → il corpo e' l'immagine (JPEG, PNG o WebP); il server la
 *            ricodifica e sostituisce quella che c'era
 *   DELETE → toglie la foto
 *
 * Chi: il token della sala come `Authorization: Bearer`, di un'iscrizione
 * aperta dal link dell'email su questo browser. La foto vale per quell'email
 * in tutti gli eventi.
 */

import { extractModeratorToken } from '@/lib/auth/moderator';
import { readOwnedEventAccess } from '@/lib/event-session';
import { readBodyBytes, withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { AppError, ForbiddenError, NotFoundError, RateLimitError } from '@/lib/errors';
import {
  MAX_PHOTO_BYTES,
  findPhotoByEmailHash,
  normalizePhoto,
  profilePhotoPath,
  resolvePhotoOwner,
} from '@/lib/profile-photo';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

async function owner(request: Request, slug: string) {
  const event = await prisma.event.findUnique({ where: { slug }, select: { id: true } });
  if (!event) throw new NotFoundError('Event');
  const token = extractModeratorToken(request) || null;
  return resolvePhotoOwner(event.id, token, await readOwnedEventAccess(event.id));
}

async function requireOwner(request: Request, slug: string): Promise<string> {
  const chi = await owner(request, slug);
  if (chi?.kind !== 'owner') {
    throw new ForbiddenError('A registration opened from its email is required');
  }
  return chi.emailHash;
}

export const GET = withErrorHandling(async (request, context) => {
  const { param: slug } = (await context.params) as { param: string };
  const chi = await owner(request, slug);
  if (chi?.kind !== 'owner') {
    return Response.json({ canUpload: false, needsEmailProof: chi?.kind === 'needsEmailProof', photo: null });
  }
  const foto = await findPhotoByEmailHash(chi.emailHash);
  return Response.json({
    canUpload: true,
    needsEmailProof: false,
    photo: foto ? { url: profilePhotoPath(foto) } : null,
  });
});

export const POST = withErrorHandling(async (request, context) => {
  const { param: slug } = (await context.params) as { param: string };
  const emailHash = await requireOwner(request, slug);

  const rl = rateLimit(`profile-photo:${emailHash}`, { limit: 10, windowMs: 60 * 60_000 });
  if (!rl.allowed) throw new RateLimitError((rl.resetAt - Date.now()) / 1000);

  let bytes: Uint8Array;
  try {
    bytes = await readBodyBytes(request, MAX_PHOTO_BYTES);
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 413) {
      throw new AppError('Photo too large', 413, 'PHOTO_TOO_LARGE');
    }
    throw err;
  }
  const jpeg = bytes.length > 0 ? await normalizePhoto(bytes) : null;
  if (!jpeg) throw new AppError('Not a readable JPEG, PNG or WebP image', 422, 'PHOTO_INVALID');

  // Una foto nuova ha un id nuovo: chi conosce l'indirizzo di quella vecchia
  // non vede la nuova, e la vecchia smette di esistere.
  const [, foto] = await prisma.$transaction([
    prisma.profilePhoto.deleteMany({ where: { emailHash } }),
    prisma.profilePhoto.create({
      data: { emailHash, contentType: 'image/jpeg', bytes: new Uint8Array(jpeg) },
      select: { id: true },
    }),
  ]);
  return Response.json({ photo: { url: profilePhotoPath(foto) } }, { status: 201 });
});

export const DELETE = withErrorHandling(async (request, context) => {
  const { param: slug } = (await context.params) as { param: string };
  const emailHash = await requireOwner(request, slug);
  await prisma.profilePhoto.deleteMany({ where: { emailHash } });
  return new Response(null, { status: 204 });
});
