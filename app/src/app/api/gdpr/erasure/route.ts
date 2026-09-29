/**
 * POST /api/gdpr/erasure?t=<signed-token>
 *
 * GDPR Art. 17 (right to erasure) — fulfilment step.
 *
 * Deletes every Registration row for the email-hash carried by the
 * token, along with the cascade-deleted Q&A, poll votes and reminders
 * attached to those registrations, and the address-book entry (Person,
 * ADR-011) with the same email-hash. Rows that only point at a
 * registration with onDelete SetNull, or not at all, are deleted
 * explicitly: feedback, questionnaire responses, chat messages (with
 * their attachment files), the invitations addressed to that email and
 * the outbox rows written for those registrations. Recordings tied to
 * the underlying Event are NOT deleted here — they are governed by the
 * event-level retention cron and are subject to separate legal-hold
 * rules.
 *
 * Writes a GdprAuditLog row per affected event (no PII; only counts
 * and an emailHash prefix), mirroring the cron/cleanup audit format.
 */

import { withErrorHandling } from '@/lib/api-handler';
import { AppError, RateLimitError } from '@/lib/errors';
import { prisma } from '@/lib/db';
import { deleteBlob, isAzureConfigured } from '@/lib/azure/blob-storage';
import { getClientIp, rateLimit } from '@/lib/rate-limit';
import { verifyGdprToken } from '@/lib/gdpr/request-token';

export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(async (request) => {
  const ip = getClientIp(request);
  const rl = rateLimit(`gdpr-erasure:${ip}`, {
    limit: 10,
    windowMs: 3_600_000,
  });
  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  }

  const url = new URL(request.url);
  const token = url.searchParams.get('t');
  if (!token) {
    throw new AppError('Missing token', 400, 'BAD_REQUEST');
  }

  const verified = verifyGdprToken(token, 'erasure');
  if (!verified) {
    throw new AppError('Invalid or expired token', 401, 'UNAUTHORIZED');
  }

  const { emailHash } = verified;

  // La voce di rubrica e' un dato della stessa persona, e sopravviveva: le
  // iscrizioni la puntano con onDelete SetNull, quindi cancellarle non la
  // toglieva. Va via anche quando non resta nessuna iscrizione (la rubrica
  // dura oltre la conservazione degli eventi). Inviti e relatori che la
  // citano restano, con il collegamento azzerato.
  const addressBook = await prisma.person.deleteMany({ where: { emailHash } });
  const addressBookDeleted = addressBook.count > 0;

  // Gli inviti portano nome, email cifrata e il link di iscrizione
  // precompilata: sono dati della stessa persona anche quando non si e' mai
  // iscritta, quindi vanno via come la voce di rubrica.
  const invitations = await prisma.eventInvitation.deleteMany({ where: { emailHash } });

  const registrations = await prisma.registration.findMany({
    where: { emailHash },
    select: { id: true, eventId: true },
  });

  if (registrations.length === 0) {
    return Response.json({
      ok: true,
      deleted: 0,
      addressBookDeleted,
      invitationsDeleted: invitations.count,
    });
  }

  const registrationIds = registrations.map((r) => r.id);
  const eventIds = [...new Set(registrations.map((r) => r.eventId))];
  // In chat un iscritto scrive come `reg-<id>` (lib/chat/sender): e' il solo
  // legame tra i suoi messaggi e l'iscrizione, perche' la tabella della chat
  // non ha una chiave verso le iscrizioni.
  const chatSenderIds = registrationIds.map((id) => `reg-${id}`);

  const chatAttachments = await prisma.chatMessage.findMany({
    where: { senderId: { in: chatSenderIds }, attachmentBlobPath: { not: null } },
    select: { attachmentBlobPath: true },
  });

  const counts = await prisma.$transaction(async (tx) => {
    // Feedback e risposte ai questionari puntano l'iscrizione con onDelete
    // SetNull: cancellare l'iscrizione li scollegherebbe soltanto, lasciando
    // il nome di chi ha risposto. Le risposte si portano via le domande
    // compilate per cascata.
    const feedback = await tx.eventFeedback.deleteMany({
      where: { registrationId: { in: registrationIds } },
    });
    const questionnaireResponses = await tx.questionnaireResponse.deleteMany({
      where: { registrationId: { in: registrationIds } },
    });
    const chatMessages = await tx.chatMessage.deleteMany({
      where: { senderId: { in: chatSenderIds } },
    });
    // Le reazioni della persona ai messaggi altrui: quelle ai suoi messaggi
    // se ne vanno per cascata con i messaggi.
    await tx.chatMessageReaction.deleteMany({ where: { senderId: { in: chatSenderIds } } });
    // Le email accodate per queste iscrizioni (conferma, promemoria,
    // cambio data, riepilogo) contengono indirizzo e link personali: il
    // solo aggancio e' l'id dell'iscrizione nei metadati. Anche quelle non
    // ancora partite: una persona cancellata non deve ricevere altro.
    const outboxRows = await tx.$executeRaw`
      DELETE FROM email_outbox
      WHERE metadata->>'registrationId' = ANY(${registrationIds}::text[])
    `;
    const deletedRegistrations = await tx.registration.deleteMany({
      where: { id: { in: registrationIds } },
    });
    return {
      registrations: deletedRegistrations.count,
      feedback: feedback.count,
      questionnaireResponses: questionnaireResponses.count,
      chatMessages: chatMessages.count,
      outboxRows,
    };
  });

  // I file allegati ai messaggi si cancellano dopo il commit. Se lo storage
  // non risponde il file resta, senza piu' una riga che lo citi: lo si scrive
  // nel log con il suo percorso (che non contiene dati personali) e lo si
  // conta nella risposta e nel registro, perche' qualcuno lo tolga a mano.
  let attachmentFilesNotDeleted = 0;
  if (isAzureConfigured()) {
    for (const a of chatAttachments) {
      if (!a.attachmentBlobPath) continue;
      const ok = await deleteBlob(a.attachmentBlobPath).catch((err: unknown) => {
        console.error(`[gdpr/erasure] Attachment not deleted: ${a.attachmentBlobPath}`, err);
        return false;
      });
      if (!ok) attachmentFilesNotDeleted++;
    }
  }

  for (const eventId of eventIds) {
    await prisma.gdprAuditLog.create({
      data: {
        eventId,
        action: 'DATA_DELETED',
        recordCount: registrations.filter((r) => r.eventId === eventId).length,
        details: JSON.stringify({
          source: 'gdpr-erasure-endpoint',
          emailHashPrefix: emailHash.substring(0, 8),
          addressBookDeleted,
          ...(attachmentFilesNotDeleted > 0 && { attachmentFilesNotDeleted }),
        }),
      },
    });
  }

  return Response.json({
    ok: true,
    deleted: counts.registrations,
    addressBookDeleted,
    invitationsDeleted: invitations.count,
    feedbackDeleted: counts.feedback,
    questionnaireResponsesDeleted: counts.questionnaireResponses,
    chatMessagesDeleted: counts.chatMessages,
    outboxRowsDeleted: counts.outboxRows,
    ...(attachmentFilesNotDeleted > 0 && { attachmentFilesNotDeleted }),
  });
});
