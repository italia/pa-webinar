import { describe, it, expect } from 'vitest';

import { CHAT_REACTION_EMOJIS, isChatReactionEmoji, tallyReactions } from './emoji';

describe('chat reaction emoji', () => {
  it('accepts only the closed set', () => {
    for (const e of CHAT_REACTION_EMOJIS) expect(isChatReactionEmoji(e)).toBe(true);
  });

  it('rejects anything else — the value is rendered back to the whole room', () => {
    for (const bad of ['<script>', '💩', 'ok', '', '👍👍', 'https://x']) {
      expect(isChatReactionEmoji(bad), bad).toBe(false);
    }
  });
});

describe('tallyReactions', () => {
  it('counts per emoji and never carries an id — the tally is broadcast to the room', () => {
    expect(
      tallyReactions([{ emoji: '👍' }, { emoji: '👍' }, { emoji: '🎉' }]),
    ).toEqual({ '👍': 2, '🎉': 1 });
  });

  it('is empty for no rows', () => {
    expect(tallyReactions([])).toEqual({});
  });
});
