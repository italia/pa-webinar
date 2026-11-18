// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * POST /api/gdpr/registrations/cancel
 *
 * La cancellazione di una sola iscrizione dalla pagina dei propri dati (art. 17
 * GDPR), senza toccare le altre iscrizioni, la rubrica e il resto dell'indirizzo:
 * per cancellare tutto resta /api/gdpr/erasure.
 *
 * In due tempi (lib/gdpr/confirmation-flow): senza `code` manda il codice
 * all'indirizzo dell'iscrizione (202); con `code` e `issuedAt` cancella, se il
 * codice e' quello dato per questa iscrizione (200). Il token e' quello che la
 * pagina riceve con i dati, mai il link dell'email. Cosa se ne va e cosa resta lo
 * dice lib/gdpr/registration-self-service.
 */
import { z } from 'zod';

import { parseJsonBody, withErrorHandling } from '@/lib/api-handler';
import { NotFoundError, ValidationError } from '@/lib/errors';
import {
  controllaCodice,
  iscrizioneDelToken,
  limitePerIp,
  mandaCodice,
} from '@/lib/gdpr/confirmation-flow';
import { cancellaIscrizione } from '@/lib/gdpr/registration-self-service';

export const dynamic = 'force-dynamic';

const schema = z
  .object({
    token: z.string().min(1).max(512),
    registrationId: z.guid(),
    locale: z.string().max(10).optional(),
    code: z.string().max(12).optional(),
    issuedAt: z.number().int().positive().optional(),
  })
  .strict()
  .refine((b) => (b.code === undefined) === (b.issuedAt === undefined));

export const POST = withErrorHandling(async (request) => {
  limitePerIp(request);
  const parsed = schema.safeParse(await parseJsonBody(request, 2048));
  if (!parsed.success) throw new ValidationError('Invalid body');
  const corpo = parsed.data;
  const { emailHash, iscrizione } = await iscrizioneDelToken(
    corpo.token,
    corpo.registrationId
  );

  const richiesta = {
    azione: 'cancel' as const,
    emailHash,
    oggetto: iscrizione.id,
    impronta: '',
  };
  if (corpo.code === undefined || corpo.issuedAt === undefined) {
    return mandaCodice(richiesta, iscrizione, { locale: corpo.locale });
  }
  await controllaCodice(richiesta, corpo.issuedAt, corpo.code);
  const counts = await cancellaIscrizione(emailHash, iscrizione.id);
  if (!counts) throw new NotFoundError('Registration');
  return Response.json(
    { deleted: counts.registrations, consentProofsKept: counts.consentProofsKept },
    { headers: { 'Cache-Control': 'no-store' } }
  );
});
