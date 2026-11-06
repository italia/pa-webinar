// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import type { OrganizationType, Prisma, PrismaClient } from '@prisma/client';

import { encryptPIIOrNull } from '@/lib/crypto/pii';

export interface PersonUpsertInput {
  emailHash: string;
  // Gia' cifrata: si copia com'e', senza una seconda cifratura.
  email: string;
  displayName?: string | null;
  organization?: string | null;
  organizationRole?: string | null;
  organizationType?: OrganizationType | null;
  // Vero solo se chi si iscrive ha spuntato la casella della rubrica
  // (art. 6.1.a GDPR).
  optedIn: boolean;
}

type Tx = Prisma.TransactionClient | PrismaClient;

/**
 * Aggiorna la voce di rubrica di chi si iscrive e ne restituisce l'id.
 *
 * - Senza spunta non si crea e non si tocca niente: un'iscrizione non rinnova
 *   il consenso, e non aggiornare i dati non equivale a un ritiro. Se la voce
 *   esiste l'iscrizione ci si collega comunque.
 * - Con la spunta si scrivono nome, email e organizzazione di questa iscrizione,
 *   `optedInAt` riparte da adesso (e con lui i mesi di conservazione, vedi
 *   `lib/persons/retention`) e il segno di un ritiro precedente si azzera.
 * - Un campo che l'iscrizione non porta (l'evento non chiede l'ente, per esempio)
 *   non cancella quello salvato. Dopo un ritiro invece il profilo vecchio non
 *   sopravvive: dopo la nuova spunta resta solo cio' che questa iscrizione porta.
 *
 * Una spunta dal modulo non annulla un ritiro: su un indirizzo con un ritiro o
 * inviti fermati il chiamante passa `optedIn` falso (`indirizzoFermato`), e la
 * spunta vale solo confermata (lib/persons/spunta-in-attesa).
 *
 * `null` se non c'e' una voce e la persona non l'ha chiesta.
 */
export async function upsertPersonOnRegistration(
  tx: Tx,
  input: PersonUpsertInput,
): Promise<string | null> {
  const existing = await tx.person.findUnique({
    where: { emailHash: input.emailHash },
    select: { id: true, optedOutAt: true },
  });

  if (!input.optedIn) return existing?.id ?? null;

  const now = new Date();
  // Prisma lascia stare un campo `undefined`; una voce nuova o ritirata riparte
  // da vuoto.
  const assente = existing && !existing.optedOutAt ? undefined : null;

  // Nome ed email sono cifrati a riposo (AES-256-GCM). Gli altri campi restano
  // in chiaro perche' l'elenco dello staff li cerca e li filtra.
  const profilo = {
    displayName: input.displayName ? encryptPIIOrNull(input.displayName) : assente,
    email: input.email,
    organization: input.organization || assente,
    organizationRole: input.organizationRole || assente,
    organizationType: input.organizationType || assente,
    optedInToAddressBook: true,
    optedInAt: now,
    lastActiveAt: now,
  };

  if (!existing) {
    const created = await tx.person.create({
      data: { emailHash: input.emailHash, ...profilo },
      select: { id: true },
    });
    return created.id;
  }

  const updated = await tx.person.update({
    where: { id: existing.id },
    data: { ...profilo, optedOutAt: null },
    select: { id: true },
  });
  return updated.id;
}
