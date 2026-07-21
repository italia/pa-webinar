import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';

import {
  DUPLICATED_EVENT_FIELDS,
  NOT_DUPLICATED_EVENT_FIELDS,
  duplicatedConfig,
} from './duplicate-fields';

/**
 * The guard the duplicate endpoint never had.
 *
 * Every scalar column of Event must be classified: either inherited by a copy or
 * listed as deliberately excluded, with a reason. Add a column and forget it and
 * this fails — instead of the next duplicated recurring call silently losing it,
 * which is how `multitrackRecordingEnabled`, the AI flags and `recurrenceRule`
 * went missing in the first place.
 */
const eventModel = Prisma.dmmf.datamodel.models.find((m) => m.name === 'Event');

/** Scalar columns only: relations are handled explicitly by the route. */
function eventScalarFields(): string[] {
  if (!eventModel) throw new Error('Event model not found in the Prisma DMMF');
  return eventModel.fields
    .filter((f) => f.kind === 'scalar' || f.kind === 'enum')
    .map((f) => f.name);
}

describe('Event duplication field classification', () => {
  it('finds the Event model in the Prisma schema', () => {
    expect(eventModel).toBeDefined();
    expect(eventScalarFields().length).toBeGreaterThan(50);
  });

  it('classifies EVERY Event column as inherited or deliberately excluded', () => {
    const copied = new Set<string>(DUPLICATED_EVENT_FIELDS);
    const excluded = new Set(Object.keys(NOT_DUPLICATED_EVENT_FIELDS));

    const unclassified = eventScalarFields().filter(
      (f) => !copied.has(f) && !excluded.has(f),
    );

    expect(
      unclassified,
      `New Event column(s) not classified for duplication: ${unclassified.join(', ')}. ` +
        'Add each to DUPLICATED_EVENT_FIELDS, or to NOT_DUPLICATED_EVENT_FIELDS with a reason.',
    ).toEqual([]);
  });

  it('never both copies and excludes the same column', () => {
    const excluded = new Set(Object.keys(NOT_DUPLICATED_EVENT_FIELDS));
    const both = DUPLICATED_EVENT_FIELDS.filter((f) => excluded.has(f));
    expect(both).toEqual([]);
  });

  it('classifies no column that does not exist', () => {
    const real = new Set(eventScalarFields());
    const ghosts = [
      ...DUPLICATED_EVENT_FIELDS,
      ...Object.keys(NOT_DUPLICATED_EVENT_FIELDS),
    ].filter((f) => !real.has(f));
    expect(ghosts, `classified but absent from the schema: ${ghosts.join(', ')}`).toEqual([]);
  });

  it('inherits the capture and AI flags that used to be dropped', () => {
    // The concrete regression: a recurring call duplicated without these came
    // back with no isolated tracks and no transcript.
    for (const flag of [
      'multitrackRecordingEnabled',
      'retainParticipantTracks',
      'aiTranscriptEnabled',
      'aiSummaryEnabled',
      'aiTranslationEnabled',
      'aiDubbingEnabled',
      'aiTargetLocales',
      'expectedSpeakers',
      'agendaEnabled',
      'wordCloudEnabled',
      'autoStartRecording',
      'recurrenceRule',
    ]) {
      expect(DUPLICATED_EVENT_FIELDS, flag).toContain(flag);
    }
  });

  it('never inherits a secret or the runtime state of the occurrence that ran', () => {
    for (const field of [
      'moderatorToken',
      'jitsiRoomName',
      'joinPasswordHash',
      'peakParticipants',
      'lastActiveAt',
      'recordingUrl',
      'postEventRecap',
    ]) {
      expect(Object.keys(NOT_DUPLICATED_EVENT_FIELDS), field).toContain(field);
      expect(DUPLICATED_EVENT_FIELDS as readonly string[], field).not.toContain(field);
    }
  });
});

describe('duplicatedConfig', () => {
  it('copies the classified fields and nothing else', () => {
    const source = {
      multitrackRecordingEnabled: true,
      aiTargetLocales: 'en,fr',
      chatEnabled: true,
      moderatorToken: 'SECRET',
      peakParticipants: 42,
    };
    const out = duplicatedConfig(source);
    expect(out.multitrackRecordingEnabled).toBe(true);
    expect(out.aiTargetLocales).toBe('en,fr');
    expect(out.chatEnabled).toBe(true);
    expect(out).not.toHaveProperty('moderatorToken');
    expect(out).not.toHaveProperty('peakParticipants');
  });

  it('preserves null (an explicit "no value") but skips undefined', () => {
    const out = duplicatedConfig({ gracePeriodMinutes: null, videoQuality: undefined });
    expect(out).toHaveProperty('gracePeriodMinutes', null);
    expect(out).not.toHaveProperty('videoQuality');
  });
});
