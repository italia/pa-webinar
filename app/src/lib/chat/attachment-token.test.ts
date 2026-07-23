import { describe, it, expect, beforeAll } from 'vitest';

import {
  issueChatAttachmentToken,
  verifyChatAttachmentToken,
  type ChatAttachmentClaims,
} from './attachment-token';

const CLAIMS: ChatAttachmentClaims = {
  key: 'assets/image/2026/07/abc-pic.png',
  mime: 'image/png',
  size: 12345,
  name: 'pic.png',
  eventId: 'evt-1',
  senderId: 'reg-42',
};
const CALLER = { eventId: CLAIMS.eventId, senderId: CLAIMS.senderId };

describe('chat attachment token', () => {
  beforeAll(() => {
    // requireAppSecret reads APP_SECRET (or a dev fallback); ensure it's set.
    process.env.APP_SECRET ??= 'test-secret-at-least-32-chars-long-xxxxx';
  });

  it('round-trips valid claims', () => {
    const token = issueChatAttachmentToken(CLAIMS);
    expect(verifyChatAttachmentToken(token, CALLER)).toEqual(CLAIMS);
  });

  it('rejects a token replayed by a different sender', () => {
    const token = issueChatAttachmentToken(CLAIMS);
    expect(
      verifyChatAttachmentToken(token, { eventId: CLAIMS.eventId, senderId: 'reg-99' }),
    ).toBeNull();
  });

  it('rejects a token used on a different event', () => {
    const token = issueChatAttachmentToken(CLAIMS);
    expect(
      verifyChatAttachmentToken(token, { eventId: 'evt-2', senderId: CLAIMS.senderId }),
    ).toBeNull();
  });

  it('rejects an expired token', () => {
    const past = new Date(Date.now() - 60 * 60 * 1000); // issued 1h ago
    const token = issueChatAttachmentToken(CLAIMS, past);
    expect(verifyChatAttachmentToken(token, CALLER)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const token = issueChatAttachmentToken(CLAIMS);
    const [payload, sig] = token.split('.');
    // Flip a byte in the payload while keeping the old signature.
    const tampered = `${payload}A.${sig}`;
    expect(verifyChatAttachmentToken(tampered, CALLER)).toBeNull();
  });

  it('rejects garbage', () => {
    expect(verifyChatAttachmentToken('', CALLER)).toBeNull();
    expect(verifyChatAttachmentToken('no-dot', CALLER)).toBeNull();
    expect(verifyChatAttachmentToken('.onlysig', CALLER)).toBeNull();
  });
});
