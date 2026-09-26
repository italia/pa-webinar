/**
 * Chi può iscriversi a un evento.
 *
 * L'amministrazione decide se l'iscrizione è aperta a chiunque
 * (`SiteSetting.publicRegistrationEnabled`). Quando non lo è, l'elenco degli
 * invitati dell'evento (`EventInvitation`, compilato dall'area di
 * amministrazione) diventa l'elenco di chi può iscriversi: l'indirizzo con cui
 * ci si iscrive deve esserci. Un evento senza invitati, a iscrizione pubblica
 * spenta, non accetta iscrizioni.
 *
 * Non riguarda chi un posto ce l'ha già: il link personale di chi si è
 * iscritto, i link di moderatori e relatori e l'area di amministrazione
 * funzionano come prima. L'ingresso senza iscrizione è un'altra impostazione
 * (`guestAccessEnabled`, vedi `guest-window`).
 */

import type { Prisma } from '@prisma/client';

import { hashEmail } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';

/** `open`: chiunque; `invitation`: solo gli indirizzi invitati; `closed`: nessuno. */
export type RegistrationAccess = 'open' | 'invitation' | 'closed';

/** Come si iscrive il pubblico a questo evento, per scegliere cosa mostrare. */
export async function registrationAccessFor(
  eventId: string,
  publicRegistrationEnabled: boolean,
): Promise<RegistrationAccess> {
  if (publicRegistrationEnabled) return 'open';
  const invitati = await prisma.eventInvitation.count({ where: { eventId } });
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
