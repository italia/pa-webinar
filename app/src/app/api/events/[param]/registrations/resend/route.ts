import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { NotFoundError, RateLimitError } from '@/lib/errors';
import { prisma } from '@/lib/db';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { hashEmail } from '@/lib/crypto/pii';
import { sendConfirmationEmail } from '@/lib/email/confirmation';
import { getPublicEnv } from '@/lib/env';
import { localizedUrl } from '@/lib/utils/localized-url';

export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── POST /api/events/[slug]/registrations/resend ──────────────────
//
// Re-sends the confirmation email (with the personal join link) to a
// participant who already registered but lost the original message.
//
// Anti-oracle: this endpoint ALWAYS responds 200 with the same neutral
// body whether or not a matching registration exists, so it can never be
// used to probe which email addresses are registered. The actual email
// is only enqueued when a registration is found. Rate-limited per IP
// (the in-memory limiter is per-pod — see lib/rate-limit; defence in
// depth relies on the ingress NGINX limit in production too).

export const POST = withErrorHandling(async (request, context) => {
  const { param: slug } = await context.params;

  const ip = getClientIp(request);
  const rl = rateLimit(`resend:${ip}`, { limit: 5, windowMs: 60_000 });
  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  }

  const event = await prisma.event.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!event) throw new NotFoundError('Event');

  const body = (await parseJsonBody(request)) as { email?: unknown };
  const email = typeof body.email === 'string' ? body.email.trim() : '';

  // Neutral response shared by every path so existence isn't leaked.
  const ok = () =>
    Response.json({ ok: true }, { status: 200, headers: { 'Cache-Control': 'no-store' } });

  if (!EMAIL_RE.test(email)) {
    // Don't 422 — that would distinguish "invalid input" from "not found".
    return ok();
  }

  const emailHash = hashEmail(email);
  const registration = await prisma.registration.findUnique({
    where: { eventId_emailHash: { eventId: event.id, emailHash } },
    select: { id: true, accessToken: true },
  });

  if (registration) {
    const baseUrl = getPublicEnv('NEXT_PUBLIC_APP_URL');
    const acceptLang = request.headers.get('Accept-Language') ?? '';
    const locale: 'it' | 'en' = acceptLang.toLowerCase().startsWith('en') ? 'en' : 'it';
    const joinUrl = localizedUrl(
      baseUrl,
      `/events/${slug}/live?token=${registration.accessToken}`,
      locale,
    );
    const eventPageUrl = localizedUrl(baseUrl, `/events/${slug}`, locale);

    await sendConfirmationEmail({
      registrationId: registration.id,
      locale,
      joinUrl,
      eventPageUrl,
    });
  }

  return ok();
});
