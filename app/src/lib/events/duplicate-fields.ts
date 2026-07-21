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
  'postEventShowQA',
  'postEventShowMaterials',
  'postEventShowPolls',
  'postEventShowFeedback',
  'postEventShowRecap',
  'postEventShowWordCloud',
  'postEventEmailEnabled',
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
  youtubeUrl:
    'the published video of the occurrence that ran — inheriting it would show ' +
    'last month\'s recording under this month\'s event, in the library too',
  postEventPublicUntil:
    'an absolute deadline set for the previous occurrence, normally already past ' +
    '— inheriting it would make the copy\'s post-event page 404 the moment it ends',
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

/**
 * Json columns among the inherited fields. Prisma refuses a literal `null` for a
 * nullable Json input (`NullableJsonNullValueInput | InputJsonValue`), so a
 * source row with no permission matrix — every event created before that feature
 * and every instant call — would make `create` throw. Omitting the key instead
 * lets the column default to NULL, which is the same end state.
 */
const JSON_FIELDS = new Set<string>(['description', 'speakersInfo', 'permissionMatrix']);

/** Build the inherited slice of the create payload. */
export function duplicatedConfig<T extends Record<string, unknown>>(
  source: T,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of DUPLICATED_EVENT_FIELDS) {
    const value = source[field];
    if (value === undefined) continue;
    if (value === null && JSON_FIELDS.has(field)) continue;
    out[field] = value;
  }
  return out;
}
