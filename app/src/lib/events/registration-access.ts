/**
 * Chi può iscriversi a un evento.
 *
 * Ogni evento sceglie chi partecipa (`Event.accessMode`): `OPEN`, si iscrive
 * chiunque; `INVITATION`, solo gli invitati. Senza una scelta vale quella del
 * sito (`SiteSetting.publicRegistrationEnabled`). Quando l'iscrizione non è
 * aperta, l'elenco degli invitati dell'evento (`EventInvitation`, compilato
 * dall'area di amministrazione) diventa l'elenco di chi può iscriversi:
 * l'indirizzo con cui ci si iscrive deve esserci. Un evento senza invitati, a
 * iscrizione non aperta, non accetta iscrizioni.
 *
 * Non riguarda chi un posto ce l'ha già: il link personale di chi si è
 * iscritto, i link di moderatori e relatori e l'area di amministrazione
 * funzionano come prima. L'ingresso senza iscrizione è un'altra impostazione
 * (`guestAccessEnabled`, vedi `guest-window`), che un evento solo su invito
 * spegne.
 */

import type { EventAccessMode, Prisma } from '@prisma/client';

import { hashEmail } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { publicRegistrationFor } from '@/lib/events/access-mode';

export { publicRegistrationFor };

/** `open`: chiunque; `invitation`: solo gli indirizzi invitati; `closed`: nessuno. */
export type RegistrationAccess = 'open' | 'invitation' | 'closed';

/** Come si iscrive il pubblico a questo evento, per scegliere cosa mostrare. */
export async function registrationAccessFor(
  event: { id: string; accessMode: EventAccessMode | null },
  publicRegistrationEnabled: boolean,
): Promise<RegistrationAccess> {
  if (publicRegistrationFor(event, publicRegistrationEnabled)) return 'open';
  const invitati = await prisma.eventInvitation.count({ where: { eventId: event.id } });
  return invitati > 0 ? 'invitation' : 'closed';
}

/** Vero se l'indirizzo è fra gli invitati dell'evento. */
export async function isInvited(
  db: Pick<Prisma.TransactionClient, 'eventInvitation'>,
  eventId: string,
  email: string,
): Promise<boolean> {
  const normalizzato = email.trim().toLowerCase();
  const invito = await db.eventInvitation.findFirst({
    where: {
      eventId,
      OR: [
        { emailHash: hashEmail(normalizzato) },
        // Inviti precedenti alla cifratura dell'indirizzo: niente impronta,
        // l'indirizzo è ancora in chiaro.
        { emailHash: null, email: { equals: normalizzato, mode: 'insensitive' } },
      ],
    },
    select: { id: true },
  });
  return invito !== null;
}
