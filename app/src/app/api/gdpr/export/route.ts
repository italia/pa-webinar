import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import { hashEmail, decryptPII } from '@/lib/crypto/pii';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * GET /api/gdpr/export?email=xxx
 *
 * GDPR Art. 15 — right of access.
 * Returns all data associated with an email address.
 * Rate limited: 3 requests per hour per IP.
 */
export async function GET(request: Request) {
  const ip = getClientIp(request);
  const rl = rateLimit(`gdpr-export:${ip}`, { limit: 3, windowMs: 3_600_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Try again in one hour.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    );
  }

  const url = new URL(request.url);
  const email = url.searchParams.get('email')?.trim();

  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
  }

  const emailHash = hashEmail(email);

  const registrations = await prisma.registration.findMany({
    where: { emailHash },
    include: {
      event: {
        select: {
          id: true,
          slug: true,
          titleIt: true,
          titleEn: true,
          startsAt: true,
          endsAt: true,
          status: true,
        },
      },
      questions: {
        select: {
          id: true,
          text: true,
          status: true,
          createdAt: true,
        },
      },
      pollVotes: {
        select: {
          id: true,
          optionIndex: true,
          createdAt: true,
          poll: {
            select: {
              question: true,
              options: true,
            },
          },
        },
      },
    },
  });

  if (registrations.length === 0) {
    return NextResponse.json({ data: [] }, { status: 200 });
  }

  // Write audit log for each event
  const eventIds = [...new Set(registrations.map((r) => r.eventId))];
  for (const eventId of eventIds) {
    await prisma.gdprAuditLog.create({
      data: {
        eventId,
        action: 'DATA_EXPORTED',
        recordCount: 1,
        details: JSON.stringify({ emailHashPrefix: emailHash.substring(0, 8) }),
      },
    });
  }

  const result = registrations.map((r) => {
    let decryptedEmail: string | null = null;
    try {
      decryptedEmail = decryptPII(r.email);
    } catch {
      decryptedEmail = null;
    }

    return {
      registration: {
        displayName: r.displayName,
        email: decryptedEmail,
        organization: r.organization,
        organizationRole: r.organizationRole,
        organizationType: r.organizationType,
        consentGiven: r.consentGiven,
        consentTimestamp: r.consentTimestamp.toISOString(),
        consentRecording: r.consentRecording,
        consentFutureCommunications: r.consentFutureCommunications,
        registeredAt: r.createdAt.toISOString(),
        joinedAt: r.joinedAt?.toISOString() ?? null,
      },
      event: {
        titleIt: r.event.titleIt,
        titleEn: r.event.titleEn,
        startsAt: r.event.startsAt.toISOString(),
        endsAt: r.event.endsAt.toISOString(),
        status: r.event.status,
      },
      questions: r.questions.map((q) => ({
        text: q.text,
        status: q.status,
        createdAt: q.createdAt.toISOString(),
      })),
      pollVotes: r.pollVotes.map((v) => ({
        question: v.poll.question,
        optionIndex: v.optionIndex,
        createdAt: v.createdAt.toISOString(),
      })),
    };
  });

  return NextResponse.json({ data: result }, { status: 200 });
}
