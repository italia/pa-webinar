// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * POST /api/gdpr/registrations/nickname
 *
 * Il nickname di un'iscrizione dalla pagina dei propri dati: sceglierlo,
 * cambiarlo o toglierlo (`nickname: null`). Le regole sono quelle della sala
 * (lib/live/nickname): un nickname nuovo solo dove l'evento li consente e la
 * sala non e' finita, mai simile ai nomi di chi conduce, unico nell'evento.
 * Toglierlo resta possibile sempre, come dalla sala.
 *
 * In due tempi come la correzione di nome ed ente (lib/gdpr/confirmation-flow):
 * senza `code` controlla il nickname e manda il codice all'indirizzo (202); con
 * `code` e `issuedAt` lo salva, se il codice e' quello dato per questo stesso
 * nickname (200). Il controllo si ripete al salvataggio: nel frattempo un altro
 * puo' averlo preso, e allora il codice torna valido.
 *
 * Risposte di rifiuto, come la rotta del nickname della sala: 422
 * `NICKNAME_INVALID` con il motivo, 409 `NICKNAME_TAKEN` con un'alternativa
 * libera, 409 `NICKNAMES_DISABLED` se l'evento non accetta nickname nuovi o la
 * sala e' finita. Vale in chat e nelle domande da subito, in video dal prossimo
 * ingresso. Nel registro GDPR dell'evento resta `DATA_RECTIFIED` con il nome del
 * campo, mai il valore.
 */
import { z } from 'zod';

import { parseJsonBody, withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { AppError, ValidationError } from '@/lib/errors';
import { isFinishedEventStatus } from '@/lib/gdpr/cleanup-selection';
import { improntaValori } from '@/lib/gdpr/confirmation-code';
import {
  conCodice,
  iscrizioneDelToken,
  limitePerIp,
  mandaCodice,
} from '@/lib/gdpr/confirmation-flow';
import {
  nicknameDellIscrizione,
  rispostaNicknameRifiutato,
  salvaNicknameIscrizione,
  verificaNickname,
  type EsitoNickname,
} from '@/lib/live/nickname';
import { normalizzaNickname } from '@/lib/live/nickname-rule';

export const dynamic = 'force-dynamic';

const schema = z
  .object({
    token: z.string().min(1).max(512),
    registrationId: z.guid(),
    nickname: z.string().max(100).nullable(),
    locale: z.string().max(10).optional(),
    code: z.string().max(12).optional(),
    issuedAt: z.number().int().positive().optional(),
  })
  .strict()
  .refine((b) => (b.code === undefined) === (b.issuedAt === undefined));

/** Un rifiuto al salvataggio: il codice torna valido (`conCodice`). */
class NicknameRifiutato extends Error {
  constructor(readonly esito: Extract<EsitoNickname, { ok: false }>) {
    super('Nickname refused');
  }
}

const risposta = (corpo: Record<string, unknown>) =>
  Response.json(corpo, { headers: { 'Cache-Control': 'no-store' } });

export const POST = withErrorHandling(async (request) => {
  limitePerIp(request);
  const parsed = schema.safeParse(await parseJsonBody(request, 2048));
  if (!parsed.success) throw new ValidationError('Invalid body');
  const corpo = parsed.data;
  const { emailHash, iscrizione } = await iscrizioneDelToken(
    corpo.token,
    corpo.registrationId
  );
  const stato = await prisma.registration.findUniqueOrThrow({
    where: { id: iscrizione.id },
    select: {
      nickname: true,
      event: { select: { status: true, nicknamesEnabled: true } },
    },
  });
  const attuale = nicknameDellIscrizione(stato);
  const richiesto = corpo.nickname === null ? null : normalizzaNickname(corpo.nickname);
  // Niente da cambiare: nessun codice, nessuna email.
  if (richiesto === attuale) return risposta({ nickname: attuale, updated: false });

  if (richiesto !== null) {
    // A sala finita un nickname nuovo non serve piu'.
    if (!stato.event.nicknamesEnabled || isFinishedEventStatus(stato.event.status)) {
      throw new AppError(
        'This event does not accept new nicknames',
        409,
        'NICKNAMES_DISABLED'
      );
    }
    // Prima del codice: la persona non riceve un'email per un nickname che non
    // passerebbe.
    if (corpo.code === undefined) {
      const esito = await verificaNickname(iscrizione.eventId, richiesto, {
        iscrizione: iscrizione.id,
      });
      if (!esito.ok) return rispostaNicknameRifiutato(esito);
    }
  }

  const richiesta = {
    azione: 'nickname' as const,
    emailHash,
    oggetto: iscrizione.id,
    impronta: improntaValori({ nickname: richiesto }),
  };
  if (corpo.code === undefined || corpo.issuedAt === undefined) {
    return mandaCodice(richiesta, iscrizione, {
      locale: corpo.locale,
      togli: richiesto === null,
    });
  }
  try {
    const salvato = await conCodice(richiesta, corpo.issuedAt, corpo.code, async () => {
      const esito = await salvaNicknameIscrizione(
        iscrizione.eventId,
        iscrizione.id,
        richiesto
      );
      if (!esito.ok) throw new NicknameRifiutato(esito);
      await prisma.gdprAuditLog.create({
        data: {
          eventId: iscrizione.eventId,
          action: 'DATA_RECTIFIED',
          recordCount: 1,
          details: JSON.stringify({
            source: 'self-service',
            scope: 'registration',
            fields: ['nickname'],
            emailHashPrefix: emailHash.substring(0, 8),
          }),
        },
      });
      return esito.nickname;
    });
    return risposta({ nickname: salvato, updated: true });
  } catch (err) {
    if (err instanceof NicknameRifiutato) return rispostaNicknameRifiutato(err.esito);
    throw err;
  }
});
