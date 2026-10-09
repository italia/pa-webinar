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
      // Le prove del consenso alla registrazione per partecipante date in sala
      // d'attesa: quando e in quale lingua (il nome e' quello dell'iscrizione).
      multitrackConsents: {
        select: { consentedAt: true, locale: true },
        orderBy: { consentedAt: 'asc' },
      },
      // Lo stesso per il consenso alla registrazione dell'evento dato in sala
      // d'attesa da chi non l'aveva dato all'iscrizione.
      recordingConsents: {
        select: { consentedAt: true, locale: true },
        orderBy: { consentedAt: 'asc' },
      },
    },
  });

  // La foto profilo e' legata all'indirizzo, non a un'iscrizione: c'e' anche
  // quando le iscrizioni sono gia' state cancellate (la pulizia la tiene un
  // po' di piu'), e per chi ha solo una concessione nominale.
  const foto = await prisma.profilePhoto.findUnique({
    where: { emailHash },
    select: { contentType: true, bytes: true, createdAt: true },
  });
  const profilePhoto = foto
    ? {
        uploadedAt: foto.createdAt.toISOString(),
        dataUrl: `data:${foto.contentType};base64,${Buffer.from(foto.bytes).toString('base64')}`,
      }
    : null;

  // Le concessioni nominali (organizzatore, moderatore, relatore) con lo
  // stesso indirizzo. A quelle nate prima dell'impronta la pulizia
  // giornaliera la aggiunge (lib/events/grant-email-hash).
  const concessioni = await prisma.eventModerator.findMany({
    where: { emailHash },
    select: {
      name: true,
      role: true,
      organizer: true,
      organization: true,
      publicListed: true,
      createdAt: true,
      revokedAt: true,
      event: { select: { title: true, startsAt: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  const grants = concessioni.map((g) => ({
    name: tryDecryptPII(g.name) ?? g.name,
    role: g.role === 'SPEAKER' ? 'speaker' : g.organizer ? 'organizer' : 'moderator',
    organization: g.organization,
    shownOnPublicPage: g.publicListed,
    createdAt: g.createdAt.toISOString(),
    revokedAt: g.revokedAt?.toISOString() ?? null,
    event: { title: g.event.title, startsAt: g.event.startsAt.toISOString() },
  }));

  if (registrations.length === 0) {
    return Response.json({ data: [], profilePhoto, grants });
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
        // La lingua delle email, che la piattaforma conserva e usa.
        locale: r.locale,
        registeredAt: r.createdAt.toISOString(),
        joinedAt: r.joinedAt?.toISOString() ?? null,
        multitrackConsentsInRoom: (r.multitrackConsents ?? []).map((c) => ({
          consentedAt: c.consentedAt.toISOString(),
          locale: c.locale,
        })),
        recordingConsentsInRoom: (r.recordingConsents ?? []).map((c) => ({
          consentedAt: c.consentedAt.toISOString(),
          locale: c.locale,
        })),
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

  return Response.json({ data: result, profilePhoto, grants });
});
