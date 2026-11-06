// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * Cancellazione completa di una o piu' iscrizioni: la stessa per la richiesta
 * dell'interessato (art. 17, /api/gdpr/erasure) e per la cancellazione fatta
 * dallo staff dalla scheda Persone dell'evento (art. 16-17 su richiesta
 * arrivata per altre vie).
 *
 * L'iscrizione porta via per cascata domande, voti, reazioni all'agenda,
 * promemoria e prove del consenso alla registrazione per partecipante. Il resto
 * si cancella qui, esplicitamente: feedback e risposte ai questionari (che la
 * puntano con SetNull), i messaggi di chat scritti come `reg-<id>` con i loro
 * allegati e reazioni, e le email accodate per quelle iscrizioni.
 *
 * Le prove dei consensi di un video o di una trascrizione pubblicati restano,
 * senza nome, finche' sono pubblicati (lib/gdpr/retained-consent-proofs): si
 * copiano prima che la cascata le porti via. Il video non cambia.
 *
 * Il chiamante ha gia' letto le iscrizioni e dice a quale evento appartengono:
 * mentre aspetta il suo turno una pulizia puo' averle gia' cancellate, e quello
 * che ha copiato con il nome perde il nome qui.
 */
import { deleteBlob, isAzureConfigured } from '@/lib/azure/blob-storage';
import { bloccaTrascrizioneEvento, togliPersoneDalleTrascrizioni } from '@/lib/captions/transcript';
import { prisma } from '@/lib/db';
import {
  conservaProve,
  tipiDelleProve,
  togliNomeDelleIscrizioni,
} from '@/lib/gdpr/retained-consent-proofs';

/** La copia delle prove si aggiunge a una transazione gia' lunga, che puo' anche
 *  aspettare le costruzioni della trascrizione e la pulizia dello stesso evento. */
export const TIMEOUT_CANCELLAZIONE_MS = 30_000;

export interface ErasureCounts {
  registrations: number;
  feedback: number;
  questionnaireResponses: number;
  chatMessages: number;
  outboxRows: number;
  /** Prove dei consensi rimaste, senza nome, per cio' che e' pubblicato: copiate
   *  qui, o gia' copiate da una pulizia in corso. */
  consentProofsKept: number;
  /** File allegati che lo storage non ha cancellato: vanno tolti a mano. */
  attachmentFilesNotDeleted: number;
}

export async function eraseRegistrations(
  iscrizioni: readonly { id: string; eventId: string }[],
  logPrefix: string,
): Promise<ErasureCounts> {
  const registrationIds = iscrizioni.map((r) => r.id);
  // In chat un iscritto scrive come `reg-<id>` (lib/chat/sender): e' il solo
  // legame tra i suoi messaggi e l'iscrizione, perche' la tabella della chat
  // non ha una chiave verso le iscrizioni.
  const chatSenderIds = registrationIds.map((id) => `reg-${id}`);

  const chatAttachments = await prisma.chatMessage.findMany({
    where: { senderId: { in: chatSenderIds }, attachmentBlobPath: { not: null } },
    select: { attachmentBlobPath: true },
  });

  const counts = await prisma.$transaction(async (tx) => {
    // In fila con le costruzioni della trascrizione, i ritiri e la pulizia degli
    // stessi eventi, per prima cosa e in ordine: una costruzione gia' partita non
    // rimette le frasi tolte qui sotto, e nessuno aspetta tenendo le righe che
    // servono all'altro.
    const idEventi = [...new Set(iscrizioni.map((r) => r.eventId))].sort();
    for (const id of idEventi) await bloccaTrascrizioneEvento(tx, id);
    // Prima che la cascata delle iscrizioni le porti via.
    const adesso = new Date();
    let consentProofsKept = 0;
    for (const eventId of idEventi) {
      consentProofsKept += await conservaProve(tx, {
        eventId,
        tipi: await tipiDelleProve(tx, eventId),
        registrationIds,
        senzaNome: true,
        adesso,
      });
      consentProofsKept += await togliNomeDelleIscrizioni(
        tx,
        eventId,
        iscrizioni.filter((r) => r.eventId === eventId).map((r) => r.id),
        adesso,
      );
    }
    const feedback = await tx.eventFeedback.deleteMany({
      where: { registrationId: { in: registrationIds } },
    });
    const questionnaireResponses = await tx.questionnaireResponse.deleteMany({
      where: { registrationId: { in: registrationIds } },
    });
    const chatMessages = await tx.chatMessage.deleteMany({
      where: { senderId: { in: chatSenderIds } },
    });
    // Le parole di «In una parola»: la tabella non ha una chiave verso le
    // iscrizioni, quindi la cascata non le porta via. Alla scadenza della
    // conservazione restano senza identita'; chi chiede la cancellazione le
    // toglie subito.
    const wordCloudSubmissions = await tx.wordCloudSubmission.deleteMany({
      where: { registrationId: { in: registrationIds } },
    });
    // Le reazioni della persona ai messaggi altrui: quelle ai suoi messaggi
    // se ne vanno per cascata con i messaggi.
    await tx.chatMessageReaction.deleteMany({ where: { senderId: { in: chatSenderIds } } });
    // La trascrizione gia' costruita dai sottotitoli: le frasi e il nome della
    // persona se ne vanno anche da li' (lib/captions/transcript).
    await togliPersoneDalleTrascrizioni(tx, idEventi, registrationIds);
    // Le frasi dei sottotitoli salvate per la trascrizione e i posti in sala:
    // il posto della conferenza e' `reg-<id>-<suffisso>`, l'unico legame con
    // l'iscrizione.
    const postiInSala = registrationIds.map((id) => ({ seatId: { startsWith: `reg-${id}-` } }));
    if (postiInSala.length > 0) {
      await tx.captionSegment.deleteMany({ where: { OR: postiInSala } });
      await tx.roomOccupant.deleteMany({ where: { OR: postiInSala } });
    }
    // Le email accodate per queste iscrizioni (conferma, promemoria, cambio
    // data, riepilogo) contengono indirizzo e link personali: il solo aggancio
    // e' l'id dell'iscrizione nei metadati. Anche quelle non ancora partite:
    // una persona cancellata non deve ricevere altro.
    const outboxRows = await tx.$executeRaw`
      DELETE FROM email_outbox
      WHERE metadata->>'registrationId' = ANY(${registrationIds}::text[])
    `;
    const registrations = await tx.registration.deleteMany({
      where: { id: { in: registrationIds } },
    });
    return {
      registrations: registrations.count,
      feedback: feedback.count,
      questionnaireResponses: questionnaireResponses.count,
      chatMessages: chatMessages.count,
      wordCloudSubmissions: wordCloudSubmissions.count,
      outboxRows,
      consentProofsKept,
    };
  }, { timeout: TIMEOUT_CANCELLAZIONE_MS });

  // I file allegati si cancellano dopo il commit. Se lo storage non risponde
  // il file resta, senza piu' una riga che lo citi: lo si scrive nel log con il
  // suo percorso (che non contiene dati personali) e lo si conta, perche'
  // qualcuno lo tolga a mano.
  let attachmentFilesNotDeleted = 0;
  if (isAzureConfigured()) {
    for (const a of chatAttachments) {
      if (!a.attachmentBlobPath) continue;
      const ok = await deleteBlob(a.attachmentBlobPath).catch((err: unknown) => {
        console.error(`[${logPrefix}] Attachment not deleted: ${a.attachmentBlobPath}`, err);
        return false;
      });
      if (!ok) attachmentFilesNotDeleted++;
    }
  }

  return { ...counts, attachmentFilesNotDeleted };
}
