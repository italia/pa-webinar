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
 * Tra la lettura e la cancellazione una persona puo' spuntare di nuovo: ogni voce
 * si blocca e si ricontrolla nello stato letto, e una voce cambiata resta.
 *
 * Prima di tutto la corsa completa le voci arrivate senza email
 * (`riempiEmailRubrica`).
 *
 * Protetta da CRON_API_KEY.
 */

import type { Prisma } from '@prisma/client';

import { withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { assertCronApiKey } from '@/lib/auth/cron';
import { fermaInviti, type RegolaInviti } from '@/lib/persons/inviti-fermati';
import { riempiEmailRubrica } from '@/lib/persons/riempimento-email';
import { scadenzaRubrica } from '@/lib/persons/retention';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

// A blocchi, per tenere piccole le scritture e poter interrompere il lavoro.
const BATCH_SIZE = 500;

/** I blocchi interi, con le loro cancellazioni in coda, stanno nello stesso tempo. */
const TIMEOUT_BLOCCO_MS = 30_000;

/**
 * Cancella le voci `ids` ancora nello stato letto (`stato`), dopo averne fermato
 * gli inviti (`inviti`). Il blocco sulle righe mette in fila una spunta
 * concorrente: quella arrivata prima si vede nello stato, quella dopo trova la
 * voce gia' cancellata.
 */
async function cancellaVoci(
  ids: string[],
  stato: Prisma.PersonWhereInput,
  inviti: (voci: { id: string; emailHash: string }[]) => Prisma.EventInvitationWhereInput,
  regola: RegolaInviti,
): Promise<number> {
  if (ids.length === 0) return 0;
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM persons WHERE id = ANY(${ids}::uuid[]) FOR UPDATE`;
      const voci = await tx.person.findMany({
        where: { AND: [{ id: { in: ids } }, stato] },
        select: { id: true, emailHash: true },
      });
      if (voci.length === 0) return 0;
      await fermaInviti(tx, inviti(voci), regola);
      const res = await tx.person.deleteMany({
        where: { id: { in: voci.map((v) => v.id) } },
      });
      return res.count;
    },
    { timeout: TIMEOUT_BLOCCO_MS },
  );
}

export const GET = withErrorHandling(async (request) => {
  assertCronApiKey(request);

  const now = new Date();
  const { publicRegistrationEnabled } = await getSettings();
  const regola: RegolaInviti = { adesso: now, publicRegistrationEnabled };

  const emailsFilled = await riempiEmailRubrica(prisma);

  // Chi ha ritirato il consenso esce subito: non c'e' motivo di tenere la riga.
  const statoRitirata = { optedInToAddressBook: false, optedOutAt: { not: null } };
  const optedOut = await prisma.person.findMany({
    where: statoRitirata,
    select: { id: true },
    take: BATCH_SIZE,
  });
  const totalOptedOutDeleted = await cancellaVoci(
    optedOut.map((p) => p.id),
    statoRitirata,
    (voci) => ({
      OR: [
        { personId: { in: voci.map((v) => v.id) } },
        { emailHash: { in: voci.map((v) => v.emailHash) } },
      ],
    }),
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

  const expired = candidates.filter((p) => {
    const scadenza = scadenzaRubrica(p);
    return scadenza !== null && scadenza < now;
  });
  const totalDeleted = await cancellaVoci(
    expired.map((p) => p.id),
    {
      OR: expired.map((p) => ({
        id: p.id,
        optedInToAddressBook: true,
        optedInAt: p.optedInAt,
      })),
    },
    (voci) => ({ personId: { in: voci.map((v) => v.id) } }),
    regola,
  );

  console.log(
    `[cron/rubrica-retention] deleted ${totalDeleted} expired persons, ${totalOptedOutDeleted} opted-out persons`,
  );

  return Response.json({
    ok: true,
    expiredDeleted: totalDeleted,
    optedOutDeleted: totalOptedOutDeleted,
    scanned: candidates.length,
    emailsFilled,
  });
});
