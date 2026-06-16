import { nanoid } from 'nanoid';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import {
  NotFoundError,
  ConflictError,
  AlreadyRegisteredError,
  RateLimitError,
  ValidationError,
} from '@/lib/errors';
import { prisma } from '@/lib/db';
import { createRegistrationSchema } from '@/lib/validation/schemas';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { encryptPII, hashEmail } from '@/lib/crypto/pii';
import { sendConfirmationEmail } from '@/lib/email/confirmation';
import { getPublicEnv } from '@/lib/env';
import { upsertPersonOnRegistration } from '@/lib/persons';
import { localizedUrl } from '@/lib/utils/localized-url';
import {
  buildEventAccessSetCookie,
  eventAccessTtlSeconds,
  signEventAccess,
} from '@/lib/event-session';

export const dynamic = 'force-dynamic';

// ── POST /api/events/[slug]/registrations ────────────────────

export const POST = withErrorHandling(async (request, context) => {
  const { param: slug } = await context.params;

  const ip = getClientIp(request);
  const rl = rateLimit(`register:${ip}`, { limit: 10, windowMs: 60_000 });
  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  }

  const event = await prisma.event.findUnique({
    where: { slug },
    include: { _count: { select: { registrations: true } } },
  });

  if (!event) throw new NotFoundError('Event');

  if (event.status !== 'PUBLISHED' && event.status !== 'LIVE') {
    throw new ConflictError('Event is not open for registration');
  }

  // maxParticipants is an expected-attendance estimate (used for
  // capacity planning), not a hard cap. Registrations beyond it are
  // accepted — the platform scales horizontally, refusing sign-ups
  // would only damage participation.

  const body = await parseJsonBody(request);
  const parsed = createRegistrationSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Validation failed', parsed.error.issues.map((i) => ({ path: i.path, message: i.message })));
  }

  const {
    displayName, email, consentGiven, organization, organizationRole, organizationType,
    consentRecording, consentMultitrack, consentFutureCommunications, consentAddressBook,
  } = parsed.data;

  // If recording is enabled, consentRecording must be true
  if (event.recordingEnabled && consentRecording !== true) {
    throw new ValidationError('Validation failed', [{ path: ['consentRecording'], message: 'registration.errors.recordingConsentRequired' }]);
  }

  // ADR-013 Fase 5 — se l'evento registra le tracce per-partecipante,
  // serve il consenso esplicito separato (PII sensibile).
  if (event.multitrackRecordingEnabled && consentMultitrack !== true) {
    throw new ValidationError('Validation failed', [{ path: ['consentMultitrack'], message: 'registration.errors.multitrackConsentRequired' }]);
  }

  const emailHash = hashEmail(email);
  const encryptedEmail = encryptPII(email);
  const accessToken = nanoid(24);

  const registration = await prisma.$transaction(async (tx) => {
    // Check for duplicates inside transaction
    const existing = await tx.registration.findUnique({
      where: { eventId_emailHash: { eventId: event.id, emailHash } },
    });
    if (existing) {
      throw new AlreadyRegisteredError();
    }

    const personId = await upsertPersonOnRegistration(tx, {
      emailHash,
      displayName,
      organization: organization || null,
      organizationRole: organizationRole || null,
      organizationType: organizationType || null,
      optedIn: consentAddressBook === true,
    });

    const reg = await tx.registration.create({
      data: {
        eventId: event.id,
        displayName: encryptPII(displayName),
        email: encryptedEmail,
        emailHash,
        organization: organization || null,
        organizationRole: organizationRole || null,
        organizationType: organizationType || null,
        consentGiven,
        consentTimestamp: new Date(),
        consentRecording: event.recordingEnabled ? (consentRecording ?? false) : null,
        consentMultitrack: event.multitrackRecordingEnabled ? (consentMultitrack ?? false) : null,
        consentFutureCommunications: consentFutureCommunications ?? false,
        accessToken,
        personId,
      },
    });

    // GDPR audit: record consent
    await tx.gdprAuditLog.create({
      data: {
        eventId: event.id,
        action: 'CONSENT_RECORDED',
        recordCount: 1,
        details: JSON.stringify({
          consentGiven: true,
          consentRecording: event.recordingEnabled ? (consentRecording ?? false) : null,
          consentMultitrack: event.multitrackRecordingEnabled ? (consentMultitrack ?? false) : null,
          consentFutureCommunications: consentFutureCommunications ?? false,
          consentAddressBook: consentAddressBook === true,
        }),
      },
    });

    return reg;
  });

  const baseUrl = getPublicEnv('NEXT_PUBLIC_APP_URL');

  const acceptLang = request.headers.get('Accept-Language') ?? '';
  const locale: 'it' | 'en' = acceptLang.toLowerCase().startsWith('en') ? 'en' : 'it';

  const joinUrl = localizedUrl(baseUrl, `/events/${slug}/live?token=${accessToken}`, locale);
  const eventPageUrl = localizedUrl(baseUrl, `/events/${slug}`, locale);

  await sendConfirmationEmail({
    registrationId: registration.id,
    locale,
    joinUrl,
    eventPageUrl,
  });

  // Per-event access cookie: lets the browser return to /live after losing
  // the `?token=` (refresh, bookmark, back via the event page) without being
  // bounced into the /registration → 409 loop.
  const ttl = eventAccessTtlSeconds(event.endsAt);
  const eventCookie = buildEventAccessSetCookie(
    event.id,
    await signEventAccess(event.id, accessToken, ttl),
    ttl,
  );

  return Response.json(
    {
      id: registration.id,
      // displayName is encrypted at rest; return the plaintext we received
      // so the caller (registration confirmation UI) sees a readable name.
      displayName,
      eventSlug: slug,
      accessToken,
      joinUrl,
    },
    { status: 201, headers: { 'Cache-Control': 'no-store', 'Set-Cookie': eventCookie } },
  );
});
