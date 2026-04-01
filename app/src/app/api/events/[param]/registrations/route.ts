import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';

import { prisma } from '@/lib/db';
import { createRegistrationSchema } from '@/lib/validation/schemas';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { encryptPII, hashEmail } from '@/lib/crypto/pii';
import { sendConfirmationEmail } from '@/lib/email/confirmation';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ param: string }>;
}

// ── POST /api/events/[slug]/registrations ────────────────────

export async function POST(request: Request, context: RouteContext) {
  const { param: slug } = await context.params;

  const ip = getClientIp(request);
  const rl = rateLimit(`register:${ip}`, { limit: 10, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    );
  }

  const event = await prisma.event.findUnique({
    where: { slug },
    include: { _count: { select: { registrations: true } } },
  });

  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  if (event.status !== 'PUBLISHED' && event.status !== 'LIVE') {
    return NextResponse.json(
      { error: 'Event is not open for registration' },
      { status: 409 },
    );
  }

  if (event._count.registrations >= event.maxParticipants) {
    return NextResponse.json(
      { error: 'event_full', message: 'Event is fully booked' },
      { status: 409 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = createRegistrationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) },
      { status: 422 },
    );
  }

  const { displayName, email, consentGiven } = parsed.data;

  const emailHash = hashEmail(email);
  const encryptedEmail = encryptPII(email);
  const accessToken = nanoid(24);

  let registration;
  try {
    registration = await prisma.$transaction(async (tx) => {
      // Re-check capacity inside transaction to prevent overbooking
      const currentCount = await tx.registration.count({
        where: { eventId: event.id },
      });
      if (currentCount >= event.maxParticipants) {
        throw new Error('EVENT_FULL');
      }

      // Check for duplicates inside transaction
      const existing = await tx.registration.findUnique({
        where: { eventId_emailHash: { eventId: event.id, emailHash } },
      });
      if (existing) {
        throw new Error('ALREADY_REGISTERED');
      }

      return tx.registration.create({
        data: {
          eventId: event.id,
          displayName,
          email: encryptedEmail,
          emailHash,
          consentGiven,
          consentTimestamp: new Date(),
          accessToken,
        },
      });
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (message === 'EVENT_FULL') {
      return NextResponse.json(
        { error: 'event_full', message: 'Event is fully booked' },
        { status: 409 },
      );
    }
    if (message === 'ALREADY_REGISTERED') {
      return NextResponse.json(
        { error: 'already_registered', message: 'Already registered for this event' },
        { status: 409 },
      );
    }
    throw err;
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  const acceptLang = request.headers.get('Accept-Language') ?? '';
  const locale: 'it' | 'en' = acceptLang.toLowerCase().startsWith('en') ? 'en' : 'it';

  const joinUrl = `${baseUrl}/${locale}/eventi/${slug}/live?token=${accessToken}`;
  const eventPageUrl = `${baseUrl}/${locale}/eventi/${slug}`;

  sendConfirmationEmail({
    registrationId: registration.id,
    locale,
    joinUrl,
    eventPageUrl,
  });

  return NextResponse.json(
    {
      id: registration.id,
      displayName: registration.displayName,
      eventSlug: slug,
      accessToken,
      joinUrl,
    },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  );
}
