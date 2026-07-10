/**
 * Chat message moderation: a moderator hides a message (soft-delete) live.
 *
 *   DELETE /chat/<messageId>  (moderator token required)
 *     - sets hiddenAt/hiddenBy (kept in the archive for compliance, excluded
 *       from /history),
 *     - deletes the attachment blob if any (storage hygiene / GDPR),
 *     - publishes an op:'delete' envelope so every connected client removes the
 *       message without a refresh.
 *
 * Only role=MODERATOR may moderate (verifyModeratorToken excludes speakers).
 */

import { NextResponse } from 'next/server';

import { withErrorHandling } from '@/lib/api-handler';
import { extractModeratorToken, verifyModeratorToken } from '@/lib/auth/moderator';
import { publishChat } from '@/lib/chat/pubsub';
import { prisma } from '@/lib/db';
import { ForbiddenError, NotFoundError } from '@/lib/errors';
import { getFilesStorage } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export const DELETE = withErrorHandling(async (request, context) => {
  const { param, messageId } = await context.params;
  const token = extractModeratorToken(request);
  if (!token) throw new ForbiddenError('Moderator token required');

  const event = await verifyModeratorToken(param, token);
  if (!event) throw new ForbiddenError('Invalid moderator token');

  const message = await prisma.chatMessage.findFirst({
    where: { id: messageId, eventId: event.id },
    select: { id: true, hiddenAt: true, attachmentBlobPath: true },
  });
  if (!message) throw new NotFoundError('Message');

  if (!message.hiddenAt) {
    await prisma.chatMessage.update({
      where: { id: message.id },
      data: { hiddenAt: new Date(), hiddenBy: `mod-${event.id}` },
    });

    // Best-effort blob deletion — don't fail the moderation if storage hiccups.
    if (message.attachmentBlobPath) {
      try {
        const storage = getFilesStorage();
        if (storage) await storage.delete(message.attachmentBlobPath);
      } catch (err) {
        console.error('[chat moderation] attachment delete failed:', err);
      }
    }
  }

  // Tell every connected client to remove it live. Non-essential envelope
  // fields are empty for a delete op — subscribers key off id + op.
  void publishChat({
    id: message.id,
    eventId: event.id,
    senderId: '',
    senderName: '',
    isModerator: false,
    text: '',
    createdAt: new Date(0).toISOString(),
    op: 'delete',
  });

  return NextResponse.json({ hidden: true });
});
