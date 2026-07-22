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

import { z } from 'zod';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { extractModeratorToken, verifyModeratorToken } from '@/lib/auth/moderator';
import { authenticateChatSender } from '@/lib/chat/authenticate';
import { encryptPII } from '@/lib/crypto/pii';
import { publishChat } from '@/lib/chat/pubsub';
import { prisma } from '@/lib/db';
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors';
import { getFilesStorage } from '@/lib/storage';

export const dynamic = 'force-dynamic';

// ChatMessage.id is a Postgres uuid column; a non-UUID path param would make
// Prisma throw (500). Validate up-front and return a clean 404 instead.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DELETE = withErrorHandling(async (request, context) => {
  const { param, messageId } = await context.params;
  if (!UUID_RE.test(messageId)) throw new NotFoundError('Message');
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

const EDIT_WINDOW_MS = 15 * 60_000;

const editSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  guestName: z.string().trim().min(1).max(80).optional(),
  displayNameOverride: z.string().trim().min(1).max(80).optional(),
});

/**
 * PATCH /chat/<messageId> — the AUTHOR corrects their own message.
 *
 * "non posso modificare il messaggio se ho fatto degli errori": until now a typo
 * was permanent, and the only way out was asking a moderator to hide the message.
 *
 * Only the author, only within EDIT_WINDOW_MS, only while the message is
 * visible. The window matters: chat feeds the post-event archive and the AI
 * summary, so a message must stop being rewritable long before anyone quotes it
 * — a correction is for a typo, not for rewriting what you said an hour ago.
 * `editedAt` is set so the UI can say so rather than silently changing history.
 */
export const PATCH = withErrorHandling(async (request, context) => {
  const { param, messageId } = await context.params;
  if (typeof messageId !== 'string' || !UUID_RE.test(messageId)) {
    throw new NotFoundError('Message');
  }

  const body = await parseJsonBody(request);
  const parsed = editSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }

  const auth = await authenticateChatSender(
    param,
    extractModeratorToken(request),
    parsed.data.guestName,
    parsed.data.displayNameOverride,
    request,
  );

  const message = await prisma.chatMessage.findFirst({
    where: { id: messageId, eventId: auth.eventId, hiddenAt: null },
    select: { id: true, senderId: true, createdAt: true },
  });
  if (!message) throw new NotFoundError('Message');

  // Authorship is the whole authorisation here: a moderator gets `hide`, not
  // the ability to put words in someone else's message.
  if (message.senderId !== auth.senderId) {
    throw new ForbiddenError('Not your message');
  }
  if (Date.now() - message.createdAt.getTime() > EDIT_WINDOW_MS) {
    throw new ForbiddenError('Edit window has closed');
  }

  const editedAt = new Date();
  await prisma.chatMessage.update({
    where: { id: messageId },
    data: { text: encryptPII(parsed.data.text), editedAt },
  });

  void publishChat({
    id: messageId,
    eventId: auth.eventId,
    senderId: auth.senderId,
    senderName: auth.senderName,
    isModerator: auth.isModerator,
    text: parsed.data.text,
    createdAt: message.createdAt.toISOString(),
    editedAt: editedAt.toISOString(),
    op: 'edit',
  });

  return NextResponse.json({ ok: true, editedAt: editedAt.toISOString() });
});
