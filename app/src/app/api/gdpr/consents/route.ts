// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * POST /api/gdpr/consents
 *
 * Il ritiro di un singolo consenso dai propri dati, prima o dopo l'evento,
 * senza cancellare l'iscrizione (art. 7.3 GDPR). Il token lo consegna la pagina
 * dei propri dati (GET /api/gdpr/export) e porta l'impronta dell'indirizzo: si
 * tocca solo un'iscrizione o una prova di quell'indirizzo.
 *
 * Il corpo porta esattamente uno tra:
 *  - `registrationId` con `consent`, l'iscrizione che esiste ancora: gli effetti
 *    sono gli stessi del ritiro dalla sala (lib/live/consent-withdrawal);
 *  - `proofId`, la prova conservata dopo la cancellazione dell'iscrizione
 *    (lib/gdpr/retained-consent-proofs), solo per registrazione e trascrizione:
 *    le comunicazioni future non hanno una prova conservata;
 *  - `registrationId` con `confirmAddressBook`, la conferma della spunta della
 *    rubrica rimasta in attesa (lib/persons/spunta-in-attesa). Il token prova la
 *    casella e il pulsante e' la scelta. Per annullarla si ritirano le
 *    comunicazioni future, come dal link delle email.
 */
import { z } from 'zod';

import { parseJsonBody, withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError, RateLimitError, ValidationError } from '@/lib/errors';
import { verifyGdprToken } from '@/lib/gdpr/request-token';
import { ritiraProvaConservata } from '@/lib/gdpr/retained-consent-proofs';
import { ritiraComunicazioni, ritiraConsensi } from '@/lib/live/consent-withdrawal';
import { applicaSpuntaInAttesa } from '@/lib/persons/spunta-in-attesa';
import { getClientIp, rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const token = z.string().min(1).max(512);
const schema = z.union([
  z
    .object({
      token,
      registrationId: z.guid(),
      consent: z.enum(['recording', 'transcription', 'futureCommunications']),
    })
    .strict(),
  z
    .object({
      token,
      proofId: z.guid(),
      consent: z.enum(['recording', 'transcription']),
    })
    .strict(),
  z
    .object({
      token,
      registrationId: z.guid(),
      confirmAddressBook: z.literal(true),
    })
    .strict(),
]);

export const POST = withErrorHandling(async (request) => {
  const rl = rateLimit(`gdpr-consents:${getClientIp(request)}`, {
    limit: 30,
    windowMs: 3_600_000,
  });
  if (!rl.allowed) throw new RateLimitError((rl.resetAt - Date.now()) / 1000);

  const parsed = schema.safeParse(await parseJsonBody(request, 2048));
  if (!parsed.success) throw new ValidationError('Invalid body');
  const corpo = parsed.data;
  const verificato = verifyGdprToken(corpo.token, 'consents');
  if (!verificato) throw new AppError('Invalid or expired token', 401, 'UNAUTHORIZED');
  const risposta = (esito: Record<string, string>) =>
    Response.json(esito, { headers: { 'Cache-Control': 'no-store' } });

  if ('proofId' in corpo) {
    const trovata = await ritiraProvaConservata(
      verificato.emailHash,
      corpo.proofId,
      corpo.consent
    );
    if (!trovata) throw new NotFoundError('Consent proof');
    return risposta({ withdrawn: corpo.consent });
  }

  const iscrizione = await prisma.registration.findFirst({
    where: { id: corpo.registrationId, emailHash: verificato.emailHash },
    select: { id: true, eventId: true },
  });
  if (!iscrizione) throw new NotFoundError('Registration');

  if ('confirmAddressBook' in corpo) {
    const confermata = await applicaSpuntaInAttesa(iscrizione.id, 'self-service');
    if (!confermata) throw new NotFoundError('Address book request');
    return risposta({ confirmed: 'addressBook' });
  }

  const { consent } = corpo;
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
  return risposta({ withdrawn: consent });
});
