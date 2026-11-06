// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { upsertPersonOnRegistration } from '@/lib/persons';
import { riapriInviti } from '@/lib/persons/inviti-fermati';

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
 * Un nuovo ritiro toglie la spunta in attesa.
 */

export type OrigineConferma = 'registration-link' | 'self-service';

/**
 * Applica la spunta in attesa di un'iscrizione: la voce torna in rubrica con i
 * dati di quell'iscrizione, il ritiro si annulla e gli inviti fermati riprendono.
 * Una seconda conferma non trova piu' niente da applicare, e non rinnova il
 * consenso. Vero se la spunta c'era.
 */
export async function applicaSpuntaInAttesa(
  registrationId: string,
  origine: OrigineConferma
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.registration.updateMany({
      where: { id: registrationId, addressBookPending: true },
      data: { addressBookPending: false, consentFutureCommunications: true },
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
      },
    });
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
    await tx.registration.update({ where: { id: registrationId }, data: { personId } });
    await tx.gdprAuditLog.create({
      data: {
        eventId: iscrizione.eventId,
        action: 'CONSENT_RECORDED',
        recordCount: 1,
        details: JSON.stringify({
          source: origine,
          consentFutureCommunications: true,
          consentAddressBook: true,
        }),
      },
    });
    return true;
  });
}
