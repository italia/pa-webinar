/**
 * GET /api/gdpr/export?t=<signed-token>
 *
 * GDPR Art. 15 — right of access (fulfilment step).
 *
 * The caller must present a token issued by POST /api/gdpr/export/request
 * (which is delivered out-of-band to the registered email address). The
 * token carries the emailHash so we never accept a plaintext email here
 * — that closes the unauthenticated enumeration oracle the previous
 * version of this endpoint exposed.
 */

import { withErrorHandling } from '@/lib/api-handler';
import { AppError, RateLimitError } from '@/lib/errors';
import { prisma } from '@/lib/db';
import { decryptPII, tryDecryptPII } from '@/lib/crypto/pii';
import { getClientIp, rateLimit } from '@/lib/rate-limit';
import { verifyGdprToken } from '@/lib/gdpr/request-token';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (request) => {
  const ip = getClientIp(request);
  const rl = rateLimit(`gdpr-export-get:${ip}`, {
    limit: 10,
    windowMs: 3_600_000,
  });
  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  }

  const url = new URL(request.url);
  const token = url.searchParams.get('t');
  if (!token) {
    throw new AppError('Missing token', 400, 'BAD_REQUEST');
  }

  const verified = verifyGdprToken(token, 'export');
  if (!verified) {
    throw new AppError('Invalid or expired token', 401, 'UNAUTHORIZED');
  }

  const { emailHash } = verified;

  const registrations = await prisma.registration.findMany({
    where: { emailHash },
    include: {
      event: {
        select: {
          id: true,
          slug: true,
          title: true,
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
    return Response.json({ data: [] });
  }

  // Audit one row per distinct event, recording only an emailHash prefix
  // (not the address) so the log itself cannot be reversed.
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
        displayName: tryDecryptPII(r.displayName) ?? r.displayName,
        email: decryptedEmail,
        organization: r.organization,
        organizationRole: r.organizationRole,
        organizationType: r.organizationType,
        consentGiven: r.consentGiven,
        consentTimestamp: r.consentTimestamp.toISOString(),
        consentRecording: r.consentRecording,
        consentMultitrack: r.consentMultitrack,
        consentFutureCommunications: r.consentFutureCommunications,
        registeredAt: r.createdAt.toISOString(),
        joinedAt: r.joinedAt?.toISOString() ?? null,
      },
      event: {
        title: r.event.title,
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

  return Response.json({ data: result });
});
