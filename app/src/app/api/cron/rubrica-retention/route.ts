// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * GET /api/cron/rubrica-retention
 *
 * La conservazione delle voci di rubrica (art. 5.1.e GDPR), una volta al giorno.
 * Cancella chi ha ritirato il consenso e chi ha superato `retentionMonths` dal
 * consenso (`optedInAt`, vedi `lib/persons/retention`): solo una nuova spunta
 * sposta quella data, un'iscrizione senza spunta no. Le iscrizioni collegate
 * restano, con `personId` azzerato da `onDelete: SetNull`.
 *
 * Prima della voce si fermano i suoi inviti (`fermaInviti`): senza `personId`
 * sembrerebbero scritti a mano, e partirebbero lo stesso. Chi ha ritirato si
 * cerca anche per impronta, perche' il ritiro vale anche per gli inviti scritti a
 * mano; una voce scaduta ferma solo gli inviti nati dalla rubrica.
 *
 * Protetta da CRON_API_KEY.
 */

import type { Prisma } from '@prisma/client';

import { withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { assertCronApiKey } from '@/lib/auth/cron';
import { fermaInviti, type RegolaInviti } from '@/lib/persons/inviti-fermati';
import { scadenzaRubrica } from '@/lib/persons/retention';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

// A blocchi, per tenere piccole le scritture e poter interrompere il lavoro.
const BATCH_SIZE = 500;

async function cancellaVoci(
  ids: string[],
  inviti: Prisma.EventInvitationWhereInput,
  regola: RegolaInviti,
): Promise<number> {
  if (ids.length === 0) return 0;
  await fermaInviti(prisma, inviti, regola);
  const res = await prisma.person.deleteMany({ where: { id: { in: ids } } });
  return res.count;
}

export const GET = withErrorHandling(async (request) => {
  assertCronApiKey(request);

  const now = new Date();
  const { publicRegistrationEnabled } = await getSettings();
  const regola: RegolaInviti = { adesso: now, publicRegistrationEnabled };

  // Chi ha ritirato il consenso esce subito: non c'e' motivo di tenere la riga.
  const optedOut = await prisma.person.findMany({
    where: { optedInToAddressBook: false, optedOutAt: { not: null } },
    select: { id: true, emailHash: true },
    take: BATCH_SIZE,
  });
  const ritirate = optedOut.map((p) => p.id);
  const totalOptedOutDeleted = await cancellaVoci(
    ritirate,
    {
      OR: [
        { personId: { in: ritirate } },
        { emailHash: { in: optedOut.map((p) => p.emailHash) } },
      ],
    },
    regola,
  );

  // Le voci piu' vecchie per prime, riga per riga perche' `retentionMonths` e'
  // della singola voce. Senza data di consenso non c'e' niente da cui contare:
  // la voce non scade, e resta fuori dal blocco per non occuparne i posti.
  const candidates = await prisma.person.findMany({
    where: { optedInToAddressBook: true, optedInAt: { not: null } },
    select: { id: true, optedInAt: true, retentionMonths: true },
    take: BATCH_SIZE,
    orderBy: { optedInAt: 'asc' },
  });

  const expired: string[] = [];
  for (const p of candidates) {
    const scadenza = scadenzaRubrica(p);
    if (scadenza && scadenza < now) expired.push(p.id);
  }
  const totalDeleted = await cancellaVoci(expired, { personId: { in: expired } }, regola);

  console.log(
    `[cron/rubrica-retention] deleted ${totalDeleted} expired persons, ${totalOptedOutDeleted} opted-out persons`,
  );

  return Response.json({
    ok: true,
    expiredDeleted: totalDeleted,
    optedOutDeleted: totalOptedOutDeleted,
    scanned: candidates.length,
  });
});
