import type { Prisma } from '@prisma/client';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import {
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
  AppError,
} from '@/lib/errors';
import { prisma } from '@/lib/db';
import { publishEventStatus, publishFlagsIfChanged } from '@/lib/live-state/publish';
import { reviveStatus } from '@/lib/events/lifecycle';
import { closeOpenSessions } from '@/lib/events/call-sessions';
import { removeFilesOfEventsBeingDeleted } from '@/lib/events/material-files';
import { updateEventSchema } from '@/lib/validation/schemas';
import { resolveLocale, localiseEvent, pruneEmptyTranslations, type LocalizedField } from '@/lib/utils/locale';
import {
  extractModeratorToken,
  verifyModeratorToken,
  isEventModerator,
  constantTimeEqual,
} from '@/lib/auth/moderator';
import { sendDateChangeNotifications } from '@/lib/email/notification';
import { adminRequestLocale, sendPrimaryModeratorLink } from '@/lib/email/moderator-link';
import { getSettings } from '@/lib/settings';
import { encryptPIIOrNull, tryDecryptPII } from '@/lib/crypto/pii';
import { calculateEstimates } from '@/lib/estimates';
import { hashJoinPassword } from '@/lib/auth/password';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { coerceMatrix, togglesFromMatrix } from '@/lib/utils/permission-matrix';

export const dynamic = 'force-dynamic';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── GET /api/events/[slug|id] — Event detail ────────────────

