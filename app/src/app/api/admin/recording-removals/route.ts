// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * GET  /api/admin/recording-removals?status=open|all
 * POST /api/admin/recording-removals
 *
 * Le richieste di rimozione da una registrazione (lib/recording/redaction):
 * l'elenco per l'amministrazione, e la registrazione di una richiesta arrivata
 * al titolare per altre vie (email, protocollo, sportello). La persona si
 * riconosce dai posti della conferenza scelti fra chi era in sala (GET
 * people), oppure solo dal nome, e allora gli intervalli si segnano a mano.
 * Solo l'amministrazione: la richiesta e' rivolta al titolare.
 */
import { cookies } from 'next/headers';
import { z } from 'zod';

import { parseJsonBody, withErrorHandling } from '@/lib/api-handler';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { requireAdmin } from '@/lib/auth/staff-session';
import { iscrizioneDelPosto } from '@/lib/captions/room';
import { encryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { TIMEOUT_DOPO_PULIZIA_MS } from '@/lib/gdpr/cleanup-selection';
import { endpointDeiPosti } from '@/lib/recording/redaction/people';
import { creaRichiesta, elencoRichieste } from '@/lib/recording/redaction/requests';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (request) => {
  await requireAdmin(await cookies());
  const filtro =
    new URL(request.url).searchParams.get('status') === 'all' ? 'all' : 'open';
  return Response.json({ requests: await elencoRichieste(filtro) });
});

const corpoSchema = z
  .object({
    recordingId: z.guid(),
    /** I posti della conferenza della persona, scelti fra chi era in sala. */
    seatIds: z.array(z.string().min(1).max(80)).max(200).default([]),
    name: z.string().trim().min(1).max(200),
    /** Come e' arrivata la richiesta: resta cifrata con la richiesta. */
    note: z.string().trim().max(2000).optional(),
  })
  .strict();

export const POST = withErrorHandling(async (request) => {
  await requireAdmin(await cookies());
  const parsed = corpoSchema.safeParse(await parseJsonBody(request, 64 * 1024));
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message }))
    );
  }
  const { recordingId, seatIds, name, note } = parsed.data;
  const registrazione = await prisma.recording.findUnique({
    where: { id: recordingId },
    select: { eventId: true },
  });
  if (!registrazione) throw new NotFoundError('Recording');

  const creata = await prisma.$transaction(
    async (tx) => {
      // Solo i posti che la sala ha visto in questo evento: un posto inventato
      // non deve legare la richiesta a qualcun altro.
      const conosciuti = await tx.roomOccupant.findMany({
        where: { eventId: registrazione.eventId, seatId: { in: [...new Set(seatIds)] } },
        select: { seatId: true },
      });
      const posti = [...new Set(conosciuti.map((o) => o.seatId))];
      const iscrizioni = [
        ...new Set(posti.map(iscrizioneDelPosto).filter((r): r is string => !!r)),
      ];
      return creaRichiesta(tx, {
        recordingId,
        source: 'admin',
        displayNameCifrato: encryptPII(name),
        // Un'iscrizione sola: la persona e' quella. Con piu' iscrizioni le frasi
        // si tolgono comunque per posto.
        registrationId: iscrizioni.length === 1 ? iscrizioni[0] : null,
        identita: {
          seatIds: posti,
          endpointIds: await endpointDeiPosti(tx, registrazione.eventId, posti),
        },
        note: note || null,
      });
    },
    { timeout: TIMEOUT_DOPO_PULIZIA_MS }
  );
  await logAdminAction({
    request,
    action: 'RECORDING_REDACTION_REQUEST_CREATE',
    target: recordingId,
    details: { requestId: creata.id, seats: seatIds.length },
  });
  return Response.json({ id: creata.id }, { status: 201 });
});
