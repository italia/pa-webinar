// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * Le modifiche a un'iscrizione dalla pagina dei propri dati: correggere nome ed
 * ente (art. 16 GDPR) e cancellare una sola iscrizione senza cancellare tutto
 * (art. 17). Le rotte (api/gdpr/registrations) le eseguono solo con il token
 * della pagina e il codice mandato all'indirizzo (lib/gdpr/confirmation-code).
 *
 * Correzione. Vale per un'iscrizione o per tutte quelle dell'indirizzo, e in
 * quel caso anche per la voce di rubrica, che e' della stessa persona. Cambia cio'
 * che parte da qui in poi: le email costruite dopo e il prossimo ingresso in sala
 * (il nome del token viene dall'iscrizione). Non tocca cio' che e' gia' successo:
 * le prove dei consensi tengono il nome con cui la persona era in sala, e
 * registrazioni, trascrizioni, chat e richieste di rimozione restano come sono.
 * Un'email gia' in coda conserva il testo con cui e' stata scritta. Nel registro
 * GDPR di ogni evento toccato resta `DATA_RECTIFIED`, con i nomi dei campi
 * cambiati e mai i valori.
 *
 * Cancellazione. La stessa della cancellazione completa (lib/gdpr/erase-registrations),
 * per quella sola iscrizione: con lei se ne vanno domande, voti, chat, feedback,
 * frasi dei sottotitoli, email in coda e richieste di rimozione evase, e le prove
 * dei consensi di un video o di una trascrizione che esistono restano senza nome.
 * Il posto si libera. La voce di rubrica, gli inviti, la foto profilo e le altre
 * iscrizioni sono dell'indirizzo, non dell'evento: restano, come quando lo staff
 * cancella un'iscrizione. Nel registro GDPR resta `DATA_DELETED`.
 */
import { encryptPII, tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { eraseRegistrations, type ErasureCounts } from '@/lib/gdpr/erase-registrations';

export type AmbitoCorrezione = 'registration' | 'address';

export interface ValoriCorretti {
  displayName: string;
  organization: string | null;
}

/** Le regole del modulo d'iscrizione, sui valori gia' ripuliti dagli spazi. */
export const NOME_MIN = 2;
export const NOME_MAX = 100;
export const ENTE_MAX = 200;

export type ErroreValori = 'nameInvalid' | 'organizationTooLong' | 'organizationRequired';

export function normalizzaValori(v: {
  displayName: string;
  organization: string | null;
}): ValoriCorretti | ErroreValori {
  const displayName = v.displayName.trim();
  const organization = v.organization?.trim() || null;
  if (displayName.length < NOME_MIN || displayName.length > NOME_MAX)
    return 'nameInvalid';
  if (organization && organization.length > ENTE_MAX) return 'organizationTooLong';
  return { displayName, organization };
}

/** Le iscrizioni toccate da una correzione, con cio' che serve a validarla. */
export async function iscrizioniDaCorreggere(
  emailHash: string,
  registrationId: string,
  ambito: AmbitoCorrezione
) {
  return prisma.registration.findMany({
    where: ambito === 'address' ? { emailHash } : { id: registrationId, emailHash },
    select: {
      id: true,
      eventId: true,
      displayName: true,
      organization: true,
      event: { select: { requireOrganization: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
}

/** Dove l'evento chiede l'ente, non si toglie: la regola del modulo. */
export function enteMancante(
  iscrizioni: readonly { event: { requireOrganization: boolean } }[],
  valori: ValoriCorretti
): boolean {
  return !valori.organization && iscrizioni.some((r) => r.event.requireOrganization);
}

export interface EsitoCorrezione {
  /** Le iscrizioni cambiate davvero. */
  iscrizioni: number;
  voceDiRubrica: boolean;
}

export async function correggiIscrizioni(
  emailHash: string,
  registrationId: string,
  ambito: AmbitoCorrezione,
  valori: ValoriCorretti
): Promise<EsitoCorrezione> {
  return prisma.$transaction(async (tx) => {
    const iscrizioni = await tx.registration.findMany({
      where: ambito === 'address' ? { emailHash } : { id: registrationId, emailHash },
      select: { id: true, eventId: true, displayName: true, organization: true },
    });
    const nomeCifrato = encryptPII(valori.displayName);
    const righe: { eventId: string | null; campi: string[] }[] = [];
    for (const r of iscrizioni) {
      const campi = [
        ...(tryDecryptPII(r.displayName) !== valori.displayName ? ['displayName'] : []),
        ...((r.organization ?? null) !== valori.organization ? ['organization'] : []),
      ];
      if (campi.length === 0) continue;
      await tx.registration.update({
        where: { id: r.id },
        data: {
          ...(campi.includes('displayName') && { displayName: nomeCifrato }),
          ...(campi.includes('organization') && { organization: valori.organization }),
        },
      });
      righe.push({ eventId: r.eventId, campi });
    }
    // La voce di rubrica e' della stessa persona: la correzione di tutte le
    // iscrizioni la raggiunge. Una sola iscrizione puo' avere un ente diverso
    // dagli altri (un evento seguito per un altro ufficio), e la voce resta.
    let voceDiRubrica = false;
    if (ambito === 'address') {
      const voce = await tx.person.findUnique({
        where: { emailHash },
        select: {
          id: true,
          displayName: true,
          organization: true,
          optedInToAddressBook: true,
        },
      });
      if (voce?.optedInToAddressBook) {
        const campi = [
          ...((voce.displayName ? tryDecryptPII(voce.displayName) : null) !==
          valori.displayName
            ? ['displayName']
            : []),
          ...((voce.organization ?? null) !== valori.organization
            ? ['organization']
            : []),
        ];
        if (campi.length > 0) {
          await tx.person.update({
            where: { id: voce.id },
            data: {
              ...(campi.includes('displayName') && { displayName: nomeCifrato }),
              ...(campi.includes('organization') && {
                organization: valori.organization,
              }),
            },
          });
          righe.push({ eventId: null, campi: campi.map((c) => `addressBook.${c}`) });
          voceDiRubrica = true;
        }
      }
    }
    if (righe.length > 0) {
      await tx.gdprAuditLog.createMany({
        data: righe.map(({ eventId, campi }) => ({
          eventId,
          action: 'DATA_RECTIFIED',
          recordCount: 1,
          details: JSON.stringify({
            source: 'self-service',
            scope: ambito,
            fields: campi,
            emailHashPrefix: emailHash.substring(0, 8),
          }),
        })),
      });
    }
    return { iscrizioni: righe.filter((r) => r.eventId !== null).length, voceDiRubrica };
  });
}

/**
 * Cancella un'iscrizione dell'indirizzo. `null` se non c'e' (gia' cancellata, o
 * di un altro indirizzo).
 */
export async function cancellaIscrizione(
  emailHash: string,
  registrationId: string
): Promise<ErasureCounts | null> {
  const iscrizione = await prisma.registration.findFirst({
    where: { id: registrationId, emailHash },
    select: { id: true, eventId: true },
  });
  if (!iscrizione) return null;
  const counts = await eraseRegistrations([iscrizione], 'gdpr/registration-cancel');
  // Una cancellazione arrivata insieme a questa, o la pulizia dell'evento, l'ha
  // gia' tolta: niente da annotare due volte.
  if (counts.registrations === 0) return null;
  const { attachmentFilesNotDeleted, consentProofsKept } = counts;
  await prisma.gdprAuditLog.create({
    data: {
      eventId: iscrizione.eventId,
      action: 'DATA_DELETED',
      recordCount: counts.registrations,
      details: JSON.stringify({
        source: 'gdpr-registration-cancel',
        emailHashPrefix: emailHash.substring(0, 8),
        ...(consentProofsKept > 0 && { consentProofsWithoutName: consentProofsKept }),
        ...(attachmentFilesNotDeleted > 0 && { attachmentFilesNotDeleted }),
      }),
    },
  });
  return counts;
}
