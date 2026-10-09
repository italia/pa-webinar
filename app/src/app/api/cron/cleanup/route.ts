import { Prisma } from '@prisma/client';

import { withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { assertCronApiKey } from '@/lib/auth/cron';
import { deleteRecordingBlob } from '@/lib/storage/recordings';
import { deleteBlob, isAzureConfigured } from '@/lib/azure/blob-storage';
import { closeStaleSessions, type OvertimeLimits } from '@/lib/events/call-sessions';
import { OVERTIME_CAP_DEFAULT_MINUTES, OVERTIME_EMPTY_DEFAULT_MINUTES } from '@/lib/events/overtime-defaults';
import {
  CLEANABLE_EVENT_STATUSES,
  UNFINISHED_EVENT_STATUSES,
  isEventEligibleForCleanup,
  isFinishedEventStatus,
  isRecordingRetentionExpired,
  shouldPurgeRecordingBlob,
  tempRecordingExpiryCutoff,
} from '@/lib/gdpr/cleanup-selection';
import { getSettings } from '@/lib/settings';
import {
  AUDIT_ACTIONS_WITH_NAMES,
  auditLogPersonalDataRetentionDays,
  emailOutboxRetentionDays,
  staffInactiveDeactivateDays,
} from '@/lib/gdpr/log-retention';
import { completaImprontaConcessioni } from '@/lib/events/grant-email-hash';

/** Giorni senza iscrizioni dopo cui una foto profilo si cancella. */
const PROFILE_PHOTO_GRACE_DAYS = 30;

export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/cleanup
 *
 * GDPR data cleanup: for events whose retention period has expired, deletes
 * participant personal data — registrations, chat messages (encrypted),
 * invitations, named grants, consents, reactions — and strips every identity
 * from the content that stays with the event (questions, poll votes, words,
 * ratings, end-of-event answers, materials). Ripassa ogni giorno sugli eventi
 * oltre la conservazione: tutto e' idempotente, e cosi' toglie anche cio' che
 * si fosse scritto dopo il primo giro o che un giro fallito avesse lasciato.
 * L'evento concluso resta com'e'.
 *
 * Vale anche per gli eventi mai conclusi (PUBLISHED, PROVISIONING, IDLE, LIVE
 * oltre la fine più la retention): vengono archiviati, con le sessioni di
 * chiamata chiuse, e ripuliti nello stesso giro.
 *
 * Fuori dagli eventi: svuota la coda delle email inviate o fallite e toglie
 * IP, user agent e nomi dal registro audit oltre la loro conservazione
 * (lib/gdpr/log-retention).
 *
 * Se una parte fallisce risponde 500 con `ok: false` e l'elenco delle parti
 * fallite: il CronJob fallisce e si vede, invece di dare un esito verde a una
 * conservazione che non e' avvenuta.
 *
 * Protected by CRON_API_KEY.
 * In production, called daily at 03:00 UTC via a Kubernetes CronJob.
 */
export const GET = withErrorHandling(async (request) => {
  assertCronApiKey(request);

  const now = new Date();
  const failures: string[] = [];

  // ── Phase 1: Clean up expired temporary recordings (24h) ──
  const tempRecordingEvents = await prisma.event.findMany({
    where: {
      tempRecordingUrl: { not: null },
      recordingPublished: false,
      tempRecordingStartedAt: { lt: tempRecordingExpiryCutoff(now) },
    },
    select: { id: true, slug: true, tempRecordingUrl: true },
  });

  for (const evt of tempRecordingEvents) {
    try {
      // Delete the blob first (network I/O — kept OUTSIDE the transaction).
      // deleteRecordingBlob is best-effort: it no-ops + warns when storage
      // isn't configured (dev) or the URL can't be parsed, and returns false
      // rather than throwing, so a storage hiccup never blocks the DB cleanup.
      if (evt.tempRecordingUrl) {
        await deleteRecordingBlob(evt.tempRecordingUrl).catch(() => false);
      }
      await prisma.$transaction([
        prisma.event.update({
          where: { id: evt.id },
          data: { tempRecordingUrl: null, tempRecordingStartedAt: null },
        }),
        prisma.gdprAuditLog.create({
          data: {
            eventId: evt.id,
            action: 'TEMP_RECORDING_DELETED',
            recordCount: 1,
            details: JSON.stringify({ reason: '24h_expiry' }),
          },
        }),
      ]);
      console.log(
        `[cron/cleanup] Temp recording cleared for event ${evt.id} (${evt.slug})`
      );
    } catch (err) {
      console.error(
        `[cron/cleanup] Failed to clear temp recording for event ${evt.id}:`,
        err
      );
      failures.push(`temp-recording:${evt.id}`);
    }
  }

  // ── Phase 2: Clean up published recordings past their retention ──
  const recordingRetentionEvents = await prisma.event.findMany({
    where: {
      recordingUrl: { not: null },
      recordingPublished: true,
      recordingDeleteAfterDays: { not: null },
      recordingPublishedAt: { not: null },
    },
    select: {
      id: true,
      slug: true,
      recordingUrl: true,
      recordingDeleteAfterDays: true,
      recordingPublishedAt: true,
    },
  });

  for (const evt of recordingRetentionEvents) {
    if (!isRecordingRetentionExpired(evt, now)) continue;

    try {
      // Delete the expired blob (best-effort, outside the transaction).
      if (evt.recordingUrl) {
        await deleteRecordingBlob(evt.recordingUrl).catch(() => false);
      }
      await prisma.$transaction([
        prisma.event.update({
          where: { id: evt.id },
          data: {
            recordingUrl: null,
            recordingPublished: false,
            recordingPublishedAt: null,
            recordingFileSize: null,
            recordingDuration: null,
            recordingDeleteAfterDays: null,
          },
        }),
        prisma.gdprAuditLog.create({
          data: {
            eventId: evt.id,
            action: 'RECORDING_DELETED',
            recordCount: 1,
            details: JSON.stringify({
              reason: 'retention_expired',
              retentionDays: evt.recordingDeleteAfterDays,
            }),
          },
        }),
      ]);
      console.log(
        `[cron/cleanup] Published recording cleared for event ${evt.id} (${evt.slug})`
      );
    } catch (err) {
      console.error(`[cron/cleanup] Failed to clear recording for event ${evt.id}:`, err);
      failures.push(`recording:${evt.id}`);
    }
  }

  // ── Phase 3: Full event data retention cleanup ──
  // Gli eventi conclusi, e quelli mai conclusi oltre la loro fine: la
  // retention decorre da `endsAt`, non dallo stato (lib/gdpr/cleanup-selection).
  const expiredEvents = await prisma.event.findMany({
    where: {
      OR: [
        { status: { in: [...CLEANABLE_EVENT_STATUSES] } },
        { status: { in: [...UNFINISHED_EVENT_STATUSES] }, endsAt: { lt: now } },
      ],
    },
    select: {
      id: true,
      slug: true,
      endsAt: true,
      lastActiveAt: true,
      dataRetentionDays: true,
      status: true,
      recordingUrl: true,
      tempRecordingUrl: true,
      recordingPublished: true,
      _count: { select: { registrations: true, questions: true, polls: true } },
    },
  });

  const toClean = expiredEvents.filter((evt) => isEventEligibleForCleanup(evt, now));
  // Le regole del fuori orario servono solo a stimare la fine delle sessioni
  // rimaste aperte sugli eventi mai conclusi: si leggono solo se ce n'è uno.
  const unfinished = toClean.filter((evt) => !isFinishedEventStatus(evt.status));
  const settingsOvertime = unfinished.length > 0 ? await getSettings() : null;
  const overtimeLimits: OvertimeLimits = {
    siteGraceMinutes: settingsOvertime?.eventGracePeriodMinutes ?? OVERTIME_CAP_DEFAULT_MINUTES,
    overtimeEmptyMinutes:
      settingsOvertime?.eventOvertimeEmptyMinutes ?? OVERTIME_EMPTY_DEFAULT_MINUTES,
  };
  let unfinishedArchived = 0;

  let totalRegistrationsDeleted = 0;
  let totalQuestionsAnonymized = 0;
  let totalPollVotesAnonymized = 0;
  let eventsProcessed = 0;

  let totalRecordingBlobsDeleted = 0;
  let totalAttachmentBlobsDeleted = 0;

  for (const evt of toClean) {
    try {
      // I materiali restano con l'evento, file compresi: se ne vanno solo
      // quando si cancella l'evento (lib/events/material-files,
      // removeFilesOfEventsBeingDeleted). Qui perdono solo il nome di chi li
      // ha aggiunti.

      // Chat attachment blobs (files domain, assets/ prefix) — capture before
      // the rows are deleted so we can purge the underlying blobs afterwards.
      const chatAttachmentBlobs = await prisma.chatMessage.findMany({
        where: { eventId: evt.id, attachmentBlobPath: { not: null } },
        select: { attachmentBlobPath: true },
      });

      const result = await prisma.$transaction(async (tx) => {
        const upvotesDeleted = await tx.questionUpvote.deleteMany({
          where: { question: { eventId: evt.id } },
        });

        // I pollici in su dati con l'identificativo del browser (ospiti,
        // relatori, moderatori) stanno in una tabella a parte. Se ne
        // andrebbero anche per cascata con la domanda, qui sotto: si
        // cancellano per nome come quelli degli iscritti, perché la pulizia
        // non dipenda da una clausola della chiave esterna.
        const guestUpvotesDeleted = await tx.questionGuestUpvote.deleteMany({
          where: { question: { eventId: evt.id } },
        });

        // ── Contenuti della sala: restano con l'evento, senza identita' ──
        // Domande e risposte, sondaggi, parole, valutazioni, materiali,
        // agenda e cronologia restano finche' esiste l'evento, perche' chi
        // organizza possa decidere se pubblicarli. Perdono pero' ogni legame
        // con una persona: nome dell'autore, iscrizione, identificativo del
        // browser. Si fa PRIMA di cancellare le iscrizioni: domande e voti
        // hanno la chiave verso l'iscrizione in cascata, e se ne andrebbero
        // con lei. Al posto di iscrizione e identificativo del browser resta
        // uno pseudonimo `anon:<md5(evento:identita')>`: lo stesso per la
        // stessa persona in tutte le tabelle dell'evento, diverso da evento a
        // evento, senza ritorno alla persona (l'iscrizione si cancella qui
        // sotto). Cosi' reggono i vincoli «uno per persona» e i conteggi per
        // persona restano quelli di prima.
        // Solo le righe non ancora anonime: il giro e' quotidiano, e il
        // conteggio deve dire cosa e' cambiato oggi.
        const questionsAnonymized = await tx.question.updateMany({
          where: { eventId: evt.id, OR: [{ registrationId: { not: null } }, { authorName: { not: '' } }] },
          data: { registrationId: null, authorName: '' },
        });

        const pollVotesAnonymized = await tx.$executeRaw`
          UPDATE "poll_votes" SET "registration_id" = NULL,
              "guest_id" = 'anon:' || md5(${evt.id}::text || ':' || COALESCE("registration_id"::text, "guest_id", "id"::text))
          WHERE "poll_id" IN (SELECT "id" FROM "polls" WHERE "event_id" = ${evt.id}::uuid)
            AND ("registration_id" IS NOT NULL OR "guest_id" NOT LIKE 'anon:%')`;

        const feedbackAnonymized = await tx.$executeRaw`
          UPDATE "event_feedback" SET "registration_id" = NULL,
              "guest_id" = 'anon:' || md5(${evt.id}::text || ':' || COALESCE("registration_id"::text, "guest_id", "id"::text))
          WHERE "event_id" = ${evt.id}::uuid
            AND ("registration_id" IS NOT NULL OR "guest_id" NOT LIKE 'anon:%')`;

        // Le risposte di fine evento restano, senza nome ne' hash dell'email;
        // quelle chieste all'iscrizione riguardano chi si e' iscritto, e se
        // ne vanno con lui. Le risposte delle domande si cancellano a cascata.
        const questionnaireResponsesAnonymized = await tx.$executeRaw`
          UPDATE "questionnaire_responses"
          SET "registration_id" = NULL,
              "guest_id" = 'anon:' || md5(${evt.id}::text || ':' || COALESCE("registration_id"::text, "guest_id", "id"::text)),
              "respondent_name" = NULL, "respondent_email_hash" = NULL
          WHERE "questionnaire_id" IN (
            SELECT "id" FROM "event_questionnaires"
            WHERE "event_id" = ${evt.id}::uuid AND "placement" = 'POST_EVENT'
          )
            AND ("registration_id" IS NOT NULL OR "guest_id" NOT LIKE 'anon:%' OR "respondent_name" IS NOT NULL)`;
        const questionnaireResponsesDeleted = await tx.questionnaireResponse.deleteMany({
          where: { questionnaire: { eventId: evt.id, placement: { not: 'POST_EVENT' } } },
        });

        const wcSubmissionsAnonymized = await tx.$executeRaw`
          UPDATE "word_cloud_submissions" SET "registration_id" = NULL,
              "guest_id" = 'anon:' || md5(${evt.id}::text || ':' || COALESCE("registration_id"::text, "guest_id", "id"::text))
          WHERE "round_id" IN (SELECT "id" FROM "word_cloud_rounds" WHERE "event_id" = ${evt.id}::uuid)
            AND ("registration_id" IS NOT NULL OR "guest_id" IS NULL OR "guest_id" NOT LIKE 'anon:%')`;

        const materialsAnonymized = await tx.eventMaterial.updateMany({
          where: { eventId: evt.id, addedBy: { not: '' } },
          data: { addedBy: '' },
        });

        const reminderSentDeleted = await tx.reminderSent.deleteMany({
          where: { reminder: { eventId: evt.id } },
        });

        const remindersDeleted = await tx.eventReminder.deleteMany({
          where: { eventId: evt.id },
        });

        // Le prove del consenso alla registrazione per partecipante date in
        // sala d'attesa: nome cifrato e posto nella conferenza. Quelle legate
        // a un'iscrizione se ne andrebbero con lei per cascata; quelle degli
        // ospiti no, e l'evento non viene cancellato.
        const multitrackConsentsDeleted = await tx.multitrackConsent.deleteMany({
          where: { eventId: evt.id },
        });

        // Lo stesso per le prove del consenso alla registrazione dell'evento
        // date in sala d'attesa da chi non l'aveva dato all'iscrizione.
        const recordingConsentsDeleted = await tx.recordingConsent.deleteMany({
          where: { eventId: evt.id },
        });

        const registrationsDeleted = await tx.registration.deleteMany({
          where: { eventId: evt.id },
        });

        // Chat history: sender names + message bodies are PII, encrypted at
        // rest (encryptPII, AES-256-GCM). The FK is onDelete: Cascade, but the
        // event row stays (with its anonymized content), so the cascade never
        // fires — these must be purged explicitly or the chat would survive
        // past the retention window.
        const chatMessagesDeleted = await tx.chatMessage.deleteMany({
          where: { eventId: evt.id },
        });

        // Live emoji reactions (no PII, but event data past retention). FK is
        // onDelete: Cascade, but the event row stays, so the cascade never
        // fires — purge explicitly, like chat above.
        const reactionsDeleted = await tx.reaction.deleteMany({
          where: { eventId: evt.id },
        });

        // Le reazioni agli argomenti dell'agenda sono di una persona: via.
        // Gli argomenti restano, come la cronologia della sala (nessun nome:
        // titoli, risultati, ore), contenuti dell'evento.
        const agendaReactionsDeleted = await tx.agendaItemReaction.deleteMany({
          where: { agendaItem: { eventId: evt.id } },
        });

        // Inviti: nome, email cifrata, HMAC dell'email e il token del link di
        // registrazione precompilata. Stessa trappola della cascade, e un
        // invito non accettato non ha piu' alcuna ragione di esistere quando
        // l'evento a cui invitava e' scaduto.
        const invitationsDeleted = await tx.eventInvitation.deleteMany({
          where: { eventId: evt.id },
        });

        // Named moderator/speaker grants: `name` and `email` are encrypted PII
        // and `token` is a durable magic-link credential. Same cascade trap as
        // the chat above — the event row survives the cleanup, so nothing else
        // ever removes these. The public programme is unaffected: the speaker
        // list shown on the event page comes from `Event.speakersInfo`, not from
        // these rows. Copies of a recurring event multiply the grants, so a
        // series would otherwise keep one contact's address alive indefinitely.
        const moderatorGrantsDeleted = await tx.eventModerator.deleteMany({
          where: { eventId: evt.id },
        });

        // Per-participant audio track rows (ADR-013). `displayName` is encrypted
        // PII. multitrack-purge already deletes the audio BLOB and stamps
        // audioPurgedAt but never removes the row, so it lingers. Guard on
        // audioPurgedAt: rows whose audio is still present (retained tracks not
        // yet past their own retentionUntil, or a pending ARCHIVE job) are left
        // to the post-production retention (cron/postprod-retention), which
        // removes them with the recording's artifacts — deleting them now would
        // orphan the blob / break the archive. The Recording tree itself is
        // untouched.
        const recordingTracksDeleted = await tx.recordingTrack.deleteMany({
          where: { recording: { eventId: evt.id }, audioPurgedAt: { not: null } },
        });

        // CallSession carries PII in dominantSpeakerLog (encrypted display names)
        // and the participants JSON. We SCRUB rather than delete: a CallSession
        // deletion cascade-kills the whole Recording tree (RecordingTrack /
        // PostprodJob / PostprodArtifact / Speaker), which would violate the AI
        // override retention (Recording.retentionUntil kept as a public record).
        // Scrubbing the two PII JSON columns removes the PII while preserving
        // analytics (peakParticipants, duration) and the postprod graph.
        const callSessionsScrubbed = await tx.callSession.updateMany({
          where: { eventId: evt.id },
          data: { dominantSpeakerLog: [], handRaiseLog: [], participants: [] },
        });

        // Un evento mai concluso (rimasto PUBLISHED o LIVE oltre la fine)
        // lascia il servizio adesso: le sue sessioni di chiamata si chiudono
        // con l'orario stimato sulla fine della sala, non su oggi.
        if (!isFinishedEventStatus(evt.status)) {
          await closeStaleSessions(tx, [evt.id], now, overtimeLimits);
        }

        // Un evento concluso resta com'e': la sua pagina e cio' che mostra
        // li decide chi organizza. Uno mai concluso si archivia.
        if (!isFinishedEventStatus(evt.status)) {
          await tx.event.update({ where: { id: evt.id }, data: { status: 'ARCHIVED' } });
        }

        const counts = {
          upvotes: upvotesDeleted.count,
          guestUpvotes: guestUpvotesDeleted.count,
          questionsAnonymized: questionsAnonymized.count,
          pollVotesAnonymized,
          feedbackAnonymized,
          questionnaireResponsesAnonymized,
          questionnaireResponsesDeleted: questionnaireResponsesDeleted.count,
          wordCloudSubmissionsAnonymized: wcSubmissionsAnonymized,
          materialsAnonymized: materialsAnonymized.count,
          remindersSent: reminderSentDeleted.count,
          reminders: remindersDeleted.count,
          registrations: registrationsDeleted.count,
          multitrackConsents: multitrackConsentsDeleted.count,
          recordingConsents: recordingConsentsDeleted.count,
          chatMessages: chatMessagesDeleted.count,
          reactions: reactionsDeleted.count,
          agendaReactions: agendaReactionsDeleted.count,
          invitations: invitationsDeleted.count,
          moderatorGrants: moderatorGrantsDeleted.count,
          recordingTracks: recordingTracksDeleted.count,
          callSessionsScrubbed: callSessionsScrubbed.count,
        };

        // GDPR audit log — no PII, only counts. Il giro quotidiano ripassa
        // sugli stessi eventi: una riga solo se questo giro ha tolto qualcosa.
        const { callSessionsScrubbed: _sessioni, ...tolti } = counts;
        if (Object.values(tolti).some((n) => n > 0)) {
          await tx.gdprAuditLog.create({
            data: {
              eventId: evt.id,
              action: 'DATA_DELETED',
              recordCount: counts.registrations,
              details: JSON.stringify(counts),
            },
          });
        }

        return counts;
      });

      // Blob deletion (network I/O) AFTER the transaction commits — best-effort.
      // tempRecordingUrl is raw pre-publish Jibri output → always safe to purge.
      if (evt.tempRecordingUrl) {
        const ok = await deleteRecordingBlob(evt.tempRecordingUrl).catch(() => false);
        if (ok) totalRecordingBlobsDeleted++;
      }
      // recordingUrl: EXEMPT the PUBLISHED video only — see
      // shouldPurgeRecordingBlob (lib/gdpr/cleanup-selection.ts) for why.
      if (evt.recordingUrl && shouldPurgeRecordingBlob(evt)) {
        const ok = await deleteRecordingBlob(evt.recordingUrl).catch(() => false);
        if (ok) totalRecordingBlobsDeleted++;
      }
      if (isAzureConfigured()) {
        for (const c of chatAttachmentBlobs) {
          if (c.attachmentBlobPath) {
            const ok = await deleteBlob(c.attachmentBlobPath).catch(() => false);
            if (ok) totalAttachmentBlobsDeleted++;
          }
        }
      }

      console.log(
        `[cron/cleanup] Cleaned event ${evt.id} (${evt.slug}): ` +
          `${result.registrations} registrations, ${result.chatMessages} chat messages, ${result.upvotes} upvotes deleted; ` +
          `${result.questionsAnonymized} questions, ${result.pollVotesAnonymized} poll votes, ${result.materialsAnonymized} materials anonymized`
      );

      totalRegistrationsDeleted += result.registrations;
      totalQuestionsAnonymized += result.questionsAnonymized;
      totalPollVotesAnonymized += result.pollVotesAnonymized;
      eventsProcessed++;
      if (!isFinishedEventStatus(evt.status)) unfinishedArchived++;
    } catch (err) {
      console.error(`[cron/cleanup] Failed to clean event ${evt.id} (${evt.slug}):`, err);
      failures.push(`event:${evt.id}`);
    }
  }

  // ── Link di accesso dello staff (ADR-014) ──
  // Usati o scaduti da oltre un giorno non servono piu' a niente: tenerli
  // sarebbe conservare, senza scopo, lo storico degli accessi di ogni persona.
  // Il giorno di margine lascia leggibile il tentativo appena fallito a chi
  // deve aiutare qualcuno che non riesce a entrare.
  const unGiornoFa = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const staffLinks = await prisma.staffLoginToken.deleteMany({
    where: { OR: [{ usedAt: { lt: unGiornoFa } }, { expiresAt: { lt: unGiornoFa } }] },
  });

  // ── Account dello staff inattivi ──
  // Un account mai piu' usato e' una porta aperta e un dato personale tenuto
  // senza scopo: dopo la soglia si disattiva (resta, e un amministratore puo'
  // riattivarlo). La soglia conta dall'ultimo fra creazione, ultimo accesso e
  // riattivazione. A differenza della disattivazione a mano, i link da
  // moderatore dei suoi eventi non cambiano: chi conduce quegli eventi con il
  // link condiviso non deve perderlo per l'inattivita' di un altro.
  let staffDeactivated = 0;
  const staffDays = staffInactiveDeactivateDays();
  if (staffDays > 0) {
    const staffCutoff = new Date(now.getTime() - staffDays * 86_400_000);
    try {
      staffDeactivated = (
        await prisma.staffAccount.updateMany({
          where: {
            active: true,
            createdAt: { lt: staffCutoff },
            AND: [
              { OR: [{ lastLoginAt: null }, { lastLoginAt: { lt: staffCutoff } }] },
              { OR: [{ reactivatedAt: null }, { reactivatedAt: { lt: staffCutoff } }] },
            ],
          },
          data: { active: false },
        })
      ).count;
    } catch (err) {
      console.error('[cron/cleanup] Failed to deactivate inactive staff accounts:', err);
      failures.push('staff-accounts');
    }
  }

  // ── Foto profilo ──
  // La foto e' legata all'email, non a un evento: resta finche' di
  // quell'email c'e' un'iscrizione (le iscrizioni vanno via con la
  // conservazione dei loro eventi). Senza iscrizioni, e non aggiornata da
  // PROFILE_PHOTO_GRACE_DAYS, si cancella. Una sola istruzione: quante che
  // siano le foto, nessun elenco passa dall'applicazione.
  let profilePhotosDeleted = 0;
  try {
    const limite = new Date(now.getTime() - PROFILE_PHOTO_GRACE_DAYS * 86_400_000);
    profilePhotosDeleted = await prisma.$executeRaw`
      DELETE FROM "profile_photos" p
      WHERE p."updated_at" < ${limite}
        AND NOT EXISTS (SELECT 1 FROM "registrations" r WHERE r."email_hash" = p."email_hash")`;
  } catch (err) {
    console.error('[cron/cleanup] Failed to purge profile photos:', err);
    failures.push('profile-photos');
  }

  // ── Coda delle email ──
  // Una riga inviata o fallita conserva destinatario, testo (con i link
  // personali) e allegato .ics: non serve piu' a nulla dopo la conservazione.
  // Le righe con una chiave di deduplica (il link del moderatore) restano come
  // promemoria di "gia' inviato", svuotate del contenuto: cancellarle farebbe
  // ripartire il link a una pubblicazione successiva.
  const outboxCutoff = new Date(now.getTime() - emailOutboxRetentionDays() * 86_400_000);
  let outboxDeleted = 0;
  let outboxScrubbed = 0;
  try {
    const concluse = {
      status: { in: ['SENT' as const, 'FAILED' as const] },
      updatedAt: { lt: outboxCutoff },
    };
    outboxDeleted = (
      await prisma.emailOutbox.deleteMany({ where: { ...concluse, dedupKey: null } })
    ).count;
    outboxScrubbed = (
      await prisma.emailOutbox.updateMany({
        where: { ...concluse, dedupKey: { not: null }, NOT: { html: '' } },
        data: {
          toAddress: '',
          html: '',
          text: null,
          attachments: Prisma.DbNull,
          lastError: null,
        },
      })
    ).count;
  } catch (err) {
    console.error('[cron/cleanup] Failed to purge the email outbox:', err);
    failures.push('email-outbox');
  }

  // ── Registro audit ──
  // Le righe restano (chi ha fatto cosa, per rendicontare), ma oltre la
  // conservazione perdono IP e user agent, e il dettaglio delle azioni che
  // riportano nomi di persone.
  const auditCutoff = new Date(
    now.getTime() - auditLogPersonalDataRetentionDays() * 86_400_000
  );
  let auditScrubbed = 0;
  try {
    auditScrubbed = (
      await prisma.adminAuditLog.updateMany({
        where: {
          createdAt: { lt: auditCutoff },
          OR: [{ ip: { not: null } }, { userAgent: { not: null } }],
        },
        data: { ip: null, userAgent: null },
      })
    ).count;
    auditScrubbed += (
      await prisma.adminAuditLog.updateMany({
        where: {
          createdAt: { lt: auditCutoff },
          action: { in: [...AUDIT_ACTIONS_WITH_NAMES] },
          details: { not: null },
        },
        data: { details: null },
      })
    ).count;
  } catch (err) {
    console.error('[cron/cleanup] Failed to scrub the audit log:', err);
    failures.push('audit-log');
  }

  // L'impronta dell'indirizzo sulle concessioni nate prima che esistesse:
  // l'export e la cancellazione GDPR in autonomia cercano per impronta.
  let grantFingerprintsFilled = 0;
  try {
    grantFingerprintsFilled = await completaImprontaConcessioni();
  } catch (err) {
    console.error('[cron/cleanup] Failed to fill grant fingerprints:', err);
    failures.push('grant-fingerprints');
  }

  const ok = failures.length === 0;
  return Response.json(
    {
      ok,
      ...(!ok && { failures }),
      grantFingerprintsFilled,
      staffLoginLinksDeleted: staffLinks.count,
      staffAccountsDeactivated: staffDeactivated,
      emailOutboxDeleted: outboxDeleted,
      profilePhotosDeleted,
      emailOutboxScrubbed: outboxScrubbed,
      auditLogRowsScrubbed: auditScrubbed,
      tempRecordingsCleaned: tempRecordingEvents.length,
      publishedRecordingsCleaned: recordingRetentionEvents.filter((evt) =>
        isRecordingRetentionExpired(evt, now)
      ).length,
      eventsProcessed,
      unfinishedEventsArchived: unfinishedArchived,
      registrationsDeleted: totalRegistrationsDeleted,
      questionsAnonymized: totalQuestionsAnonymized,
      pollVotesAnonymized: totalPollVotesAnonymized,
      recordingBlobsDeleted: totalRecordingBlobsDeleted,
      // I file degli allegati della chat: quelli dei materiali restano con
      // l'evento e se ne vanno solo quando lo si cancella.
      chatAttachmentBlobsDeleted: totalAttachmentBlobsDeleted,
    },
    { status: ok ? 200 : 500 }
  );
});
