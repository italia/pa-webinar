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
 */
import { deleteBlob, isAzureConfigured } from '@/lib/azure/blob-storage';
import { bloccaTrascrizioneEvento, togliPersoneDalleTrascrizioni } from '@/lib/captions/transcript';
import { prisma } from '@/lib/db';

export interface ErasureCounts {
  registrations: number;
  feedback: number;
  questionnaireResponses: number;
  chatMessages: number;
  outboxRows: number;
  /** File allegati che lo storage non ha cancellato: vanno tolti a mano. */
  attachmentFilesNotDeleted: number;
}

export async function eraseRegistrations(
  registrationIds: string[],
  logPrefix: string,
): Promise<ErasureCounts> {
  // In chat un iscritto scrive come `reg-<id>` (lib/chat/sender): e' il solo
  // legame tra i suoi messaggi e l'iscrizione, perche' la tabella della chat
  // non ha una chiave verso le iscrizioni.
  const chatSenderIds = registrationIds.map((id) => `reg-${id}`);

  const chatAttachments = await prisma.chatMessage.findMany({
    where: { senderId: { in: chatSenderIds }, attachmentBlobPath: { not: null } },
    select: { attachmentBlobPath: true },
  });

  const counts = await prisma.$transaction(async (tx) => {
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
    const eventi = await tx.registration.findMany({
      where: { id: { in: registrationIds } },
      select: { eventId: true },
      distinct: ['eventId'],
    });
    // In fila con le costruzioni della trascrizione degli stessi eventi: una
    // costruzione gia' partita non rimette le frasi appena tolte.
    const idEventi = eventi.map((e) => e.eventId).sort();
    for (const id of idEventi) await bloccaTrascrizioneEvento(tx, id);
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
    };
  });

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
