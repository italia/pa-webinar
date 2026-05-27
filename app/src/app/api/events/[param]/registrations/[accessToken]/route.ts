import { withErrorHandling } from '@/lib/api-handler';
import { NotFoundError, RateLimitError } from '@/lib/errors';
import { prisma } from '@/lib/db';
import { tryDecryptPII } from '@/lib/crypto/pii';
import { getClientIp, rateLimit } from '@/lib/rate-limit';
import { resolveLocale, getLocalized, type LocalizedField } from '@/lib/utils/locale';

export const dynamic = 'force-dynamic';

// ── GET /api/events/[slug]/registrations/[accessToken] ───────

export const GET = withErrorHandling(async (request, context) => {
  const { param: slug, accessToken } = await context.params;
  const locale = resolveLocale(request);

  // Brute-forcing 21-char nanoid access tokens is computationally
  // infeasible, but we still want to bound the cost of someone trying
  // (and to keep this endpoint from becoming an oracle for event-slug
  // enumeration). 30 lookups per IP per minute is generous for legit
  // page reloads while making any guessing attack visibly slow.
  const ip = getClientIp(request);
  const rl = rateLimit(`reg-lookup:${ip}`, { limit: 30, windowMs: 60_000 });
  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  }

  const registration = await prisma.registration.findUnique({
    where: { accessToken },
    include: { event: { select: { slug: true, title: true, status: true } } },
  });

  if (!registration || registration.event.slug !== slug) {
    throw new NotFoundError('Registration');
  }

  return Response.json({
    id: registration.id,
    displayName: tryDecryptPII(registration.displayName) ?? registration.displayName,
    eventSlug: registration.event.slug,
    eventTitle: getLocalized(registration.event.title as LocalizedField, locale),
    eventStatus: registration.event.status,
    joinedAt: registration.joinedAt?.toISOString() ?? null,
  });
});
