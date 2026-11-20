// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import type { PrismaClient } from '@prisma/client';

/**
 * Le voci in rubrica senza email la prendono dall'iscrizione piu' recente con la
 * stessa impronta: lo stesso riempimento della migrazione
 * 20261105210000_rubrica_con_email, per le voci che arrivano dopo.
 *
 * Durante un aggiornamento, o dopo un ritorno alla versione precedente, un pod
 * vecchio scrive voci senza email, e la migrazione non rigira. Senza email la
 * voce resta valida ma non compare nel selettore. Si copia il cifrato cosi'
 * com'e', e chi ha ritirato il consenso non si riempie.
 */
export async function riempiEmailRubrica(
  db: Pick<PrismaClient, '$executeRaw'>
): Promise<number> {
  return db.$executeRaw`
    UPDATE "persons" AS p
    SET "email" = ultima."email"
    FROM (
      SELECT DISTINCT ON ("email_hash") "email_hash", "email"
      FROM "registrations"
      WHERE "email_hash" IN (
        SELECT "email_hash" FROM "persons"
        WHERE "opted_in_to_address_book" = true AND "email" IS NULL
      )
      ORDER BY "email_hash", "created_at" DESC
    ) AS ultima
    WHERE p."email_hash" = ultima."email_hash"
      AND p."opted_in_to_address_book" = true
      AND p."email" IS NULL
  `;
}
