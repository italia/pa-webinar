// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import type { Prisma } from '@prisma/client';

import { annullaEmailInCoda } from '@/lib/email/outbox';

/**
 * Gli inviti di chi non va piu' contattato: ha ritirato il consenso alle
 * comunicazioni, oppure la sua voce di rubrica e' scaduta o e' stata cancellata.
 *
 * Su un evento aperto a tutti un invito non spedito non serve ad altro, e se ne
 * va. Su un evento a iscrizione non aperta la riga e' anche il posto nell'elenco
 * di chi puo' iscriversi (lib/events/registration-access): resta, e l'accesso
 * con lei. Ogni riga che resta, anche gia' spedita, riceve `declinedAt`: da li'
 * in poi non parte piu' niente, nemmeno un'email gia' in coda o in attesa di un
 * nuovo tentativo. Lo stop sta sulla riga perche' la voce di rubrica puo' non
 * esserci piu': senza di lei un invito sembrerebbe scritto a mano.
 *
 * Lo toglie una spunta confermata (`riapriInviti`, da
 * lib/persons/spunta-in-attesa). Una spunta dal solo modulo no: non prova di chi
 * sia l'indirizzo. Un altro indirizzo sulla riga, o una riga nuova, nasce fermo se
 * quell'indirizzo ha smesso di ricevere inviti (`indirizzoFermato`).
 */

export interface RegolaInviti {
  adesso: Date;
  /** `SiteSetting.publicRegistrationEnabled`, che vale per gli eventi senza una scelta. */
  publicRegistrationEnabled: boolean;
}

type DbInviti = Pick<Prisma.TransactionClient, 'eventInvitation' | 'emailOutbox'>;

/** Gli eventi a cui si iscrive chiunque: la regola di `publicRegistrationFor`. */
function eventiAperti(publicRegistrationEnabled: boolean): Prisma.EventWhereInput {
  return publicRegistrationEnabled
    ? { OR: [{ accessMode: 'OPEN' }, { accessMode: null }] }
    : { accessMode: 'OPEN' };
}

type DbMemoria = Pick<
  Prisma.TransactionClient,
  'person' | 'eventInvitation' | 'registration'
>;

/**
 * Vero se questo indirizzo ha smesso di ricevere inviti, e nessuna conferma lo ha
 * rimesso in rubrica: la voce porta un ritiro, un invito e' fermato, oppure non
 * c'e' una voce attiva e un'iscrizione ricorda il ritiro. Quando anche iscrizioni
 * e inviti sono cancellati non resta traccia del ritiro, e la risposta e' falso.
 */
export async function indirizzoFermato(
  db: DbMemoria,
  emailHash: string
): Promise<boolean> {
  const voce = await db.person.findUnique({
    where: { emailHash },
    select: { optedInToAddressBook: true, optedOutAt: true },
  });
  if (voce?.optedOutAt) return true;
  const fermato = await db.eventInvitation.findFirst({
    where: { emailHash, declinedAt: { not: null } },
    select: { id: true },
  });
  if (fermato) return true;
  if (voce?.optedInToAddressBook) return false;
  const ritiro = await db.registration.findFirst({
    where: { emailHash, consentFutureCommunicationsWithdrawnAt: { not: null } },
    select: { id: true },
  });
  return ritiro !== null;
}

export async function fermaInviti(
  db: DbInviti,
  dove: Prisma.EventInvitationWhereInput,
  { adesso, publicRegistrationEnabled }: RegolaInviti
): Promise<void> {
  const inviti = await db.eventInvitation.findMany({
    where: { AND: [dove] },
    select: { id: true },
  });
  await annullaEmailInCoda(db, { invitationIds: inviti.map((i) => i.id) });
  await db.eventInvitation.deleteMany({
    where: { AND: [dove], sentAt: null, event: eventiAperti(publicRegistrationEnabled) },
  });
  await db.eventInvitation.updateMany({
    where: { AND: [dove], declinedAt: null },
    data: { declinedAt: adesso },
  });
}

/** Chi ha confermato la spunta torna a ricevere gli inviti fermati. */
export async function riapriInviti(
  db: Pick<Prisma.TransactionClient, 'eventInvitation'>,
  emailHash: string
): Promise<void> {
  await db.eventInvitation.updateMany({
    where: { emailHash, declinedAt: { not: null } },
    data: { declinedAt: null },
  });
}
