// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { prisma } from '@/lib/db';
import { iscrizioneDelPosto } from '@/lib/captions/room';
import { bloccaTrascrizioneEvento, togliPersoneDalleTrascrizioni } from '@/lib/captions/transcript';
import { TIMEOUT_DOPO_PULIZIA_MS } from '@/lib/gdpr/cleanup-selection';
import { ritiraProveDelleIscrizioni } from '@/lib/gdpr/retained-consent-proofs';
import { fermaInviti } from '@/lib/persons/inviti-fermati';
import { getSettings } from '@/lib/settings';

/**
 * Il ritiro dalla sala dei consensi dati per un evento (art. 7.3 GDPR: si
 * ritira con la stessa facilita' con cui si da').
 *
 * Chi ritira prova i propri posti con i token della sala che il portale gli
 * ha consegnato in questa visita (lib/auth/jwt postoDaTokenSala). Dai posti si
 * risale a tutto cio' che porta lo stesso consenso:
 *   - l'iscrizione, per chi e' entrato dal proprio link: il consenso dato
 *     all'iscrizione e le prove legate all'iscrizione, di ogni ingresso;
 *   - per chi conduce dal link primario con la sessione del proprio account,
 *     l'account dello staff a cui e' legata la prova della registrazione, con
 *     i posti degli ingressi precedenti;
 *   - per gli altri (ospiti, link inoltrati, concessioni nominali), le prove
 *     dei posti dati. Una concessione nominale e' un posto, non una persona:
 *     il link si puo' inoltrare, e il ritiro di chi lo apre non tocca i
 *     consensi di un altro che apre lo stesso link.
 *
 * Cosa cambia:
 *   - la registrazione dell'evento (`registrazione`): la prova resta, con
 *     l'ora del ritiro, e il consenso non vale piu'; con esso si ritira anche
 *     quello alla trascrizione, che senza registrazione non ha luogo;
 *   - la trascrizione dei propri interventi (sempre): le frasi dei sottotitoli
 *     gia' salvate perdono testo, nome e posto (ne restano i tempi, come per
 *     chi non ha acconsentito), e le tracce audio per persona non passano piu'
 *     alla trascrizione (lib/captions/room endpointRitirati).
 *
 * Lo stesso ritiro si fa dalla pagina dei propri dati (POST /api/gdpr/consents):
 * li' non ci sono posti, si parte dall'iscrizione provata dal link firmato.
 *
 * Un ritiro che ha letto l'iscrizione mentre la pulizia dello stesso evento la
 * cancellava aspetta il suo turno e vale sulla prova che la pulizia ha conservato.
 *
 * Ogni ritiro lascia una riga nel registro GDPR dell'evento
 * (`CONSENT_WITHDRAWN`, senza dati personali): quante prove, e quando.
 *
 * Il video gia' registrato non si modifica: chi ritira il consenso alla
 * registrazione esce dalla registrazione da quel momento, e per il tratto gia'
 * registrato vale la richiesta di cancellazione a chi organizza (docs/GDPR.md).
 */

export interface EsitoRitiro {
  /** Il consenso alla registrazione e' stato ritirato (c'era qualcosa da ritirare). */
  registrazione: boolean;
  trascrizione: boolean;
}

export interface OpzioniRitiro {
  /** Iscrizioni gia' provate da chi ritira, oltre a quelle dei posti. */
  iscrizioni?: readonly string[];
  /** Da dove arriva il ritiro, per il registro GDPR. */
  origine?: 'room' | 'self-service';
}

