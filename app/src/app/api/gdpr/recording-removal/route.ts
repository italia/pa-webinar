// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * POST /api/gdpr/recording-removal
 *
 * «Non voglio comparire in questa registrazione», dalla pagina dei propri dati:
 * la richiesta di essere tolti dalle registrazioni di un evento a cui ci si e'
 * iscritti (diritto alla cancellazione, o semplice ripensamento). Non cancella
 * niente subito: la richiesta va al titolare, che la evade dall'editor di
 * rimozione (lib/recording/redaction). Il token lo consegna la pagina dei
 * propri dati (GET /api/gdpr/export), come per il ritiro dei consensi, e porta
 * l'impronta dell'indirizzo: si chiede solo per un'iscrizione di quell'indirizzo.
 *
 * Una richiesta per ogni registrazione con un media dell'evento; una seconda
 * richiesta mentre la prima e' aperta non ne crea un'altra.
 */
import { z } from 'zod';

import { parseJsonBody, withErrorHandling } from '@/lib/api-handler';
import { AppError, RateLimitError, ValidationError } from '@/lib/errors';
import { verifyGdprToken } from '@/lib/gdpr/request-token';
import { getClientIp, rateLimit } from '@/lib/rate-limit';
import { chiediDaIMieiDati } from '@/lib/recording/redaction/requests';

export const dynamic = 'force-dynamic';

const schema = z
  .object({
    token: z.string().min(1).max(512),
    registrationId: z.guid(),
  })
  .strict();

export const POST = withErrorHandling(async (request) => {
  const rl = rateLimit(`gdpr-recording-removal:${getClientIp(request)}`, {
    limit: 10,
    windowMs: 3_600_000,
  });
  if (!rl.allowed) throw new RateLimitError((rl.resetAt - Date.now()) / 1000);

  const parsed = schema.safeParse(await parseJsonBody(request, 2048));
  if (!parsed.success) throw new ValidationError('Invalid body');
  const verificato = verifyGdprToken(parsed.data.token, 'consents');
  if (!verificato) throw new AppError('Invalid or expired token', 401, 'UNAUTHORIZED');

  const create = await chiediDaIMieiDati(
    verificato.emailHash,
    parsed.data.registrationId
  );
  return Response.json(
    { requested: create },
    { headers: { 'Cache-Control': 'no-store' } }
  );
});
