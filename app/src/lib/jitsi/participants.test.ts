import { describe, it, expect } from 'vitest';

import {
  RECORDER_DISPLAY_NAME,
  isHumanParticipant,
  humanParticipantCount,
} from './participants';

describe('isHumanParticipant', () => {
  it('excludes the recording bot by its exact display name', () => {
    expect(isHumanParticipant({ displayName: RECORDER_DISPLAY_NAME })).toBe(false);
  });

  it('counts real attendees', () => {
    expect(isHumanParticipant({ displayName: 'Alex' })).toBe(true);
    expect(isHumanParticipant({ displayName: 'Recorder' })).toBe(true); // not the exact bot name
  });

  it('treats missing/empty names as human (never a false bot match)', () => {
    expect(isHumanParticipant({})).toBe(true);
    expect(isHumanParticipant({ displayName: null })).toBe(true);
    expect(isHumanParticipant({ displayName: '' })).toBe(true);
  });

  it('excludes the bot when the name only appears in formattedDisplayName', () => {
    // Jitsi can leave displayName empty and put the shown name in
    // formattedDisplayName — the filter must still catch the bot.
    expect(
      isHumanParticipant({ displayName: null, formattedDisplayName: RECORDER_DISPLAY_NAME }),
    ).toBe(false);
    expect(
      isHumanParticipant({ displayName: '', formattedDisplayName: RECORDER_DISPLAY_NAME }),
    ).toBe(false);
  });
});

describe('humanParticipantCount', () => {
  const api = (total: number, remotes: Array<{ displayName?: string | null }>) => ({
    getNumberOfParticipants: () => total,
    getParticipantsInfo: () => remotes,
  });

  it('subtracts the recording bot from the total (local user still counted)', () => {
    // local + Alex + bot = 3 total; remotes list = [Alex, bot] → 2 humans
    expect(
      humanParticipantCount(api(3, [{ displayName: 'Alex' }, { displayName: RECORDER_DISPLAY_NAME }])),
    ).toBe(2);
  });

  it('returns the full total when no bot is present', () => {
    expect(
      humanParticipantCount(api(2, [{ displayName: 'Alex' }])),
    ).toBe(2);
  });

  it('never goes negative', () => {
    expect(humanParticipantCount(api(0, [{ displayName: RECORDER_DISPLAY_NAME }]))).toBe(0);
  });

  it('handles an API without getParticipantsInfo (returns the raw total)', () => {
    expect(humanParticipantCount({ getNumberOfParticipants: () => 5 })).toBe(5);
  });
});