export async function ritiraConsensi(
  eventId: string,
  posti: readonly string[],
  cosa: { registrazione: boolean },
  adesso: Date = new Date(),
  { iscrizioni: dalleIscrizioni = [], origine = 'room' }: OpzioniRitiro = {}
): Promise<EsitoRitiro> {
  if (posti.length === 0 && dalleIscrizioni.length === 0) {
    return { registrazione: false, trascrizione: false };
  }
  return prisma.$transaction(
    async (tx) => {
      // In fila con le costruzioni della trascrizione e con le cancellazioni, per
      // prima cosa: una gia' partita non rimette le frasi tolte qui sotto, e nessuno
      // aspetta tenendo le righe che servono all'altro.
      await bloccaTrascrizioneEvento(tx, eventId);
      // Le prove della registrazione dei posti dati: portano l'iscrizione, la
      // concessione nominale o l'account dello staff.
      const proveDeiPosti = await tx.recordingConsent.findMany({
        where: { eventId, jitsiUserId: { in: [...posti] } },
        select: { registrationId: true, staffAccountId: true },
      });
      const iscrizioni = new Set<string>(dalleIscrizioni);
      for (const p of posti) {
        const r = iscrizioneDelPosto(p);
        if (r) iscrizioni.add(r);
      }
      const tracceDeiPosti = await tx.multitrackConsent.findMany({
        where: { eventId, jitsiUserId: { in: [...posti] }, registrationId: { not: null } },
        select: { registrationId: true },
      });
      for (const p of [...proveDeiPosti, ...tracceDeiPosti]) {
        if (p.registrationId) iscrizioni.add(p.registrationId);
      }
      const account = [
        ...new Set(
          proveDeiPosti.map((p) => p.staffAccountId).filter((v): v is string => !!v)
        ),
      ];
      // I posti degli ingressi precedenti dello staff dietro il link primario:
      // le prove della registrazione li legano allo stesso account.
      const postiConduce =
        account.length > 0
          ? await tx.recordingConsent.findMany({
              where: { eventId, staffAccountId: { in: account } },
              select: { jitsiUserId: true },
            })
          : [];
      const tuttiIPosti = [
        ...new Set([...posti, ...postiConduce.map((p) => p.jitsiUserId)]),
      ];
      const listaIscrizioni = [...iscrizioni];

      let proveRegistrazione = 0;
      if (cosa.registrazione) {
        const prove = await tx.recordingConsent.updateMany({
          where: {
            eventId,
            withdrawnAt: null,
            OR: [
              { jitsiUserId: { in: tuttiIPosti } },
              ...(listaIscrizioni.length > 0
                ? [{ registrationId: { in: listaIscrizioni } }]
                : []),
              ...(account.length > 0 ? [{ staffAccountId: { in: account } }] : []),
            ],
          },
          data: { withdrawnAt: adesso },
        });
        const dateAllIscrizione =
          listaIscrizioni.length > 0
            ? await tx.registration.updateMany({
                where: {
                  eventId,
                  id: { in: listaIscrizioni },
                  consentRecording: true,
                  consentRecordingWithdrawnAt: null,
                },
                data: { consentRecordingWithdrawnAt: adesso },
              })
            : { count: 0 };
        proveRegistrazione = prove.count + dateAllIscrizione.count;
      }

      const proveTracce = await tx.multitrackConsent.updateMany({
        where: {
          eventId,
          withdrawnAt: null,
          OR: [
            { jitsiUserId: { in: tuttiIPosti } },
            ...(listaIscrizioni.length > 0
              ? [{ registrationId: { in: listaIscrizioni } }]
              : []),
          ],
        },
        data: { withdrawnAt: adesso },
      });
      const tracceAllIscrizione =
        listaIscrizioni.length > 0
          ? await tx.registration.updateMany({
              where: {
                eventId,
                id: { in: listaIscrizioni },
                consentMultitrack: true,
                consentMultitrackWithdrawnAt: null,
              },
              data: { consentMultitrackWithdrawnAt: adesso },
            })
          : { count: 0 };
      // Dopo l'evento la trascrizione puo' essere gia' costruita: la persona se ne
      // va anche da li'.
      if (listaIscrizioni.length > 0) {
        await togliPersoneDalleTrascrizioni(tx, [eventId], listaIscrizioni);
      }
      // Le frasi dei sottotitoli gia' salvate: restano i tempi, come per chi
      // non ha acconsentito (lib/captions/transcript).
      const frasi = await tx.captionSegment.updateMany({
        where: {
          eventId,
          OR: [
            { seatId: { in: tuttiIPosti } },
            ...listaIscrizioni.map((r) => ({ seatId: { startsWith: `reg-${r}-` } })),
          ],
        },
        data: { seatId: null, speakerName: null, text: null },
      });
      // Le iscrizioni possono essere gia' cancellate da una pulizia che ha preso il
      // turno prima: restano le prove che ha copiato.
      const conservate =
        listaIscrizioni.length > 0
          ? await ritiraProveDelleIscrizioni(tx, eventId, listaIscrizioni, cosa, adesso)
          : { recording: 0, transcription: 0 };
      proveRegistrazione += conservate.recording;
      const proveTrascrizione =
        proveTracce.count + tracceAllIscrizione.count + conservate.transcription;
      if (proveRegistrazione + proveTrascrizione + frasi.count > 0) {
        await tx.gdprAuditLog.create({
          data: {
            eventId,
            action: 'CONSENT_WITHDRAWN',
            recordCount: proveRegistrazione + proveTrascrizione,
            details: JSON.stringify({
              source: origine,
              recording: proveRegistrazione,
              transcription: proveTrascrizione,
              captionSegmentsCleared: frasi.count,
            }),
          },
        });
      }
      return { registrazione: proveRegistrazione > 0, trascrizione: proveTrascrizione > 0 };
    },
    { timeout: TIMEOUT_DOPO_PULIZIA_MS }
  );
}