export const GET = withErrorHandling(async (request, context) => {
  const { param } = await context.params;
  const locale = resolveLocale(request);
  const token = extractModeratorToken(request);
  const isUuid = UUID_RE.test(param);

  const event = await prisma.event.findUnique({
    where: isUuid ? { id: param } : { slug: param },
    include: {
      _count: { select: { registrations: true } },
      registrations: token
        ? {
            select: {
              id: true,
              displayName: true,
              joinedAt: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
          }
        : false,
    },
  });

  if (!event) throw new NotFoundError('Event');

  const { title, description } = localiseEvent(event, locale);

  // Moderator mode: verify token and return full data. Accetta anche i
  // co-moderatori (EventModerator role=MODERATOR): PUT/DELETE già li ammettono
  // via verifyModeratorToken, quindi negargli la vista sarebbe incoerente.
  // I campi del SOLO primario (magic link irrevocabile + email owner) però
  // non escono mai verso un co-moderatore: un co-mod col token primario
  // scalerebbe a owner in modo che la revoca non può più recuperare.
  const isPrimaryModerator =
    !!token && constantTimeEqual(event.moderatorToken, token);
  if (token && (isPrimaryModerator || (await isEventModerator(event, token)))) {
    return Response.json({
      id: event.id,
      slug: event.slug,
      title,
      titleAll: event.title,
      description,
      descriptionAll: event.description,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt.toISOString(),
      timezone: event.timezone,
      maxParticipants: event.maxParticipants,
      registrationCount: event._count.registrations,
      qaEnabled: event.qaEnabled,
      chatEnabled: event.chatEnabled,
      recordingEnabled: event.recordingEnabled,
      autoStartRecording: event.autoStartRecording,
      participantsCanUnmute: event.participantsCanUnmute,
      participantsCanStartVideo: event.participantsCanStartVideo,
      participantsCanShareScreen: event.participantsCanShareScreen,
      status: event.status,
      recordingUrl: event.recordingUrl,
      tempRecordingUrl: event.tempRecordingUrl,
      tempRecordingStartedAt: event.tempRecordingStartedAt?.toISOString() ?? null,
      recordingPublished: event.recordingPublished,
      recordingPublishedAt: event.recordingPublishedAt?.toISOString() ?? null,
      recordingFileSize: event.recordingFileSize ? Number(event.recordingFileSize) : null,
      recordingDuration: event.recordingDuration,
      recordingDeleteAfterDays: event.recordingDeleteAfterDays,
      postEventPublic: event.postEventPublic,
      postEventPublicUntil: event.postEventPublicUntil?.toISOString() ?? null,
      postEventShowQA: event.postEventShowQA,
      postEventShowMaterials: event.postEventShowMaterials,
      postEventShowPolls: event.postEventShowPolls,
      postEventShowFeedback: event.postEventShowFeedback,
      postEventShowRecap: event.postEventShowRecap,
    postEventShowWordCloud: event.postEventShowWordCloud,
      postEventEmailEnabled: event.postEventEmailEnabled,
      feedbackEnabled: event.feedbackEnabled,
      recordingConsentText: event.recordingConsentText,
      // Al co-moderatore torna il SUO token (valido su tutte le route che
      // già lo ammettono), mai quello del primario.
      moderatorToken: isPrimaryModerator ? event.moderatorToken : token,
      moderatorName: event.moderatorName,
      moderatorEmail: isPrimaryModerator
        ? tryDecryptPII(event.moderatorEmail)
        : null,
      jitsiRoomName: event.jitsiRoomName,
      dataRetentionDays: event.dataRetentionDays,
      privacyPolicyUrl: event.privacyPolicyUrl,
      speakersInfo: event.speakersInfo,
      organizerName: event.organizerName,
      imageUrl: event.imageUrl,
      waitingRoomAudioUrl: event.waitingRoomAudioUrl,
      createdAt: event.createdAt.toISOString(),
      registrations: event.registrations
        ? event.registrations.map((r) => ({
            id: r.id,
            displayName: tryDecryptPII(r.displayName) ?? r.displayName,
            joinedAt: r.joinedAt,
            createdAt: r.createdAt,
          }))
        : event.registrations,
    });
  }

  // Public mode — hide DRAFT and ARCHIVED events
  if (event.status === 'DRAFT' || event.status === 'ARCHIVED') {
    throw new NotFoundError('Event');
  }

  return Response.json({
    id: event.id,
    slug: event.slug,
    title,
    description,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    timezone: event.timezone,
    maxParticipants: event.maxParticipants,
    registrationCount: event._count.registrations,
    qaEnabled: event.qaEnabled,
    chatEnabled: event.chatEnabled,
    recordingEnabled: event.recordingEnabled,
    autoStartRecording: event.autoStartRecording,
    participantsCanUnmute: event.participantsCanUnmute,
    participantsCanStartVideo: event.participantsCanStartVideo,
    participantsCanShareScreen: event.participantsCanShareScreen,
    status: event.status,
    recordingUrl: event.recordingPublished ? event.recordingUrl : null,
    tempRecordingUrl: event.status === 'LIVE' ? event.tempRecordingUrl : null,
    tempRecordingStartedAt: event.status === 'LIVE' ? event.tempRecordingStartedAt?.toISOString() ?? null : null,
    postEventPublic: event.postEventPublic,
    postEventShowQA: event.postEventShowQA,
    postEventShowMaterials: event.postEventShowMaterials,
    postEventShowPolls: event.postEventShowPolls,
    postEventShowFeedback: event.postEventShowFeedback,
    postEventShowRecap: event.postEventShowRecap,
    postEventShowWordCloud: event.postEventShowWordCloud,
    postEventEmailEnabled: event.postEventEmailEnabled,
  }, {
    headers: {
      'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
    },
  });
});

// ── PUT /api/events/[id] — Update event (moderator only) ────

export const PUT = withErrorHandling(async (request, context) => {
  const { param: eventId } = await context.params;

  if (!UUID_RE.test(eventId)) {
    throw new AppError('Event ID must be a UUID', 400, 'BAD_REQUEST');
  }

  const token = extractModeratorToken(request);
  if (!token) throw new UnauthorizedError('Moderator token required');

  const event = await verifyModeratorToken(eventId, token);
  if (!event) throw new ForbiddenError('Invalid moderator token or event not found');

  const body = await parseJsonBody(request);
  const parsed = updateEventSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Validation failed', parsed.error.issues.map((i) => ({ path: i.path, message: i.message })));
  }

  const data = parsed.data;

  // L'indirizzo del moderatore principale lo cambia solo il principale: a quel
  // cambio parte l'email con il suo link, che non scade e non si revoca. Un
  // co-moderatore potrebbe altrimenti farselo spedire a un indirizzo suo e
  // restare gestore dopo la revoca. Il wizard di un co-moderatore rimanda il
  // campo vuoto (la GET non glielo mostra): si ignora, non si rifiuta.
  const isPrimaryModerator = constantTimeEqual(event.moderatorToken, token);
  if (!isPrimaryModerator) {
    delete (data as Record<string, unknown>).moderatorEmail;
  }

  // Il modello dell'informativa è una chiave esterna: un id inesistente
  // farebbe fallire la scrittura con un codice non mappato, cioè con un 500
  // al posto di un errore sul campo.
  if (data.gdprTemplateId) {
    const modello = await prisma.gdprTemplate.findUnique({
      where: { id: data.gdprTemplateId },
      select: { id: true },
    });
    if (!modello) {
      throw new ValidationError('Validation failed', [
        { path: ['gdprTemplateId'], message: 'Unknown GDPR template' },
      ]);
    }
  }

  // Guard against the illusion of post-event configurability. These flags govern
  // LIVE capture — once an event is ENDED/ARCHIVED nothing can be captured
  // retroactively, so writing them does nothing but mislead. Strip them from a
  // pure post-event edit (one that isn't reviving the event via a lifecycle
  // change) and report them back so the UI can warn. NOTE: AI flags
  // (aiTranscript/Summary/Translation/Dubbing), recordingPublished and the
  // postEvent* display toggles are deliberately NOT here — those ARE legitimate
  // post-event controls (jobs run on the already-stored recording).
  // NB: retainParticipantTracks is intentionally NOT here. Despite being a
  // capture-adjacent flag, it's read LIVE by cron/multitrack-purge to decide
  // whether per-participant audio is purged right after transcription (false)
  // or held until retention (true) — so an admin must stay able to flip it to
  // false on an ENDED event to force a GDPR minimization. Stripping it would
  // make already-captured PII *harder* to delete.
  const CREATION_ONLY_FIELDS = [
    'recordingEnabled',
    'autoStartRecording',
    'whiteboardEnabled',
    'multitrackRecordingEnabled',
    'waitingRoomEngine',
    'videoQuality',
  ] as const;
  const isTerminalStatus = event.status === 'ENDED' || event.status === 'ARCHIVED';
  // A lifecycle edit (revive: pushing endsAt/startsAt to the future, or an
  // explicit status change) legitimately brings the event back to life, so the
  // capture flags matter again — don't strip in that case.
  const isLifecycleEdit =
    data.status !== undefined ||
    data.endsAt !== undefined ||
    data.startsAt !== undefined;
  const ignoredCreationOnlyFields: string[] = [];
  if (isTerminalStatus && !isLifecycleEdit) {
    for (const field of CREATION_ONLY_FIELDS) {
      if (data[field] !== undefined) {
        ignoredCreationOnlyFields.push(field);
        delete (data as Record<string, unknown>)[field];
      }
    }
  }

  const dateChanged =
    (data.startsAt !== undefined && new Date(data.startsAt).getTime() !== event.startsAt.getTime()) ||
    (data.endsAt !== undefined && new Date(data.endsAt).getTime() !== event.endsAt.getTime());

  // Recompute the capacity estimate snapshot when any input that feeds
  // into it changed. Skipped if none of these fields were touched — we
  // don't want an idempotent update (e.g. toggling only `status`) to
  // rewrite the pre-event estimate that autoscalers already read.
  const capacityInputsTouched =
    data.maxParticipants !== undefined ||
    data.startsAt !== undefined ||
    data.endsAt !== undefined ||
    data.recordingEnabled !== undefined ||
    data.participantsCanUnmute !== undefined ||
    data.participantsCanStartVideo !== undefined ||
    data.participantsCanShareScreen !== undefined;

  const nextCapacityEstimate = capacityInputsTouched
    ? {
        ...calculateEstimates({
          maxParticipants: data.maxParticipants ?? event.maxParticipants,
          startsAt:
            data.startsAt ?? event.startsAt.toISOString(),
          endsAt: data.endsAt ?? event.endsAt.toISOString(),
          recordingEnabled:
            data.recordingEnabled ?? event.recordingEnabled,
          participantsCanUnmute:
            data.participantsCanUnmute ?? event.participantsCanUnmute,
          participantsCanStartVideo:
            data.participantsCanStartVideo ?? event.participantsCanStartVideo,
          participantsCanShareScreen:
            data.participantsCanShareScreen ?? event.participantsCanShareScreen,
        }),
        computedAt: new Date().toISOString(),
      }
    : undefined;

  // Reviving an ENDED event: if the moderator pushes endsAt into the
  // future we flip the status back to PUBLISHED or LIVE instead of
  // leaving the row stuck in ENDED. Without this the call happens to
  // be terminated permanently from a single timing mistake — which
  // is what happened on a dry-run before a real event.
  const revivedStatus = reviveStatus({
    currentStatus: event.status,
    currentStartsAt: event.startsAt,
    newEndsAt: data.endsAt !== undefined ? new Date(data.endsAt) : undefined,
    newStartsAt: data.startsAt !== undefined ? new Date(data.startsAt) : undefined,
    statusExplicitlySet: data.status !== undefined,
    now: new Date(),
  });

  // Permission matrix (mirrors the POST/create path): when the client sends a
  // matrix, it is the source of truth — persist it AND re-derive the legacy
  // boolean toggles from it so the two representations never drift. When no
  // matrix is sent, fall back to whatever individual booleans the caller
  // supplied (partial updates from non-wizard callers keep working).
  const matrixUpdate = data.permissionMatrix ? coerceMatrix(data.permissionMatrix) : null;
  const avToggles = matrixUpdate
    ? togglesFromMatrix(matrixUpdate)
    : {
        qaEnabled: data.qaEnabled,
        chatEnabled: data.chatEnabled,
        participantsCanUnmute: data.participantsCanUnmute,
        participantsCanStartVideo: data.participantsCanStartVideo,
        participantsCanShareScreen: data.participantsCanShareScreen,
      };

  const updateArgs = {
    where: { id: eventId },
    data: {
      ...(revivedStatus && { status: revivedStatus }),
      ...(matrixUpdate && { permissionMatrix: matrixUpdate }),
      ...(data.title !== undefined && {
        title: pruneEmptyTranslations(data.title as LocalizedField),
      }),
      ...(data.description !== undefined && {
        description: pruneEmptyTranslations(data.description as LocalizedField),
      }),
      ...(data.startsAt !== undefined && {
        startsAt: new Date(data.startsAt),
      }),
      ...(data.endsAt !== undefined && { endsAt: new Date(data.endsAt) }),
      ...(data.expectedSenderRatioPct !== undefined && {
        expectedSenderRatioPct: data.expectedSenderRatioPct,
      }),
      ...(data.gracePeriodMinutes !== undefined && {
        gracePeriodMinutes: data.gracePeriodMinutes,
      }),
      ...(data.timezone !== undefined && { timezone: data.timezone }),
      ...(data.maxParticipants !== undefined && {
        maxParticipants: data.maxParticipants,
      }),
      ...(avToggles.qaEnabled !== undefined && { qaEnabled: avToggles.qaEnabled }),
      ...(avToggles.chatEnabled !== undefined && {
        chatEnabled: avToggles.chatEnabled,
      }),
      ...(data.recordingEnabled !== undefined && {
        recordingEnabled: data.recordingEnabled,
      }),
      ...(data.autoStartRecording !== undefined && {
        autoStartRecording: data.autoStartRecording,
      }),
      ...(avToggles.participantsCanUnmute !== undefined && {
        participantsCanUnmute: avToggles.participantsCanUnmute,
      }),
      ...(avToggles.participantsCanStartVideo !== undefined && {
        participantsCanStartVideo: avToggles.participantsCanStartVideo,
      }),
      ...(avToggles.participantsCanShareScreen !== undefined && {
        participantsCanShareScreen: avToggles.participantsCanShareScreen,
      }),
      ...(data.dataRetentionDays !== undefined && {
        dataRetentionDays: data.dataRetentionDays,
      }),
      ...(data.privacyPolicyUrl !== undefined && {
        privacyPolicyUrl: data.privacyPolicyUrl,
      }),
      // Accettati dallo schema e inviati dai moduli, ma finora mai scritti in
      // modifica. Lo spread condizionato è obbligatorio: le modifiche parziali
      // — un cambio di stato dalla sala, un flag di fine evento — non devono
      // toccare campi che non hanno inviato.
      ...(data.privacyPolicyText !== undefined && {
        privacyPolicyText: data.privacyPolicyText,
      }),
      ...(data.gdprTemplateId !== undefined && {
        gdprTemplateId: data.gdprTemplateId,
      }),
      ...(data.requireOrganization !== undefined && {
        requireOrganization: data.requireOrganization,
      }),
      ...(data.requireOrganizationRole !== undefined && {
        requireOrganizationRole: data.requireOrganizationRole,
      }),
      ...(data.requireOrganizationType !== undefined && {
        requireOrganizationType: data.requireOrganizationType,
      }),
      ...(data.moderatorName !== undefined && {
        moderatorName: data.moderatorName,
      }),
      ...(data.moderatorEmail !== undefined && {
        moderatorEmail: encryptPIIOrNull(data.moderatorEmail),
      }),
      ...(data.speakersInfo !== undefined && { speakersInfo: data.speakersInfo }),
      ...(data.organizerName !== undefined && { organizerName: data.organizerName }),
      ...(data.imageUrl !== undefined && { imageUrl: data.imageUrl }),
      ...(data.waitingRoomAudioUrl !== undefined && { waitingRoomAudioUrl: data.waitingRoomAudioUrl }),
      ...(data.postEventPublic !== undefined && { postEventPublic: data.postEventPublic }),
      ...(data.postEventPublicUntil !== undefined && { postEventPublicUntil: data.postEventPublicUntil ? new Date(data.postEventPublicUntil) : null }),
      ...(data.postEventShowQA !== undefined && { postEventShowQA: data.postEventShowQA }),
      ...(data.postEventShowMaterials !== undefined && { postEventShowMaterials: data.postEventShowMaterials }),
      ...(data.postEventShowPolls !== undefined && { postEventShowPolls: data.postEventShowPolls }),
      ...(data.postEventShowFeedback !== undefined && { postEventShowFeedback: data.postEventShowFeedback }),
      ...(data.postEventShowRecap !== undefined && { postEventShowRecap: data.postEventShowRecap }),
      ...(data.postEventShowWordCloud !== undefined && { postEventShowWordCloud: data.postEventShowWordCloud }),
      ...(data.postEventEmailEnabled !== undefined && { postEventEmailEnabled: data.postEventEmailEnabled }),
      ...(data.feedbackEnabled !== undefined && { feedbackEnabled: data.feedbackEnabled }),
      ...(data.recordingConsentText !== undefined && { recordingConsentText: data.recordingConsentText }),
      ...(data.recordingPublished !== undefined && {
        recordingPublished: data.recordingPublished,
        ...(data.recordingPublished ? { recordingPublishedAt: new Date() } : { recordingPublishedAt: null }),
      }),
      ...(data.recordingDeleteAfterDays !== undefined && { recordingDeleteAfterDays: data.recordingDeleteAfterDays }),
      ...(data.recordingUrl !== undefined && { recordingUrl: data.recordingUrl }),
      ...(data.tempRecordingUrl !== undefined && { tempRecordingUrl: data.tempRecordingUrl }),
      ...(data.recordingFileSize !== undefined && { recordingFileSize: data.recordingFileSize }),
      ...(data.recordingDuration !== undefined && { recordingDuration: data.recordingDuration }),
      ...(data.status !== undefined && { status: data.status }),
      ...(nextCapacityEstimate !== undefined && {
        capacityEstimateJson: nextCapacityEstimate,
      }),
      ...(data.joinPassword !== undefined && {
        joinPasswordHash:
          data.joinPassword.length > 0 ? hashJoinPassword(data.joinPassword) : null,
      }),
      ...(data.youtubeUrl !== undefined && { youtubeUrl: data.youtubeUrl }),
      // The wizard sends the cadence back on every save: without this line the
      // schema accepts it and the update drops it, so editing an event silently
      // wipes its recurrence (docs/architecture/event-journey.md, "Recurrence").
      ...(data.recurrenceRule !== undefined && { recurrenceRule: data.recurrenceRule }),
      ...(data.libraryListed !== undefined && { libraryListed: data.libraryListed }),
      ...(data.coverImageUrl !== undefined && { coverImageUrl: data.coverImageUrl }),
      ...(data.parseTitleKicker !== undefined && {
        parseTitleKicker: data.parseTitleKicker,
      }),
      ...(data.waitingRoomEngine !== undefined && {
        waitingRoomEngine: data.waitingRoomEngine,
      }),
      ...(data.videoQuality !== undefined && {
        videoQuality: data.videoQuality,
      }),
      ...(data.aiTranscriptEnabled !== undefined && {
        aiTranscriptEnabled: data.aiTranscriptEnabled,
      }),
      ...(data.aiSummaryEnabled !== undefined && {
        aiSummaryEnabled: data.aiSummaryEnabled,
      }),
      ...(data.aiTranslationEnabled !== undefined && {
        aiTranslationEnabled: data.aiTranslationEnabled,
      }),
      ...(data.aiDubbingEnabled !== undefined && {
        aiDubbingEnabled: data.aiDubbingEnabled,
      }),
      ...(data.multitrackRecordingEnabled !== undefined && {
        multitrackRecordingEnabled: data.multitrackRecordingEnabled,
      }),
      ...(data.retainParticipantTracks !== undefined && {
        retainParticipantTracks: data.retainParticipantTracks,
      }),
      ...(data.agendaEnabled !== undefined && {
        agendaEnabled: data.agendaEnabled,
      }),
      ...(data.wordCloudEnabled !== undefined && {
        wordCloudEnabled: data.wordCloudEnabled,
      }),
      ...(data.whiteboardEnabled !== undefined && {
        whiteboardEnabled: data.whiteboardEnabled,
      }),
      ...(data.aiTargetLocales !== undefined && {
        aiTargetLocales: data.aiTargetLocales,
      }),
      ...(data.expectedSpeakers !== undefined && {
        expectedSpeakers: data.expectedSpeakers,
      }),
    },
  } satisfies Prisma.EventUpdateArgs;

  // Un evento che lascia LIVE, o che passa da in servizio a concluso o
  // archiviato, chiude le sessioni di chiamata ancora aperte nella stessa
  // transazione del cambio di stato: è così che finisce di solito un evento
  // («Termina per tutti»), e senza questo la sessione resterebbe aperta per
  // sempre e le statistiche riporterebbero la finestra programmata al posto
  // della durata vera. Da ENDED ad ARCHIVED non si chiude «adesso»: le
  // sessioni rimaste aperte su un evento già concluso le ripara il giro del
  // ciclo di vita, con un orario stimato sulla chiusura (lib/events/call-sessions).
  const nextStatus = data.status ?? revivedStatus ?? event.status;
  const closesSessions =
    nextStatus !== event.status &&
    (event.status === 'LIVE' ||
      (!isTerminalStatus && (nextStatus === 'ENDED' || nextStatus === 'ARCHIVED')));
  const updated = closesSessions
    ? await prisma.$transaction(async (tx) => {
        const aggiornato = await tx.event.update(updateArgs);
        await closeOpenSessions(tx, [eventId], new Date());
        return aggiornato;
      })
    : await prisma.event.update(updateArgs);

  if (dateChanged && event.status === 'PUBLISHED') {
    // Ogni iscritto riceve l'avviso nella lingua in cui si e' iscritto.
    sendDateChangeNotifications({ eventId });
  }

  // Il link personale del moderatore principale: alla pubblicazione, o quando
  // cambia l'indirizzo. Una volta sola per indirizzo (vedi moderator-link):
  // ripubblicare o risalvare dal wizard non rispedisce.
  const moderatorEmailChanged =
    data.moderatorEmail !== undefined &&
    (data.moderatorEmail || null) !== (tryDecryptPII(event.moderatorEmail) || null);
  if (
    (updated.status === 'PUBLISHED' && event.status !== 'PUBLISHED') ||
    moderatorEmailChanged
  ) {
    const { defaultLocale: predefinita } = await getSettings();
    await sendPrimaryModeratorLink(eventId, {
      locale: adminRequestLocale(request, predefinita),
    });
  }

  // Chi è in sala vede subito una funzione accesa o spenta, senza aspettare il
  // prossimo giro di interrogazione. Solo a flag realmente cambiati: questa
  // rotta riceve anche i salvataggi del wizard, che rispedisce tutti i campi.
  publishFlagsIfChanged(eventId, event, updated);
  if (updated.status !== event.status) {
    publishEventStatus(eventId, updated.status);
  }

  await logAdminAction({
    request,
    action: 'EVENT_UPDATE',
    target: eventId,
    details: { fields: Object.keys(data), dateChanged },
  });

  return Response.json({
    ...updated,
    dateChanged,
    ...(ignoredCreationOnlyFields.length > 0 && { ignoredCreationOnlyFields }),
  });
});

// ── DELETE /api/events/[id] — Delete event (moderator only) ──

export const DELETE = withErrorHandling(async (request, context) => {
  const { param: eventId } = await context.params;

  if (!UUID_RE.test(eventId)) {
    throw new AppError('Event ID must be a UUID', 400, 'BAD_REQUEST');
  }

  const token = extractModeratorToken(request);
  if (!token) throw new UnauthorizedError('Moderator token required');

  const event = await verifyModeratorToken(eventId, token);
  if (!event) throw new ForbiddenError('Invalid moderator token or event not found');

  // I file dell'evento (materiali caricati, allegati di chat) se ne vanno
  // prima: la cascata porta via le righe, e dopo nessuno saprebbe più quali
  // blob cancellare. Se lo storage non risponde l'evento resta (503).
  await removeFilesOfEventsBeingDeleted({ id: eventId });
  await prisma.event.delete({ where: { id: eventId } });

  await logAdminAction({
    request,
    action: 'EVENT_DELETE',
    target: eventId,
    details: { slug: event.slug },
  });

  return Response.json({ deleted: true, id: eventId });
});
