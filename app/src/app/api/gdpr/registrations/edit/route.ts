// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * POST /api/gdpr/registrations/edit
 *
 * La correzione di nome ed ente dalla pagina dei propri dati (art. 16 GDPR), per
 * un'iscrizione (`scope: registration`) o per tutte quelle dell'indirizzo con la
 * sua voce di rubrica (`scope: address`). I valori seguono le regole del modulo
 * d'iscrizione, compreso l'ente dove un evento lo chiede.
 *
 * In due tempi (lib/gdpr/confirmation-flow): senza `code` controlla i valori e
 * manda il codice all'indirizzo (202); con `code` e `issuedAt` corregge, se il
 * codice e' quello dato per questi stessi valori (200). Il token e' quello che la
 * pagina riceve con i dati, mai il link dell'email. Cosa cambia e cosa no lo dice
 * lib/gdpr/registration-self-service.
 */
import { z } from 'zod';

import { parseJsonBody, withErrorHandling } from '@/lib/api-handler';
import { ValidationError } from '@/lib/errors';
import { improntaValori } from '@/lib/gdpr/confirmation-code';
import {
  conCodice,
  iscrizioneDelToken,
  limitePerIp,
  mandaCodice,
} from '@/lib/gdpr/confirmation-flow';
import {
  correggiIscrizioni,
  enteMancante,
  iscrizioniDaCorreggere,
  normalizzaValori,
} from '@/lib/gdpr/registration-self-service';

export const dynamic = 'force-dynamic';

const schema = z
  .object({
    token: z.string().min(1).max(512),
    registrationId: z.guid(),
    scope: z.enum(['registration', 'address']),
    displayName: z.string().max(400),
    organization: z.string().max(800).nullable(),
    locale: z.string().max(10).optional(),
    code: z.string().max(12).optional(),
    issuedAt: z.number().int().positive().optional(),
  })
  .strict()
  .refine((b) => (b.code === undefined) === (b.issuedAt === undefined));

/** Gli errori dei valori, con le chiavi dei testi della pagina dei propri dati. */
const ERRORI = {
  nameInvalid: { path: ['displayName'], message: 'gdpr.export.editNameInvalid' },
  organizationTooLong: {
    path: ['organization'],
    message: 'gdpr.export.editOrganizationTooLong',
  },
  organizationRequired: {
    path: ['organization'],
    message: 'gdpr.export.editOrganizationRequired',
  },
} as const;

export const POST = withErrorHandling(async (request) => {
  limitePerIp(request);
  const parsed = schema.safeParse(await parseJsonBody(request, 4096));
  if (!parsed.success) throw new ValidationError('Invalid body');
  const corpo = parsed.data;
  const { emailHash, iscrizione } = await iscrizioneDelToken(
    corpo.token,
    corpo.registrationId
  );

  const valori = normalizzaValori(corpo);
  if (typeof valori === 'string')
    throw new ValidationError('Validation failed', [ERRORI[valori]]);
  const toccate = await iscrizioniDaCorreggere(emailHash, iscrizione.id, corpo.scope);
  if (enteMancante(toccate, valori)) {
    throw new ValidationError('Validation failed', [ERRORI.organizationRequired]);
  }

  const richiesta = {
    azione: 'edit' as const,
    emailHash,
    oggetto: corpo.scope === 'address' ? 'address:' : iscrizione.id,
    impronta: improntaValori({ ...valori, scope: corpo.scope }),
  };
  if (corpo.code === undefined || corpo.issuedAt === undefined) {
    return mandaCodice(richiesta, iscrizione, {
      locale: corpo.locale,
      tutte: corpo.scope === 'address',
    });
  }
  const esito = await conCodice(richiesta, corpo.issuedAt, corpo.code, () =>
    correggiIscrizioni(emailHash, iscrizione.id, corpo.scope, valori)
  );
  return Response.json(
    {
      updated: esito.iscrizioni,
      addressBookUpdated: esito.voceDiRubrica,
      displayName: valori.displayName,
      organization: valori.organization,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
});
