// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * POST /api/gdpr/consents
 *
 * Il ritiro di un singolo consenso dai propri dati, prima o dopo l'evento,
 * senza cancellare l'iscrizione (art. 7.3 GDPR). Il token lo consegna la pagina
 * dei propri dati (GET /api/gdpr/export) e porta l'impronta dell'indirizzo: si
 * tocca solo un'iscrizione di quell'indirizzo. Gli effetti sono gli stessi del
 * ritiro dalla sala (lib/live/consent-withdrawal).
 */
import { z } from 'zod';

import { parseJsonBody, withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError, RateLimitError, ValidationError } from '@/lib/errors';
import { verifyGdprToken } from '@/lib/gdpr/request-token';
import { ritiraComunicazioni, ritiraConsensi } from '@/lib/live/consent-withdrawal';
import { getClientIp, rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const schema = z
  .object({
    token: z.string().min(1).max(512),
    registrationId: z.guid(),
    consent: z.enum(['recording', 'transcription', 'futureCommunications']),
  })
  .strict();

export const POST = withErrorHandling(async (request) => {
  const rl = rateLimit(`gdpr-consents:${getClientIp(request)}`, {
    limit: 30,
    windowMs: 3_600_000,
  });
  if (!rl.allowed) throw new RateLimitError((rl.resetAt - Date.now()) / 1000);

  const parsed = schema.safeParse(await parseJsonBody(request, 2048));
  if (!parsed.success) throw new ValidationError('Invalid body');
  const { token, registrationId, consent } = parsed.data;
  const verificato = verifyGdprToken(token, 'consents');
  if (!verificato) throw new AppError('Invalid or expired token', 401, 'UNAUTHORIZED');

  const iscrizione = await prisma.registration.findFirst({
    where: { id: registrationId, emailHash: verificato.emailHash },
    select: { id: true, eventId: true },
  });
  if (!iscrizione) throw new NotFoundError('Registration');

  if (consent === 'futureCommunications') {
    await ritiraComunicazioni(verificato.emailHash);
  } else {
    await ritiraConsensi(
      iscrizione.eventId,
      [],
      { registrazione: consent === 'recording' },
      new Date(),
      {
        iscrizioni: [iscrizione.id],
        origine: 'self-service',
      }
    );
  }
  return Response.json(
    { withdrawn: consent },
    { headers: { 'Cache-Control': 'no-store' } }
  );
});
