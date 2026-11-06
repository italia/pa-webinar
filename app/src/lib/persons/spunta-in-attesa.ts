// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { upsertPersonOnRegistration } from '@/lib/persons';
import { rubricaProposta } from '@/lib/persons/address-book';
import { riapriInviti } from '@/lib/persons/inviti-fermati';
import { getSettings } from '@/lib/settings';

/**
 * La spunta della rubrica su un indirizzo che ha smesso di ricevere inviti.
 *
 * Il modulo d'iscrizione non prova di chi sia l'indirizzo: chi conosce quello di
 * un altro potrebbe annullarne il ritiro. Se c'e' un ritiro o un invito fermato
 * (`indirizzoFermato`), la spunta allora non tocca voce e inviti: resta
 * sull'iscrizione (`Registration.addressBookPending`) finche' la persona non la
 * conferma, in due modi:
 *  - con il link dell'email `proof`, aperto dal browser che ha compilato il modulo
 *    (api/events/[param]/registrations/enter): la casella e' di chi ha dato la
 *    spunta. Il link da solo non basta: i filtri antivirus della posta lo aprono
 *    prima della persona, senza quel cookie. Nemmeno il link `sig` basta, perche'
 *    li' il cookie lo da' il link stesso e non prova nessuna scelta;
 *  - con il pulsante della pagina dei propri dati (POST /api/gdpr/consents), che
 *    dice cosa cambia e con quali dati.
 *
 * L'email di conferma dice alla persona che la spunta aspetta e dove confermarla.
 * Lo stato e' dell'indirizzo: la conferma chiude tutte le sue spunte in attesa.
 * Un nuovo ritiro le toglie. Dove la rubrica non si propone piu' la spunta non si
 * conferma: se ne va senza creare la voce, il ritiro resta e il registro dell'evento
 * dice che fine ha fatto.
 */

export type OrigineConferma = 'registration-link' | 'self-service';

/** La riga di una spunta tolta senza effetto, dove la rubrica non si propone piu'. */
function rigaSpuntaTolta(eventId: string, origine: OrigineConferma) {
  return {
    eventId,
    action: 'CONSENT_WITHDRAWN',
    recordCount: 1,
    details: JSON.stringify({
      source: origine,
      futureCommunications: 0,
      addressBookPending: 1,
      reason: 'address-book-not-offered',
    }),
  };
}

/**
 * Applica la spunta in attesa di un'iscrizione: la voce torna in rubrica con i
 * dati di quell'iscrizione, il ritiro si annulla e gli inviti fermati riprendono.
 * Le altre spunte in attesa dello stesso indirizzo si chiudono con lei: valgono
 * sulle iscrizioni di eventi che offrono la rubrica, e il registro le annota evento
 * per evento, anche quelle che se ne vanno senza effetto. Una seconda conferma non
 * trova piu' niente da applicare, e non rinnova il consenso. Vero se la spunta ha
 * avuto effetto.
 */
export async function applicaSpuntaInAttesa(
  registrationId: string,
  origine: OrigineConferma
): Promise<boolean> {
  const sito = await getSettings();
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.registration.updateMany({
      where: { id: registrationId, addressBookPending: true },
      data: { addressBookPending: false },
    });
    if (count === 0) return false;
    const iscrizione = await tx.registration.findUniqueOrThrow({
      where: { id: registrationId },
      select: {
        eventId: true,
        emailHash: true,
        email: true,
        displayName: true,
        organization: true,
        organizationRole: true,
        organizationType: true,
        event: { select: { offerAddressBook: true } },
      },
    });
    if (!rubricaProposta(iscrizione.event, sito)) {
      await tx.gdprAuditLog.create({ data: rigaSpuntaTolta(iscrizione.eventId, origine) });
      return false;
    }
    const altre = await tx.registration.findMany({
      where: { emailHash: iscrizione.emailHash, addressBookPending: true },
      select: { id: true, eventId: true, event: { select: { offerAddressBook: true } } },
    });
    await tx.registration.updateMany({
      where: { id: { in: altre.map((a) => a.id) } },
      data: { addressBookPending: false },
    });
    const altreConfermate = altre.filter((a) => rubricaProposta(a.event, sito));
    const tolte = altre.filter((a) => !rubricaProposta(a.event, sito));
    const confermate = [{ id: registrationId, eventId: iscrizione.eventId }, ...altreConfermate];
    // Prima la voce, poi gli inviti: lo stesso ordine del ritiro e della
    // conservazione, che non si aspettano a vicenda.
    const personId = await upsertPersonOnRegistration(tx, {
      emailHash: iscrizione.emailHash,
      email: iscrizione.email,
      displayName: tryDecryptPII(iscrizione.displayName),
      organization: iscrizione.organization,
      organizationRole: iscrizione.organizationRole,
      organizationType: iscrizione.organizationType,
      optedIn: true,
    });
    await riapriInviti(tx, iscrizione.emailHash);
    await tx.registration.updateMany({
      where: { id: { in: confermate.map((c) => c.id) } },
      data: { consentFutureCommunications: true, personId },
    });
    await tx.gdprAuditLog.createMany({
      data: [
        ...confermate.map(({ eventId }) => ({
          eventId,
          action: 'CONSENT_RECORDED',
          recordCount: 1,
          details: JSON.stringify({
            source: origine,
            consentFutureCommunications: true,
            consentAddressBook: true,
          }),
        })),
        ...tolte.map(({ eventId }) => rigaSpuntaTolta(eventId, origine)),
      ],
    });
    return true;
  });
}
