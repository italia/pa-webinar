/**
 * POST /chat/<messageId>/reactions   → toggle one emoji on one message.
 *
 * Reacting to a single message did not exist ("ad oggi non si riesce fare
 * reazioni ai singoli messaggi") — it was reported as a display bug, but there
 * was nothing to display.
 *
 * Toggle rather than add/remove: the client sends the emoji it wants to flip and
 * the server decides, so a double click, a retried request or two tabs of the
 * same person converge on the same state instead of stacking duplicates. The
 * unique index (message, sender, emoji) makes that safe under concurrency.
 *
 * Authorization is the chat's own: whoever may POST a message here may react to
 * one, guests included — the identity used is the same `senderId`, so a reaction
 * stays attributable even after a display-name change.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { extractModeratorToken } from '@/lib/auth/moderator';
import { authenticateChatSender } from '@/lib/chat/authenticate';
import { isChatReactionEmoji, tallyReactions } from '@/lib/chat/emoji';
import { publishChat } from '@/lib/chat/pubsub';
import { prisma } from '@/lib/db';
import { NotFoundError, RateLimitError, ValidationError } from '@/lib/errors';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bodySchema = z.object({
  emoji: z.string().min(1).max(16),
  guestName: z.string().trim().min(1).max(80).optional(),
  displayNameOverride: z.string().trim().min(1).max(80).optional(),
});

export const POST = withErrorHandling(async (request, context) => {
  const { param, messageId } = await context.params as {
    param: string;
    messageId: string;
  };
  if (!UUID_RE.test(messageId)) throw new NotFoundError('Message');

  const body = await parseJsonBody(request);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }

  // Closed set: `emoji` is free text rendered back to the whole room.
  if (!isChatReactionEmoji(parsed.data.emoji)) {
    throw new ValidationError('Unsupported reaction', [
      { path: ['emoji'], message: 'not in the allowed set' },
    ]);
  }

  const auth = await authenticateChatSender(
    param,
    extractModeratorToken(request),
    parsed.data.guestName,
    parsed.data.displayNameOverride,
    request,
  );

  // Cheaper than a message but just as spammable: a reaction is a write plus a
  // fan-out to every connected client.
  const rl = rateLimit(`chat-reaction:${auth.eventId}:${auth.senderId}`, {
    limit: 60,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  }

  // The message must belong to THIS event — a message id from another room must
  // not be reachable by pointing this route at a slug you can post in — and a
  // hidden message takes no new reactions.
  const message = await prisma.chatMessage.findFirst({
    where: { id: messageId, eventId: auth.eventId, hiddenAt: null },
    select: { id: true },
  });
  if (!message) throw new NotFoundError('Message');

  const existing = await prisma.chatMessageReaction.findUnique({
    where: {
      messageId_senderId_emoji: {
        messageId,
        senderId: auth.senderId,
        emoji: parsed.data.emoji,
      },
    },
    select: { id: true },
  });

  if (existing) {
    await prisma.chatMessageReaction.delete({ where: { id: existing.id } });
  } else {
    // A concurrent duplicate hits the unique index; the row it collides with is
    // exactly the one we wanted, so treat it as success rather than a 500.
    await prisma.chatMessageReaction
      .create({
        data: { messageId, senderId: auth.senderId, emoji: parsed.data.emoji },
      })
      .catch(() => {});
  }

  const rows = await prisma.chatMessageReaction.findMany({
    where: { messageId },
    select: { emoji: true, senderId: true },
  });
  const reactions = tallyReactions(rows);

  // Publish the WHOLE tally, not a delta: a client that missed a frame still
  // converges, and late joiners get the same numbers from the history endpoint.
  void publishChat({
    id: messageId,
    eventId: auth.eventId,
    senderId: auth.senderId,
    senderName: '',
    isModerator: false,
    text: '',
    createdAt: new Date().toISOString(),
    op: 'reaction',
    reactions,
  });

  return NextResponse.json({ reactions, mine: !existing });
});
