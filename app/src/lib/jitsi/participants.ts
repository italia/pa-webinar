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

/** True for a real attendee (i.e. not the recording bot).
 *
 *  The Jitsi IFrame API can leave `displayName` empty and surface the shown
 *  name in `formattedDisplayName` instead, so we exclude the bot if EITHER
 *  field is the recorder name — otherwise the whole F2 filter could silently
 *  no-op and the bot would reappear in the count/roster. */
export function isHumanParticipant(p: {
  displayName?: string | null;
  formattedDisplayName?: string | null;
}): boolean {
  return (
    (p.displayName ?? '') !== RECORDER_DISPLAY_NAME &&
    (p.formattedDisplayName ?? '') !== RECORDER_DISPLAY_NAME
  );
}

/**
 * Stable-per-person key used to collapse duplicate endpoints (F4: "quando
 * qualcuno entra ed esce — Back del browser — rientra ma viene contato come
 * nuovo utente. Alex è entrato 3 volte, risulta 3!").
 *
 * The IFrame API does NOT surface our JWT identity (`context.user.id`) on a
 * client-side participant — only `id` (a fresh per-connection endpoint id),
 * `displayName` and `formattedDisplayName`. So we key on the normalized
 * display name: a person re-entering keeps the same name, so their leftover
 * "zombie" endpoint (not yet evicted by Prosody) shares the key and collapses
 * to one. Endpoints with no name fall back to their unique endpoint id, so
 * anonymous users are never merged together.
 */
export function participantIdentityKey(p: {
  id?: string | null;
  displayName?: string | null;
  formattedDisplayName?: string | null;
}): string {
  const name = (p.displayName ?? p.formattedDisplayName ?? '').trim().toLowerCase();
  if (name) return name;
  if (p.id) return `#${p.id}`;
  return '';
}

/**
 * Human headcount for a Jitsi IFrame API instance. `getNumberOfParticipants()`
 * is the total (local + remotes, bot included); `getParticipantsInfo()` lists
 * the remotes. We subtract any non-human remotes from the total so the local
 * user is still counted and the bot is not — and additionally subtract
 * same-identity duplicate remotes (F4) so a person who re-entered (Back-button
 * rejoin leaving a lingering "zombie" endpoint) isn't counted multiple times.
 *
 * `localDisplayName` (optional) is the local user's own name: getParticipantsInfo
 * is remotes-only, so we seed it into the dedup set to also collapse the local
 * user's OWN zombie on their own screen (otherwise the very person who re-entered
 * would still see their count inflated).
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
      displayName?: string | null;
      formattedDisplayName?: string | null;
    }>;
  },
  localDisplayName?: string | null,
): number {
  const total = api.getNumberOfParticipants();
  const remotes = api.getParticipantsInfo?.() ?? [];
  const nonHuman = remotes.filter((p) => !isHumanParticipant(p)).length;

  // F4: collapse zombie duplicates (same person, multiple lingering endpoints),
  // seeding the local user's own identity so their own zombie collapses too.
  const seen = new Set<string>();
  const localKey = (localDisplayName ?? '').trim().toLowerCase();
  if (localKey) seen.add(localKey);
  let duplicates = 0;
  remotes.forEach((p, i) => {
    if (!isHumanParticipant(p)) return;
    const key = participantIdentityKey(p) || `#anon-${i}`;
    if (seen.has(key)) duplicates += 1;
    else seen.add(key);
  });

  return Math.max(0, total - nonHuman - duplicates);
}
