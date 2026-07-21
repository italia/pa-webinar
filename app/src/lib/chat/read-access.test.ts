import { describe, it, expect } from 'vitest';

import { guestChatWindowOpen } from './read-access';

/**
 * The window in which an anonymous reader may follow the chat. It must stay
 * identical to the guest WRITE branch in the chat POST route — the read side
 * used to have no gate at all, which left every event's transcript (attendee
 * names + free text) fetchable by slug forever.
 */
describe('guestChatWindowOpen', () => {
  const scheduled = (status: string) => ({ status, eventType: 'SCHEDULED' });
  const instant = (status: string) => ({ status, eventType: 'INSTANT' });

  it('opens while the room is live, whatever the event type', () => {
    expect(guestChatWindowOpen(scheduled('LIVE'))).toBe(true);
    expect(guestChatWindowOpen(instant('LIVE'))).toBe(true);
  });

  it('opens during the bridge warm-up of an INSTANT call only', () => {
    // INSTANT rooms are opened by link with no time gate and show the chat while
    // the bridge scales up.
    expect(guestChatWindowOpen(instant('PROVISIONING'))).toBe(true);
    expect(guestChatWindowOpen(instant('IDLE'))).toBe(true);
    // A scheduled event must not: /wake is unauthenticated, so anyone could flip
    // PUBLISHED→PROVISIONING and then read the room anonymously.
    expect(guestChatWindowOpen(scheduled('PROVISIONING'))).toBe(false);
    expect(guestChatWindowOpen(scheduled('IDLE'))).toBe(false);
  });

  it('stays shut before and after the event — including ENDED and ARCHIVED', () => {
    // This is the hole that leaked the DevIt transcript days after the event.
    for (const status of ['DRAFT', 'PUBLISHED', 'ENDED', 'ARCHIVED', 'CANCELLED']) {
      expect(guestChatWindowOpen(scheduled(status)), status).toBe(false);
      expect(guestChatWindowOpen(instant(status)), `INSTANT ${status}`).toBe(false);
    }
  });
});
