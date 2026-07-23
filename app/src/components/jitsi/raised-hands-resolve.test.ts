/**
 * Regression test for the "all raised hands show the same name" bug.
 *
 * In JWT rooms a remote participant's displayName arrives via MUC presence
 * *after* the `raiseHandUpdated` event fires, so the synchronous
 * `getParticipantsInfo()` scan comes back empty and every chip fell back to
 * the single literal `participantFallback` string ("Partecipante"/"Participant"),
 * making every raiser look identical.
 *
 * The fix has `resolveDisplayName` try the direct `getDisplayName(id)`
 * accessor first (populated by Jitsi before presence backfills
 * getParticipantsInfo), so distinct raisers resolve to distinct names even
 * while the scan is still empty. We test that resolver directly — matching
 * the repo's logic-only test convention — driving multiple distinct ids
 * through the exact race the panel hits.
 */

import { describe, it, expect } from 'vitest';

import type { JitsiMeetExternalAPI, JitsiParticipant } from '@/types/jitsi';

// Import from the extracted resolver module rather than the panel component:
// `raised-hands-panel.tsx` pulls in `design-react-kit`, whose package
// `exports` map is unresolvable under Vite, so importing it here would fail
// dependency resolution before any test runs.
import { resolveDisplayName } from './raised-hands-resolve';

/**
 * Build a mock Jitsi API. `getParticipantsInfo()` is overridable (defaults to
 * the empty-displayName / pre-presence state) and `getDisplayName(id)` looks
 * up the provided name map.
 */
function makeApi(
  names: Record<string, string | undefined>,
  participants: JitsiParticipant[] = [],
): JitsiMeetExternalAPI {
  return {
    getDisplayName: (id: string) => names[id],
    getParticipantsInfo: () => participants,
  } as unknown as JitsiMeetExternalAPI;
}

describe('resolveDisplayName — distinct raiser names', () => {
  it('resolves DISTINCT names for multiple ids when getParticipantsInfo is empty but getDisplayName knows them', () => {
    // The bug: getParticipantsInfo() returns entries with empty displayNames
    // (presence not propagated yet), so the old scan-only resolver returned
    // '' for everyone and the UI collapsed every chip to "Participant".
    const api = makeApi(
      { 'p-alice': 'Alice', 'p-bob': 'Bob', 'p-carol': 'Carol' },
      [
        { participantId: 'p-alice', displayName: '', formattedDisplayName: '', role: 'participant' },
        { participantId: 'p-bob', displayName: '', formattedDisplayName: '', role: 'participant' },
        { participantId: 'p-carol', displayName: '', formattedDisplayName: '', role: 'participant' },
      ],
    );

    const resolved = ['p-alice', 'p-bob', 'p-carol'].map((id) =>
      resolveDisplayName(api, id, null, ''),
    );

    // Distinct, non-empty names — not all collapsed to one fallback string.
    expect(resolved).toEqual(['Alice', 'Bob', 'Carol']);
    expect(new Set(resolved).size).toBe(3);
    expect(resolved).not.toContain('');
  });

  it('returns empty string when neither getDisplayName nor the scan know the id (caller then uses the i18n fallback)', () => {
    const api = makeApi({});
    expect(resolveDisplayName(api, 'p-unknown', null, '')).toBe('');
  });
});

describe('resolveDisplayName — resolution order', () => {
  it('short-circuits to the local name for the local id (getParticipantsInfo excludes self)', () => {
    const api = makeApi({ self: 'should-not-win' });
    expect(resolveDisplayName(api, 'self', 'self', 'Me')).toBe('Me');
  });

  it('prefers getDisplayName over the getParticipantsInfo scan', () => {
    const api = makeApi({ x: 'FromDirect' }, [
      { participantId: 'x', displayName: 'FromScan', formattedDisplayName: '', role: 'participant' },
    ]);
    expect(resolveDisplayName(api, 'x', null, '')).toBe('FromDirect');
  });

  it('falls back to the scan displayName when getDisplayName is empty', () => {
    const api = makeApi({ x: '' }, [
      { participantId: 'x', displayName: 'FromScan', formattedDisplayName: '', role: 'participant' },
    ]);
    expect(resolveDisplayName(api, 'x', null, '')).toBe('FromScan');
  });

  it('uses formattedDisplayName when both getDisplayName and displayName are empty', () => {
    const api = makeApi({ x: undefined }, [
      { participantId: 'x', displayName: '', formattedDisplayName: 'Formatted', role: 'participant' },
    ]);
    expect(resolveDisplayName(api, 'x', null, '')).toBe('Formatted');
  });

  it('tolerates getDisplayName throwing and falls back to the scan', () => {
    const api = {
      getDisplayName: () => {
        throw new Error('endpoint unknown');
      },
      getParticipantsInfo: () => [
        { participantId: 'x', displayName: 'FromScan', formattedDisplayName: '', role: 'participant' },
      ],
    } as unknown as JitsiMeetExternalAPI;
    expect(resolveDisplayName(api, 'x', null, '')).toBe('FromScan');
  });

  it('tolerates a missing getDisplayName accessor (optional chaining) and uses the scan', () => {
    const api = {
      getParticipantsInfo: () => [
        { participantId: 'x', displayName: 'FromScan', formattedDisplayName: '', role: 'participant' },
      ],
    } as unknown as JitsiMeetExternalAPI;
    expect(resolveDisplayName(api, 'x', null, '')).toBe('FromScan');
  });
});
