import { describe, expect, it } from 'vitest';

import { parseJvbSnapshot } from './jvb-snapshot';

describe('parseJvbSnapshot', () => {
  it('returns null for null / invalid JSON / missing required fields', () => {
    expect(parseJvbSnapshot(null)).toBeNull();
    expect(parseJvbSnapshot('not json')).toBeNull();
    expect(parseJvbSnapshot('{}')).toBeNull();
    expect(parseJvbSnapshot('{"current":1,"ready":1,"desired":1}')).toBeNull();
  });

  it('parses a minimal pre-aggregation snapshot (older scaler image)', () => {
    const raw = JSON.stringify({
      current: 2,
      ready: 2,
      desired: 3,
      checkedAt: '2026-04-22T20:00:00.000Z',
    });
    const parsed = parseJvbSnapshot(raw);
    expect(parsed).toMatchObject({ current: 2, ready: 2, desired: 3 });
    // Traffic fields stay undefined so consumers fall through to /colibri/stats.
    expect(parsed?.participants).toBeUndefined();
    expect(parsed?.bitRateDownKbps).toBeUndefined();
    expect(parsed?.pollSuccesses).toBeUndefined();
  });

  it('parses an aggregated snapshot with traffic fields', () => {
    const raw = JSON.stringify({
      current: 3,
      ready: 3,
      desired: 3,
      checkedAt: '2026-04-22T20:00:00.000Z',
      pollSuccesses: 3,
      pollFailures: 0,
      participants: 2,
      conferences: 1,
      stressLevel: 0.006,
      largestConference: 2,
      endpointsSendingAudio: 0,
      endpointsSendingVideo: 1,
      bitRateDownKbps: 275,
      bitRateUpKbps: 180,
      octoConferences: 0,
      octoEndpoints: 0,
      octoSendBitrateBps: 0,
      octoReceiveBitrateBps: 0,
    });
    const parsed = parseJvbSnapshot(raw);
    expect(parsed?.ready).toBe(3);
    expect(parsed?.participants).toBe(2);
    expect(parsed?.bitRateDownKbps).toBe(275);
    expect(parsed?.bitRateUpKbps).toBe(180);
    expect(parsed?.pollSuccesses).toBe(3);
    expect(parsed?.stressLevel).toBeCloseTo(0.006);
  });

  it('drops non-finite / wrong-typed optional fields silently', () => {
    const raw = JSON.stringify({
      current: 1,
      ready: 1,
      desired: 1,
      checkedAt: '2026-04-22T20:00:00.000Z',
      participants: 'not a number',
      bitRateDownKbps: null,
      pollSuccesses: 1,
    });
    const parsed = parseJvbSnapshot(raw);
    expect(parsed?.ready).toBe(1);
    expect(parsed?.participants).toBeUndefined();
    expect(parsed?.bitRateDownKbps).toBeUndefined();
    expect(parsed?.pollSuccesses).toBe(1);
  });
});
