import { prisma } from '@/lib/db';

/**
 * La rubrica ha qualcuno da proporre nel wizard: una persona che ha accettato
 * di restarci e ha ancora un'iscrizione (da cui viene l'indirizzo). Senza, il
 * selettore non si mostra: una ricerca che non trova mai niente confonde.
 */
export async function rubricaConPersone(): Promise<boolean> {
  const n = await prisma.person.count({
    where: { optedInToAddressBook: true, registrations: { some: {} } },
  });
  return n > 0;
}
