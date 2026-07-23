import { describe, expect, it } from 'vitest';

import {
  EVENT_FEATURES,
  coerceMatrix,
  defaultMatrix,
  matrixFromToggles,
  togglesFromMatrix,
  withModeratorInvariant,
} from './permission-matrix';

describe('permission-matrix', () => {
  it('default matrix grants MODERATOR everything', () => {
    const m = defaultMatrix();
    for (const f of EVENT_FEATURES) expect(m[f]).toContain('MODERATOR');
  });

  it('defaults: guests see chat, not Q&A/mic/video/share/rec', () => {
    // Chat is the primary channel (live feedback #10): a blank event defaults
    // to chat-on / Q&A-off for guests.
    const m = defaultMatrix();
    expect(m.chat).toContain('GUEST');
    expect(m.qa).not.toContain('GUEST');
    expect(m.mic).not.toContain('GUEST');
    expect(m.video).not.toContain('GUEST');
    expect(m.share).not.toContain('GUEST');
    expect(m.recording_control).not.toContain('GUEST');
  });

  it('withModeratorInvariant clamps even if caller omits MODERATOR', () => {
    const clamped = withModeratorInvariant({
      qa: ['GUEST'],
      chat: [],
      mic: [],
      video: [],
      share: [],
      recording_control: [],
    });
    for (const f of EVENT_FEATURES) expect(clamped[f]).toContain('MODERATOR');
  });

  it('matrixFromToggles reflects chat-on + mic-on', () => {
    const m = matrixFromToggles({
      qaEnabled: true,
      chatEnabled: true,
      participantsCanUnmute: true,
      participantsCanStartVideo: false,
      participantsCanShareScreen: false,
    });
    expect(m.chat).toContain('GUEST');
    expect(m.mic).toContain('GUEST');
    expect(m.video).not.toContain('GUEST');
    expect(m.share).not.toContain('GUEST');
  });

  it('togglesFromMatrix projects back correctly', () => {
    const m = matrixFromToggles({
      qaEnabled: false,
      chatEnabled: true,
      participantsCanUnmute: false,
      participantsCanStartVideo: true,
      participantsCanShareScreen: false,
    });
    const t = togglesFromMatrix(m);
    expect(t).toEqual({
      qaEnabled: false,
      chatEnabled: true,
      participantsCanUnmute: false,
      participantsCanStartVideo: true,
      participantsCanShareScreen: false,
    });
  });

  it('coerceMatrix returns null for bogus input', () => {
    expect(coerceMatrix(null)).toBeNull();
    expect(coerceMatrix('nope')).toBeNull();
    expect(coerceMatrix(42)).toBeNull();
    expect(coerceMatrix([])).toBeNull();
  });

  it('coerceMatrix drops unknown roles but keeps valid ones + enforces MODERATOR', () => {
    const m = coerceMatrix({
      qa: ['GUEST', 'HACKER', 'SPEAKER'],
      chat: ['GUEST'],
      mic: [],
      video: [],
      share: [],
      recording_control: [],
    });
    expect(m).not.toBeNull();
    expect(m!.qa).toEqual(expect.arrayContaining(['GUEST', 'SPEAKER', 'MODERATOR']));
    expect(m!.qa).not.toContain('HACKER');
    for (const f of EVENT_FEATURES) expect(m![f]).toContain('MODERATOR');
  });

  it('coerceMatrix fills missing features with MODERATOR-only', () => {
    const m = coerceMatrix({ qa: ['GUEST', 'SPEAKER'] });
    expect(m).not.toBeNull();
    expect(m!.qa).toContain('GUEST');
    expect(m!.chat).toEqual(['MODERATOR']);
    expect(m!.recording_control).toEqual(['MODERATOR']);
  });
});
