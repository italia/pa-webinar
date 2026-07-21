/**
 * Which Event columns a duplicate inherits, and which it deliberately does not.
 *
 * WHY A LIST AND NOT AN INLINE OBJECT: the duplicate route used to enumerate the
 * copied fields by hand, and every feature added afterwards was simply forgotten
 * — `multitrackRecordingEnabled`, `retainParticipantTracks`, the four AI flags,
 * `aiTargetLocales`, `expectedSpeakers`, `agendaEnabled`, `wordCloudEnabled`,
 * `autoStartRecording`, `videoQuality`, `recurrenceRule`. For the recurring calls
 * this endpoint exists for (Caffettino, DevIt sync) that silent loss surfaces
 * only after the event: no isolated audio tracks, no transcript, no summary.
 *
 * Splitting the model into these two exhaustive lists lets a test assert, against
 * Prisma's own schema, that EVERY scalar column is classified. Add a column and
 * forget it here and the suite fails, instead of the next duplicated event
 * quietly losing it. See docs/ROADMAP.md, "Eventi ricorrenti / serie".
 */

/** Columns copied verbatim from the source event. */
export const DUPLICATED_EVENT_FIELDS = [
  // content & schedule (dates may be overridden by the caller)
  'description',
  'timezone',
  'eventType',

  // capacity & sizing
  'maxParticipants',
  'expectedSenderRatioPct',
  'expectedSpeakers',
  'gracePeriodMinutes',
  'videoQuality',

  // live features
  'qaEnabled',
  'chatEnabled',
  'whiteboardEnabled',
  'wordCloudEnabled',
  'agendaEnabled',
  'feedbackEnabled',
  'waitingRoomEngine',
  'waitingRoomAudioUrl',

  // permissions
  'participantsCanUnmute',
  'participantsCanStartVideo',
  'participantsCanShareScreen',
  'permissionMatrix',

  // registration rules
  'requireOrganization',
  'requireOrganizationRole',
  'requireOrganizationType',

  // people & branding
  'moderatorName',
  'moderatorEmail',
  'organizerName',
  'speakersInfo',
  'imageUrl',
  'coverImageUrl',
  'parseTitleKicker',

  // privacy & retention
  'dataRetentionDays',
  'privacyPolicyUrl',
  'privacyPolicyText',
  'gdprTemplateId',
  'recordingConsentText',

  // recording & AI post-production
  'recordingEnabled',
  'autoStartRecording',
  'multitrackRecordingEnabled',
  'retainParticipantTracks',
  'recordingDeleteAfterDays',
  'aiTranscriptEnabled',
  'aiSummaryEnabled',
  'aiTranslationEnabled',
  'aiDubbingEnabled',
  'aiTargetLocales',

  // post-event page
  'postEventPublic',
  'postEventPublicUntil',
  'postEventShowQA',
  'postEventShowMaterials',
  'postEventShowPolls',
  'postEventShowFeedback',
  'postEventShowRecap',
  'postEventShowWordCloud',
  'postEventEmailEnabled',
  'youtubeUrl',
  'libraryListed',

  // series
  'recurrenceRule',
] as const;

/** Columns a duplicate must NOT inherit, each with the reason it is excluded. */
export const NOT_DUPLICATED_EVENT_FIELDS: Record<string, string> = {
  id: 'new row',
  createdAt: 'new row',
  updatedAt: 'new row',
  slug: 'derived from the "(copia)" title, must stay unique',
  title: 'suffixed with "(copia)" so the copy is distinguishable',
  startsAt: 'set by the caller (explicit date or projected occurrence)',
  endsAt: 'set by the caller (explicit date or projected occurrence)',
  status: 'a copy always starts as DRAFT',
  moderatorToken: 'a fresh secret — reusing it would grant the old link control of the new room',
  jitsiRoomName: 'a fresh room — reusing it would drop the copy into the old conference',
  joinPasswordHash: 'a secret the operator cannot read back, so it cannot be knowingly inherited',
  recurrenceSeriesId: 'series membership is assigned deliberately, not inherited (v0.9)',
  lastActiveAt: 'runtime state of the occurrence that ran',
  provisioningStartedAt: 'runtime state of the occurrence that ran',
  peakParticipants: 'analytics of the occurrence that ran',
  capacityEstimateJson: 'recomputed from the new schedule',
  recordingUrl: 'artefact of the occurrence that ran',
  recordingPublished: 'artefact of the occurrence that ran',
  recordingPublishedAt: 'artefact of the occurrence that ran',
  recordingDuration: 'artefact of the occurrence that ran',
  recordingFileSize: 'artefact of the occurrence that ran',
  tempRecordingUrl: 'artefact of the occurrence that ran',
  tempRecordingStartedAt: 'artefact of the occurrence that ran',
  postEventRecap: 'generated from the occurrence that ran',
  postEventRecapAt: 'generated from the occurrence that ran',
  postEventEmailSentAt: 'send state of the occurrence that ran',
};

/** Build the inherited slice of the create payload. */
export function duplicatedConfig<T extends Record<string, unknown>>(
  source: T,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of DUPLICATED_EVENT_FIELDS) {
    const value = source[field];
    if (value !== undefined) out[field] = value;
  }
  return out;
}
