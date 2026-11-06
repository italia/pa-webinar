// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

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
 * their attachment files), the invitations addressed to that email with
 * their queued and sent emails, the
 * named grants with that email (with their photos, when no other event
 * uses them), the consents given entering the room with a staff account of
 * that email, and the outbox rows written for those registrations.
 * Le prove dei consensi di un video o di una trascrizione che esistono, anche
 * non ancora pubblicati, restano senza nome e ritirate finche' esistono, comprese
 * quelle gia' conservate di un evento ripulito (lib/gdpr/retained-consent-proofs).
 * Le prove della stessa persona date entrando con una concessione o un account
 * si trovano anche quando la concessione o l'account non ci sono piu'.
 * Recordings tied to the underlying Event are NOT deleted here — they are
 * governed by the event-level retention cron and are subject to separate
 * legal-hold rules.
 *
 * Writes a GdprAuditLog row per affected event (no PII; only counts
 * and an emailHash prefix), mirroring the cron/cleanup audit format.
 */

import { withErrorHandling } from '@/lib/api-handler';
import { AppError, RateLimitError } from '@/lib/errors';
import { prisma } from '@/lib/db';
import { cancellaEmailInviti } from '@/lib/email/outbox';
import { getClientIp, rateLimit } from '@/lib/rate-limit';
import { TIMEOUT_DOPO_PULIZIA_MS } from '@/lib/gdpr/cleanup-selection';
import { eraseRegistrations } from '@/lib/gdpr/erase-registrations';
import { verifyGdprToken } from '@/lib/gdpr/request-token';
import { invalidateModeratorCache } from '@/lib/auth/moderator';
import { bloccaTrascrizioneEvento } from '@/lib/captions/transcript';
import { deleteUnreferencedPersonPhotos } from '@/lib/events/person-photo-store';
import {
  conservaProve,
  tipiDelleProveEsistenti,
  togliNomeDalleProve,
} from '@/lib/gdpr/retained-consent-proofs';

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
  const adesso = new Date();

  // La voce di rubrica e' un dato della stessa persona, e sopravviveva: le
  // iscrizioni la puntano con onDelete SetNull, quindi cancellarle non la
  // toglieva. Va via anche quando non resta nessuna iscrizione (la rubrica
  // dura oltre la conservazione degli eventi). Inviti e relatori che la
  // citano restano, con il collegamento azzerato.
  const addressBook = await prisma.person.deleteMany({ where: { emailHash } });
  const addressBookDeleted = addressBook.count > 0;

  // Gli inviti portano nome, email cifrata e il link di iscrizione
  // precompilata: sono dati della stessa persona anche quando non si e' mai
  // iscritta, quindi vanno via come la voce di rubrica, con le loro email: una
  // persona cancellata non deve ricevere altro.
  const inviti = await prisma.eventInvitation.findMany({
    where: { emailHash },
    select: { id: true },
  });
  await cancellaEmailInviti(prisma, inviti.map((i) => i.id));
  const invitations = await prisma.eventInvitation.deleteMany({ where: { emailHash } });

  // Le concessioni nominali con lo stesso indirizzo (nome, email, ente):
  // cancellarle toglie anche il link personale per entrare nella sala, subito,
  // senza aspettare la cache delle verifiche dei moderatori.
  const daTogliere = await prisma.eventModerator.findMany({
    where: { emailHash },
    select: { id: true, eventId: true, token: true, photoId: true },
  });
  // I consensi dati entrando dal link primario con un account dello staff:
  // l'account resta, la prova porta il nome della persona.
  const account = await prisma.staffAccount.findUnique({
    where: { emailHash },
    select: { id: true },
  });
  const grantIds = daTogliere.map((g) => g.id);
  // Le prove di sala della persona: la registrazione e la trascrizione, date
  // entrando con quelle concessioni o con quell'account, o con un indirizzo la
  // cui concessione o il cui account non ci sono piu'.
  const dellaPersona = [
    { emailHash },
    { eventModeratorId: { in: grantIds } },
    ...(account ? [{ staffAccountId: account.id }] : []),
  ];
  const [proveRegistrazione, proveTrascrizione] = await Promise.all([
    prisma.recordingConsent.findMany({
      where: { OR: dellaPersona },
      select: { eventId: true },
      distinct: ['eventId'],
    }),
    prisma.multitrackConsent.findMany({
      where: { OR: dellaPersona },
      select: { eventId: true },
      distinct: ['eventId'],
    }),
  ]);
  // Nome cifrato e posto: via con loro, non solo scollegate. Se esiste ancora un
  // video o una trascrizione ne resta la copia, senza nome. Copia e cancellazione
  // vanno insieme: un nuovo tentativo non la raddoppia.
  const proveCopiate = new Map<string, number>();
  const eventiConProve = [
    ...new Set(
      [...daTogliere, ...proveRegistrazione, ...proveTrascrizione].map((p) => p.eventId)
    ),
  ].sort();
  if (eventiConProve.length > 0) {
    await prisma.$transaction(async (tx) => {
      // In fila con la pulizia degli stessi eventi, come per le iscrizioni: la
      // stessa prova non si copia due volte, una delle due con il nome.
      for (const eventId of eventiConProve) await bloccaTrascrizioneEvento(tx, eventId);
      for (const eventId of eventiConProve) {
        const copiate = await conservaProve(tx, {
          eventId,
          tipi: await tipiDelleProveEsistenti(tx, eventId),
          grantIds: daTogliere.filter((g) => g.eventId === eventId).map((g) => g.id),
          staffAccountIds: account ? [account.id] : [],
          emailHash,
          senzaNome: true,
          adesso,
        });
        if (copiate > 0) proveCopiate.set(eventId, copiate);
      }
      const scelte = { eventId: { in: eventiConProve }, OR: dellaPersona };
      await tx.recordingConsent.deleteMany({ where: scelte });
      await tx.multitrackConsent.deleteMany({ where: scelte });
    }, { timeout: TIMEOUT_DOPO_PULIZIA_MS });
  }
  const grants = await prisma.eventModerator.deleteMany({ where: { emailHash } });
  for (const g of daTogliere) invalidateModeratorCache(g.eventId, g.token);
  // Le foto di quelle concessioni, caricate dallo staff: via, salvo quelle
  // che un'altra persona o un altro evento usa ancora.
  const grantPhotosDeleted = await deleteUnreferencedPersonPhotos(prisma, {
    ids: daTogliere.map((g) => g.photoId).filter((id): id is string => !!id),
  });

  // La foto profilo e' legata all'email, non a un evento: va via qui anche
  // quando non resta nessuna iscrizione.
  const photo = await prisma.profilePhoto.deleteMany({ where: { emailHash } });
  const profilePhotoDeleted = photo.count > 0;

  const registrations = await prisma.registration.findMany({
    where: { emailHash },
    select: { id: true, eventId: true },
  });
  const counts =
    registrations.length > 0 ? await eraseRegistrations(registrations, 'gdpr/erasure') : null;

  // Le prove gia' conservate di eventi ripuliti: per chi ha solo quelle e' tutto
  // cio' che la cancellazione cambia, e deve restarne traccia nel registro. Dopo
  // le iscrizioni, cosi' prende anche cio' che una pulizia in corso ha copiato
  // con il nome mentre questa richiesta aspettava il suo turno.
  const proveToccate = await togliNomeDalleProve(emailHash, adesso);
  for (const [eventId, copiate] of proveCopiate) {
    proveToccate.set(eventId, (proveToccate.get(eventId) ?? 0) + copiate);
  }

  const registraCancellazione = (eventId: string, recordCount: number, altri: object = {}) =>
    prisma.gdprAuditLog.create({
      data: {
        eventId,
        action: 'DATA_DELETED',
        recordCount,
        details: JSON.stringify({
          source: 'gdpr-erasure-endpoint',
          emailHashPrefix: emailHash.substring(0, 8),
          addressBookDeleted,
          ...altri,
        }),
      },
    });
  const proveRimaste = () => prisma.retainedConsentProof.count({ where: { emailHash } });

  if (!counts) {
    for (const [eventId, prove] of proveToccate) {
      await registraCancellazione(eventId, prove, { consentProofsWithoutName: prove });
    }
    return Response.json({
      ok: true,
      deleted: 0,
      addressBookDeleted,
      invitationsDeleted: invitations.count,
      grantsDeleted: grants.count,
      grantPhotosDeleted,
      profilePhotoDeleted,
      consentProofsKept: await proveRimaste(),
    });
  }

  const eventIds = [...new Set(registrations.map((r) => r.eventId))];
  const { attachmentFilesNotDeleted } = counts;

  for (const eventId of new Set([...eventIds, ...proveToccate.keys()])) {
    const prove = proveToccate.get(eventId) ?? 0;
    await registraCancellazione(
      eventId,
      registrations.filter((r) => r.eventId === eventId).length + prove,
      {
        ...(prove > 0 && { consentProofsWithoutName: prove }),
        ...(attachmentFilesNotDeleted > 0 && { attachmentFilesNotDeleted }),
      }
    );
  }

  return Response.json({
    ok: true,
    deleted: counts.registrations,
    addressBookDeleted,
    invitationsDeleted: invitations.count,
    grantsDeleted: grants.count,
    grantPhotosDeleted,
    profilePhotoDeleted,
    feedbackDeleted: counts.feedback,
    questionnaireResponsesDeleted: counts.questionnaireResponses,
    chatMessagesDeleted: counts.chatMessages,
    outboxRowsDeleted: counts.outboxRows,
    consentProofsKept: await proveRimaste(),
    ...(attachmentFilesNotDeleted > 0 && { attachmentFilesNotDeleted }),
  });
});
