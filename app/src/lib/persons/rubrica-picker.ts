// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/settings';

/**
 * La rubrica ha qualcuno da proporre nel wizard: l'installazione la tiene
 * accesa e c'e' almeno una persona che ha accettato di restarci e di cui la
 * voce conserva l'indirizzo. Senza, il selettore non si mostra: una ricerca che
 * non trova mai niente confonde.
 */
export async function rubricaConPersone(): Promise<boolean> {
  if ((await getSettings()).addressBookEnabled === false) return false;
  const n = await prisma.person.count({
    where: { optedInToAddressBook: true, email: { not: null } },
  });
  return n > 0;
}
