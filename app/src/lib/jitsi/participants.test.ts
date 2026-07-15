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
  const api = (
    total: number,
    remotes: Array<{
      id?: string | null;
      displayName?: string | null;
      formattedDisplayName?: string | null;
    }>,
  ) => ({
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

  // F4: a person re-entering (Back button / rejoin) leaves zombie endpoints
  // that share their display name; count them once.
  it('collapses same-name zombie endpoints (F4)', () => {
    // local + 3 "Mario" endpoints (one live, two zombies) = 4 total → 2 people.
    expect(
      humanParticipantCount(
        api(4, [
          { id: 'a', displayName: 'Mario' },
          { id: 'b', displayName: 'Mario' },
          { id: 'c', displayName: 'Mario' },
        ]),
      ),
    ).toBe(2);
  });

  it('subtracts both the bot and same-name duplicates together (F4 + F2)', () => {
    // total 4 = local + Mario + Mario-zombie + bot → 4 - 1 bot - 1 dupe = 2.
    expect(
      humanParticipantCount(
        api(4, [
          { id: 'a', displayName: 'Mario' },
          { id: 'b', displayName: 'Mario' },
          { id: 'c', displayName: RECORDER_DISPLAY_NAME },
        ]),
      ),
    ).toBe(2);
  });

  it('is case- and whitespace-insensitive when deduping (F4)', () => {
    expect(
      humanParticipantCount(
        api(3, [
          { id: 'a', displayName: 'Mario' },
          { id: 'b', displayName: '  mario ' },
        ]),
      ),
    ).toBe(2);
  });

  it('never merges distinct anonymous (empty-name) endpoints (F4)', () => {
    // Two nameless endpoints with distinct ids stay distinct.
    expect(
      humanParticipantCount(
        api(3, [
          { id: 'a', displayName: '' },
          { id: 'b', displayName: '' },
        ]),
      ),
    ).toBe(3);
  });

  it("collapses the local user's own zombie via localDisplayName (F4 #5)", () => {
    // Alex's own screen after a Back-button rejoin: total = local Alex + zombie
    // Alex = 2, remotes = [zombie Alex]. Seeding the local name collapses it → 1.
    expect(
      humanParticipantCount(api(2, [{ id: 'z', displayName: 'Alex' }]), 'Alex'),
    ).toBe(1);
    // Without the local name, the local zombie can't be recognized (still 2).
    expect(
      humanParticipantCount(api(2, [{ id: 'z', displayName: 'Alex' }])),
    ).toBe(2);
  });
});