/**
 * Il ritiro del consenso alle comunicazioni future, dalla pagina dei propri
 * dati o dal link delle email (api/rubrica/opt-out). La stessa casella
 * dell'iscrizione copre comunicazioni e rubrica: si tolgono entrambe, su ogni
 * iscrizione dell'indirizzo, e il registro lo annota per ogni evento toccato, con
 * le spunte in attesa di conferma che il ritiro annulla.
 * Il segno del ritiro va su tutte le iscrizioni, anche su quelle senza la spunta:
 * sopravvive alla voce di rubrica, e una spunta successiva lo trova
 * (`indirizzoFermato`). La voce di rubrica perde subito l'email e gli inviti dell'indirizzo si fermano,
 * anche quelli scritti a mano e le loro email in coda (`fermaInviti`): il resto
 * della riga lo toglie la corsa successiva di api/cron/rubrica-retention. Se una
 * spunta aspettava conferma (lib/persons/spunta-in-attesa), non vale piu'.
 */
export async function ritiraComunicazioni(
  emailHash: string,
  adesso: Date = new Date()
): Promise<boolean> {
  const { publicRegistrationEnabled } = await getSettings();
  return prisma.$transaction(async (tx) => {
    const dove = { emailHash, consentFutureCommunications: true };
    const iscrizioni = await tx.registration.findMany({
      where: { emailHash, OR: [{ consentFutureCommunications: true }, { addressBookPending: true }] },
      select: { eventId: true, consentFutureCommunications: true, addressBookPending: true },
    });
    await tx.registration.updateMany({
      where: dove,
      data: { consentFutureCommunications: false, consentFutureCommunicationsWithdrawnAt: adesso },
    });
    await tx.registration.updateMany({
      where: { emailHash, consentFutureCommunicationsWithdrawnAt: null },
      data: { consentFutureCommunicationsWithdrawnAt: adesso },
    });
    await tx.registration.updateMany({
      where: { emailHash, addressBookPending: true },
      data: { addressBookPending: false },
    });
    const rubrica = await tx.person.updateMany({
      where: { emailHash, optedInToAddressBook: true },
      data: { optedInToAddressBook: false, optedOutAt: adesso, email: null },
    });
    await fermaInviti(
      tx,
      { OR: [{ emailHash }, { person: { emailHash } }] },
      { adesso, publicRegistrationEnabled }
    );
    await tx.gdprAuditLog.createMany({
      data: iscrizioni.map((r) => ({
        eventId: r.eventId,
        action: 'CONSENT_WITHDRAWN',
        recordCount: 1,
        details: JSON.stringify({
          source: 'self-service',
          futureCommunications: r.consentFutureCommunications ? 1 : 0,
          ...(r.addressBookPending ? { addressBookPending: 1 } : {}),
        }),
      })),
    });
    return iscrizioni.length > 0 || rubrica.count > 0;
  });
}
