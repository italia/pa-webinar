import type { JitsiMeetExternalAPI } from '@/types/jitsi';

/**
 * Resolves the display name for a participant. Tries, in order:
 *  1. the local-name short-circuit — kept because the local row may carry an
 *     empty displayName even when it IS listed (the served external_api.js does
 *     list self: `video-conference-joined` falls through into
 *     `participant-joined`), so a local raiser could otherwise resolve to empty;
 *  2. the direct per-id accessor `getDisplayName(id)` — this is populated
 *     by Jitsi as soon as the endpoint exists, even before the MUC presence
 *     that backfills `getParticipantsInfo()`. In JWT rooms the displayName
 *     arrives via presence *after* the `raiseHandUpdated` event, so the
 *     scan below comes back empty for remote raisers — the direct accessor
 *     closes that race (proven pattern, see jitsi-room.tsx);
 *  3. the `getParticipantsInfo()` scan as a final fallback.
 * Returns '' when nothing resolves yet (caller retries / falls back to i18n).
 *
 * Extracted into its own module (separate from the panel component) so it
 * can be unit-tested without dragging `design-react-kit` — whose package
 * `exports` map is unresolvable under Vite — into the test import graph.
 */
export function resolveDisplayName(
  api: JitsiMeetExternalAPI,
  participantId: string,
  localId: string | null,
  localName: string,
): string {
  if (localId && participantId === localId && localName) {
    return localName;
  }
  try {
    const direct = api.getDisplayName?.(participantId);
    if (direct) return direct;
  } catch {
    // getDisplayName can throw before the endpoint is known — ignore and scan.
  }
  const info = api.getParticipantsInfo();
  const p = info.find((pp) => pp.participantId === participantId);
  return p?.displayName || p?.formattedDisplayName || '';
}

// Staggered retry schedule (ms) for names that are still empty right after
// `raiseHandUpdated` fires — MUC presence in JWT rooms can lag noticeably.
export const RETRY_DELAYS_MS = [300, 800, 1500, 3000];
