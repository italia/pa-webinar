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

/**
 * emoji → how many reacted with it.
 *
 * COUNTS, never the sender ids. The ids are broadcast to every reader of the
 * chat, the UI only ever renders the number, and a guest id is a base64 of
 * `ip:name` — publishing the list would have handed the public IP of every
 * silent attendee who tapped an emoji to anyone with devtools open.
 */
export type ChatReactionTally = Record<string, number>;

/** Collapse reaction rows into the counts the clients render. */
export function tallyReactions(rows: Array<{ emoji: string }>): ChatReactionTally {
  const out: ChatReactionTally = {};
  for (const r of rows) {
    out[r.emoji] = (out[r.emoji] ?? 0) + 1;
  }
  return out;
}
