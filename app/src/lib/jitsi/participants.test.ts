import { describe, it, expect } from 'vitest';

import {
  RECORDER_DISPLAY_NAME,
  isHumanParticipant,
  humanParticipantCount,
  participantIdentityKey,
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

  it('excludes the bot despite whitespace or a formatted suffix (full-name prefix, feedback #2)', () => {
    // The surfaced name can gain leading/trailing whitespace or a
    // "formattedDisplayName" suffix; an exact === match let these through and
    // the bot reappeared in the roster/count. The full-name prefix catches them.
    expect(isHumanParticipant({ displayName: ' 📼 Recorder ' })).toBe(false);
    expect(isHumanParticipant({ displayName: '📼 Recorder (me)' })).toBe(false);
    expect(
      isHumanParticipant({ displayName: null, formattedDisplayName: '📼 Recorder (moderator)' }),
    ).toBe(false);
  });

  it('keeps a real attendee whose name merely starts with 📼 (not the bot)', () => {
    // Only the full "📼 Recorder" prefix is the bot; a bare '📼'-prefix match
    // would wrongly hide these humans from the roster/count (and let a griefer
    // go invisible to moderation).
    expect(isHumanParticipant({ displayName: '📼 Mia' })).toBe(true);
    expect(isHumanParticipant({ displayName: '📼 Party 🎉' })).toBe(true);
  });
});

describe('participantIdentityKey', () => {
  it('keys on the normalized display name when there is one', () => {
    expect(participantIdentityKey({ displayName: '  Mario  ' })).toBe('mario');
    expect(participantIdentityKey({ formattedDisplayName: 'MARIO' })).toBe('mario');
  });

  it('falls back to the endpoint id, which the roster exposes as participantId', () => {
    // external_api.js stamps `participantId` on getParticipantsInfo() rows and
    // never `id`; reading only `id` here is what left the roster keyed on
    // `#undefined` for every nameless endpoint.
    expect(participantIdentityKey({ participantId: 'p-1', displayName: '' })).toBe('#p-1');
    // Event payloads use `id` — still accepted so one helper covers both shapes.
    expect(participantIdentityKey({ id: 'p-2', displayName: '' })).toBe('#p-2');
  });

  it('returns empty when nothing identifies the endpoint', () => {
    expect(participantIdentityKey({})).toBe('');
  });
});

describe('humanParticipantCount', () => {
  // The external_api.js this platform serves lists the LOCAL user in
  // getParticipantsInfo() — `case "video-conference-joined"` has no `break` and
  // falls through into `case "participant-joined"`, which writes the local
  // displayName into `_participants` and bumps the counter. Roster and total are
  // therefore always consistent, and these fixtures model the WHOLE room rather
  // than the "remotes only" shape the upstream docs describe.
  const api = (
    roster: Array<{
      id?: string | null;
      participantId?: string | null;
      displayName?: string | null;
      formattedDisplayName?: string | null;
    }>,
    total = roster.length,
  ) => ({
    getNumberOfParticipants: () => total,
    getParticipantsInfo: () => roster,
  });

  it('counts the humans in the room and excludes the recording bot (F2)', () => {
    expect(
      humanParticipantCount(
        api([
          { participantId: 'me', displayName: 'Anna' },
          { participantId: 'a', displayName: 'Alex' },
          { participantId: 'bot', displayName: RECORDER_DISPLAY_NAME },
        ]),
        'Anna',
        'me',
      ),
    ).toBe(2);
  });

  it('does NOT drop the local user — the "4 persone" off-by-one (feedback #4)', () => {
    // Exactly the DevIt room: 6 endpoints on the bridge = 5 people + the bot.
    // The old implementation seeded the dedup set with the local name and then
    // met that same name in the roster, scoring it as a duplicate: it reported
    // 4. Since #4b that wrong number was also written to Event.peakParticipants.
    const roster = [
      { participantId: 'me', displayName: 'Anna' },
      { participantId: 'b', displayName: 'Alex' },
      { participantId: 'c', displayName: 'Ugo' },
      { participantId: 'd', displayName: 'Lia' },
      { participantId: 'e', displayName: 'Rob' },
      { participantId: 'bot', displayName: RECORDER_DISPLAY_NAME },
    ];
    expect(humanParticipantCount(api(roster), 'Anna', 'me')).toBe(5);
    // …and the same room seen by a client that knows neither its name nor its id.
    expect(humanParticipantCount(api(roster))).toBe(5);
  });

  it('collapses same-name zombie endpoints (F4)', () => {
    // One live "Mario" plus two leftover endpoints from Back-button rejoins.
    expect(
      humanParticipantCount(
        api([
          { participantId: 'me', displayName: 'Anna' },
          { participantId: 'a', displayName: 'Mario' },
          { participantId: 'b', displayName: 'Mario' },
          { participantId: 'c', displayName: 'Mario' },
        ]),
        'Anna',
        'me',
      ),
    ).toBe(2);
  });

  it("collapses the local user's OWN zombie (F4)", () => {
    // Alex rejoined: their live endpoint and the zombie share the name.
    expect(
      humanParticipantCount(
        api([
          { participantId: 'me', displayName: 'Alex' },
          { participantId: 'z', displayName: 'Alex' },
        ]),
        'Alex',
        'me',
      ),
    ).toBe(1);
  });

  it('is case- and whitespace-insensitive when deduping (F4)', () => {
    expect(
      humanParticipantCount(
        api([
          { participantId: 'a', displayName: 'Mario' },
          { participantId: 'b', displayName: '  mario ' },
        ]),
      ),
    ).toBe(1);
  });

  it('never merges distinct anonymous (empty-name) endpoints (F4)', () => {
    expect(
      humanParticipantCount(
        api([
          { participantId: 'a', displayName: '' },
          { participantId: 'b', displayName: '' },
        ]),
      ),
    ).toBe(2);
  });

  it('adds the local user back when the roster does NOT list them', () => {
    // The upstream-documented shape (and what a Jitsi bump adding the missing
    // `break` would restore): roster = remotes only. The local user must then be
    // counted once — via the endpoint id if known, otherwise via the name.
    expect(
      humanParticipantCount(api([{ participantId: 'a', displayName: 'Alex' }]), 'Anna', 'me'),
    ).toBe(2);
    expect(
      humanParticipantCount(api([{ participantId: 'a', displayName: 'Alex' }]), 'Anna'),
    ).toBe(2);
    // Nameless local user: the endpoint id keeps them countable.
    expect(
      humanParticipantCount(api([{ participantId: 'a', displayName: 'Alex' }]), null, 'me'),
    ).toBe(2);
  });

  it('does not double-count a local user who renamed themselves mid-call', () => {
    // Roster carries the NEW name, the caller still holds the name it passed to
    // Jitsi at join. Matching on the endpoint id (not the name) keeps it at 1.
    expect(
      humanParticipantCount(
        api([{ participantId: 'me', displayName: 'Anna Rossi' }]),
        'Anna',
        'me',
      ),
    ).toBe(1);
  });

  it('counts 0 for a room holding only the recording bot', () => {
    expect(humanParticipantCount(api([{ participantId: 'bot', displayName: RECORDER_DISPLAY_NAME }]))).toBe(0);
  });

  it('falls back to the raw total when no roster is available', () => {
    expect(humanParticipantCount({ getNumberOfParticipants: () => 5 })).toBe(5);
    // Empty roster (API not ready yet) must not report an empty room either.
    expect(humanParticipantCount(api([], 3))).toBe(3);
  });

  it('never goes negative', () => {
    expect(humanParticipantCount({ getNumberOfParticipants: () => -1 })).toBe(0);
  });
});
