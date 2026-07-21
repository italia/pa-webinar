/**
 * Human-vs-bot participant helpers.
 *
 * The multitrack recording bot joins the Jitsi room as a normal endpoint so it
 * can subscribe to every track. Left unfiltered it inflates the "N persone"
 * headcount and shows up in the roster (F2: "il count dovrebbe essere solo
 * delle persone vere non recording"). These helpers are the single source of
 * truth for excluding it — used by every count consumer and the roster.
 */

/** Display name the recording bot joins under (see recorder-claim route, which
 *  mints its JWT with this exact value). */
export const RECORDER_DISPLAY_NAME = '📼 Recorder';

function isRecorderName(s?: string | null): boolean {
  // Match the FULL bot name as a prefix, not just the '📼' emoji. This still
  // catches whitespace and formatted-suffix variants ("📼 Recorder (me)",
  // " 📼 Recorder ") that an exact `=== '📼 Recorder'` comparison let slip
  // through (live feedback #2), but does NOT hide a real attendee whose name
  // merely begins with 📼 (e.g. "📼 Mia") — a bare '📼'-prefix match would have
  // wrongly filtered such a person from the roster and headcount, and would let
  // a griefer go invisible to moderation by prefixing their name with 📼.
  const n = (s ?? '').normalize('NFC').trim();
  return n.startsWith(RECORDER_DISPLAY_NAME);
}

/** True for a real attendee (i.e. not the recording bot).
 *
 *  The Jitsi IFrame API can leave `displayName` empty and surface the shown
 *  name in `formattedDisplayName` instead, so we exclude the bot if EITHER
 *  field is the recorder name — otherwise the whole F2 filter could silently
 *  no-op and the bot would reappear in the count/roster. A plain "Recorder"
 *  with no '📼' marker is still treated as a human (the emoji is the signal). */
export function isHumanParticipant(p: {
  displayName?: string | null;
  formattedDisplayName?: string | null;
}): boolean {
  return !isRecorderName(p.displayName) && !isRecorderName(p.formattedDisplayName);
}

/**
 * Stable-per-person key used to collapse duplicate endpoints (F4: "quando
 * qualcuno entra ed esce — Back del browser — rientra ma viene contato come
 * nuovo utente. Alex è entrato 3 volte, risulta 3!").
 *
 * The IFrame API does NOT surface our JWT identity (`context.user.id`) on a
 * client-side participant — only the endpoint id (a fresh per-connection value),
 * `displayName` and `formattedDisplayName`. So we key on the normalized
 * display name: a person re-entering keeps the same name, so their leftover
 * "zombie" endpoint (not yet evicted by Prosody) shares the key and collapses
 * to one. Endpoints with no name fall back to their unique endpoint id, so
 * anonymous users are never merged together.
 *
 * The endpoint id field is `participantId` — external_api.js stamps it in
 * `getParticipantsInfo()` (`e.participantId = <key of this._participants>`).
 * `id` is accepted too because raised-hand/participant EVENT payloads use that
 * name; taking either keeps one helper valid for both shapes.
 */
export function participantIdentityKey(p: {
  id?: string | null;
  participantId?: string | null;
  displayName?: string | null;
  formattedDisplayName?: string | null;
}): string {
  const name = (p.displayName ?? p.formattedDisplayName ?? '').trim().toLowerCase();
  if (name) return name;
  const endpointId = p.participantId ?? p.id;
  if (endpointId) return `#${endpointId}`;
  return '';
}

/**
 * Human headcount for a Jitsi IFrame API instance: the number of DISTINCT human
 * identities in the room, bot excluded (F2) and re-entry "zombies" collapsed
 * (F4: "Alex è entrato 3 volte, risulta 3!").
 *
 * We count the roster directly instead of subtracting corrections from
 * `getNumberOfParticipants()`. The old subtract-from-total form was off by one:
 * it assumed `getParticipantsInfo()` is remotes-only and seeded the dedup set
 * with the local user's name, but in the external_api.js this platform serves
 * `case "video-conference-joined"` has NO `break` and falls through into
 * `case "participant-joined"`, which writes the LOCAL user's displayName into
 * `_participants`. The local user is therefore IN the roster, matched the seeded
 * key, and was counted as a duplicate — so every client under-reported by one.
 * That is exactly the "4 persone" of live feedback #4 (6 endpoints − 1 bot −
 * 1 self), and since #4b it was also the number persisted to
 * `Event.peakParticipants`.
 *
 * Counting the union of {roster identities} ∪ {local identity} is correct under
 * BOTH shapes: where the roster includes the local user the union is a no-op,
 * and where it does not (the documented upstream contract, and what a future
 * Jitsi bump may restore) the local user is added back exactly once. Pass
 * `localEndpointId` (the `id` from `videoConferenceJoined`, which JitsiRoom
 * already tracks) to make that decision EXACT instead of name-based: with it we
 * detect the local row in the roster by id, so a user who renames themselves
 * mid-call can no longer be counted twice. This build exposes no
 * `getMyUserId()`, hence the id has to come from the caller.
 *
 * `getNumberOfParticipants()` survives only as the fallback for an API that
 * exposes no roster at all.
 *
 * NOTE (known limitation): the only identity readable client-side is the display
 * name, so two genuinely DISTINCT attendees who share an identical name count as
 * one here — an intentional, cosmetic undercount of the headline number. The
 * roster (participant-panel) still lists every connection so a moderator can see
 * and kick each one; only the numeric people-count is de-duplicated.
 */
export function humanParticipantCount(
  api: {
    getNumberOfParticipants: () => number;
    getParticipantsInfo?: () => Array<{
      id?: string | null;
      participantId?: string | null;
      displayName?: string | null;
      formattedDisplayName?: string | null;
    }>;
  },
  localDisplayName?: string | null,
  localEndpointId?: string | null,
): number {
  const roster = api.getParticipantsInfo?.() ?? [];
  // No roster to count (API not ready, or a build without getParticipantsInfo):
  // fall back to the raw total rather than reporting an empty room.
  if (roster.length === 0) return Math.max(0, api.getNumberOfParticipants());

  const identities = new Set<string>();
  let sawLocal = false;
  roster.forEach((p, i) => {
    if (localEndpointId && (p.participantId ?? p.id) === localEndpointId) {
      sawLocal = true;
    }
    if (!isHumanParticipant(p)) return; // the recording bot (F2)
    // participantIdentityKey falls back to the endpoint id for nameless
    // endpoints (distinct anonymous users never merge); `#anon-${i}` covers the
    // rare both-name-and-id-empty case so it still can't collide with another.
    identities.add(participantIdentityKey(p) || `#anon-${i}`);
  });

  // Add the local user only when the roster demonstrably does not list them.
  // With an endpoint id that is a certainty; without one we fall back to the
  // name key, which the Set collapses when the roster already carries it.
  if (!sawLocal) {
    const localKey =
      participantIdentityKey({ displayName: localDisplayName }) ||
      (localEndpointId ? `#${localEndpointId}` : '');
    if (localKey) identities.add(localKey);
  }

  return identities.size;
}
