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
  it('groups sender ids by emoji', () => {
    expect(
      tallyReactions([
        { emoji: '👍', senderId: 'reg-1' },
        { emoji: '👍', senderId: 'reg-2' },
        { emoji: '🎉', senderId: 'reg-1' },
      ]),
    ).toEqual({ '👍': ['reg-1', 'reg-2'], '🎉': ['reg-1'] });
  });

  it('is empty for no rows', () => {
    expect(tallyReactions([])).toEqual({});
  });
});
