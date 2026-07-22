/**
 * The emoji a chat message may be reacted with.
 *
 * A closed set, shared by the picker and the API. The server validates against
 * it rather than storing whatever arrives: `emoji` is a free-text column
 * rendered back to every participant, so an open field would be a place to put
 * arbitrary strings — including ones that are not emoji at all — in front of the
 * whole room.
 *
 * Kept deliberately short. A reaction row is a tally, not a vocabulary: eight
 * options fit one row on a phone and keep the counts readable.
 */
export const CHAT_REACTION_EMOJIS = [
  '👍', '❤️', '😂', '🎉', '👏', '🤔', '😮', '🙏',
] as const;

export type ChatReactionEmoji = (typeof CHAT_REACTION_EMOJIS)[number];

export function isChatReactionEmoji(value: string): value is ChatReactionEmoji {
  return (CHAT_REACTION_EMOJIS as readonly string[]).includes(value);
}

/** emoji → sender ids who reacted with it. */
export type ChatReactionTally = Record<string, string[]>;

/** Collapse reaction rows into the shape the clients render. */
export function tallyReactions(
  rows: Array<{ emoji: string; senderId: string }>,
): ChatReactionTally {
  const out: ChatReactionTally = {};
  for (const r of rows) {
    (out[r.emoji] ??= []).push(r.senderId);
  }
  return out;
}
