// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import type { Prisma } from '@prisma/client';

/**
 * Gli inviti di chi non va piu' contattato: ha ritirato il consenso alle
 * comunicazioni, oppure la sua voce di rubrica e' scaduta o e' stata cancellata.
 *
 * Su un evento aperto a tutti un invito non spedito non serve ad altro, e se ne
 * va. Su un evento a iscrizione non aperta la riga e' anche il posto nell'elenco
 * di chi puo' iscriversi (lib/events/registration-access): resta, e l'accesso
 * con lei. Ogni riga che resta, anche gia' spedita, riceve `declinedAt`: da li'
 * in poi non parte piu' niente. Lo stop sta sulla riga perche' la voce di rubrica
 * puo' non esserci piu': senza di lei un invito sembrerebbe scritto a mano.
 *
 * Una nuova spunta (`riapriInviti`) o un indirizzo nuovo sulla riga lo tolgono.
 */

export interface RegolaInviti {
  adesso: Date;
  /** `SiteSetting.publicRegistrationEnabled`, che vale per gli eventi senza una scelta. */
  publicRegistrationEnabled: boolean;
}

type DbInviti = Pick<Prisma.TransactionClient, 'eventInvitation'>;

/** Gli eventi a cui si iscrive chiunque: la regola di `publicRegistrationFor`. */
function eventiAperti(publicRegistrationEnabled: boolean): Prisma.EventWhereInput {
  return publicRegistrationEnabled
    ? { OR: [{ accessMode: 'OPEN' }, { accessMode: null }] }
    : { accessMode: 'OPEN' };
}

export async function fermaInviti(
  db: DbInviti,
  dove: Prisma.EventInvitationWhereInput,
  { adesso, publicRegistrationEnabled }: RegolaInviti
): Promise<void> {
  await db.eventInvitation.deleteMany({
    where: { AND: [dove], sentAt: null, event: eventiAperti(publicRegistrationEnabled) },
  });
  await db.eventInvitation.updateMany({
    where: { AND: [dove], declinedAt: null },
    data: { declinedAt: adesso },
  });
}

/** Chi spunta di nuovo il consenso torna a ricevere gli inviti fermati. */
export async function riapriInviti(db: DbInviti, emailHash: string): Promise<void> {
  await db.eventInvitation.updateMany({
    where: { emailHash, declinedAt: { not: null } },
    data: { declinedAt: null },
  });
}
