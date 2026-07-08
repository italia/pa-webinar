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
 * Human headcount for a Jitsi IFrame API instance. `getNumberOfParticipants()`
 * is the total (local + remotes, bot included); `getParticipantsInfo()` lists
 * the remotes. We subtract any non-human remotes from the total so the local
 * user is still counted and the bot is not.
 */
export function humanParticipantCount(api: {
  getNumberOfParticipants: () => number;
  getParticipantsInfo?: () => Array<{
    displayName?: string | null;
    formattedDisplayName?: string | null;
  }>;
}): number {
  const total = api.getNumberOfParticipants();
  const nonHuman = (api.getParticipantsInfo?.() ?? []).filter(
    (p) => !isHumanParticipant(p),
  ).length;
  return Math.max(0, total - nonHuman);
}
