/**
 * Chat attachment upload (two-phase: this returns a served URL the client then
 * references in POST /chat).
 *
 * SECURITY — this is the highest-risk surface of the chat feature, so it is
 * deliberately stricter than the message POST:
 *   - AUTHENTICATED MEMBERS ONLY. A token must resolve to a moderator/speaker
 *     grant or a registered participant (resolveTokenSender). Tokenless guests
 *     — who CAN post text on a LIVE event — can NOT upload files, so a stranger
 *     can't drop binaries on a public-sector site.
 *   - Conservative MIME allow-list (images + PDF), enforced against the real
 *     magic bytes (not just the declared type), plus a size cap and an early
 *     Content-Length pre-check.
 *   - Per-sender rate limit distinct from the message limit.
 *   - Il blob finisce nel namespace `assets/chat/<eventId>/…`, che
 *     /api/assets serve solo a chi supera authorizeChatRead: la lettura è
 *     stretta quanto la scrittura, non protetta dalla sola non-indovinabilità
 *     dell'UUID.
 * There is no malware scanner in the stack; the authenticated-only gate + tight
 * allow-list + attachment-disposition serving are the compensating controls.
 */

import { randomUUID } from 'crypto';

import { NextResponse } from 'next/server';

import { withErrorHandling } from '@/lib/api-handler';
import { extractModeratorToken } from '@/lib/auth/moderator';
import {
  CHAT_ATTACHMENT_MIME,
  CHAT_ATTACHMENT_MAX_BYTES,
  assetUrlFromKey,
} from '@/lib/chat/attachments';
import { issueChatAttachmentToken } from '@/lib/chat/attachment-token';
import { resolveTokenSender } from '@/lib/chat/sender';
import { prisma } from '@/lib/db';
import { AppError, ForbiddenError, RateLimitError, ValidationError } from '@/lib/errors';
import { rateLimit } from '@/lib/rate-limit';
import { getFilesStorage } from '@/lib/storage';
import { buildChatAssetKey, sanitizeFilename } from '@/lib/utils/asset-key';
import { contentMatchesDeclaredMime } from '@/lib/utils/mime-sniff';

export const dynamic = 'force-dynamic';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST = withErrorHandling(async (request, context) => {
  const { param } = await context.params;
  const token = extractModeratorToken(request);
  if (!token) throw new ForbiddenError('Attachments require a token');

  const where = UUID_RE.test(param) ? { id: param } : { slug: param };
  const event = await prisma.event.findUnique({
    where,
    select: { id: true, moderatorToken: true, moderatorName: true },
  });
  if (!event) throw new AppError('Event not found', 404, 'NOT_FOUND');

  // Authenticated members only (moderator/speaker grant or a registered
  // participant). resolveTokenSender bakes in the F7 gate and returns the same
  // reg-<id> seat the chat POST will (so the signed attachment token binds); a
  // forwarded-link opener can still upload, but the message it attaches to is
  // named from the opener's typed name — no registrant name leaks. Tokenless
  // guests resolve to null → 403 below.
  const sender = await resolveTokenSender(event, token);
  if (!sender) {
    throw new ForbiddenError('Attachments require a participant or moderator token');
  }

  const rl = rateLimit(`chat-attach:${event.id}:${sender.senderId}`, {
    limit: 10,
    windowMs: 60_000,
  });
  if (!rl.allowed) throw new RateLimitError((rl.resetAt - Date.now()) / 1000);

  const storage = getFilesStorage();
  if (!storage) {
    throw new AppError('Files storage is not configured', 503, 'STORAGE_UNAVAILABLE');
  }

  // Early size guard BEFORE buffering the whole body. We require a
  // Content-Length: a browser FormData upload always sets one, so demanding it
  // costs real clients nothing while closing the "omit the header to skip the
  // pre-check, then stream a huge chunked body into memory" bypass. Number(null)
  // and Number('') are NaN/0 respectively — both rejected here.
  const declaredLen = Number(request.headers.get('content-length'));
  if (!Number.isFinite(declaredLen) || declaredLen <= 0) {
    throw new AppError('Content-Length header is required', 411, 'LENGTH_REQUIRED');
  }
  if (declaredLen > CHAT_ATTACHMENT_MAX_BYTES + 4096) {
    throw new AppError('File too large', 413, 'PAYLOAD_TOO_LARGE');
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new AppError('Request body must be multipart/form-data', 400, 'BAD_REQUEST');
  }

  const fileField = form.get('file');
  if (!(fileField instanceof File)) {
    throw new ValidationError('Missing `file` field in form data');
  }

  const mime = fileField.type || 'application/octet-stream';
  if (!CHAT_ATTACHMENT_MIME.has(mime)) {
    throw new AppError(
      `MIME type "${mime}" is not allowed for chat attachments`,
      415,
      'UNSUPPORTED_MEDIA_TYPE',
    );
  }
  if (fileField.size > CHAT_ATTACHMENT_MAX_BYTES) {
    throw new AppError('File too large', 413, 'PAYLOAD_TOO_LARGE');
  }

  const buffer = Buffer.from(await fileField.arrayBuffer());
  if (buffer.byteLength > CHAT_ATTACHMENT_MAX_BYTES) {
    throw new AppError('File too large', 413, 'PAYLOAD_TOO_LARGE');
  }
  if (!contentMatchesDeclaredMime(buffer, mime)) {
    throw new AppError(
      `File content does not match declared MIME type "${mime}"`,
      415,
      'UNSUPPORTED_MEDIA_TYPE',
    );
  }

  const originalName = fileField.name || 'upload';
  // Namespace `assets/chat/<eventId>/…`: è quello che permette a /api/assets di
  // proteggere SOLO gli allegati (stesso gate della lettura chat) lasciando
  // pubblici logo, copertine e materiali. Vedi buildChatAssetKey.
  const key = buildChatAssetKey(event.id, originalName, { uuid: randomUUID() });

  try {
    await storage.put(key, buffer, mime);
  } catch (err) {
    console.error('[chat/attachment] storage.put failed:', err);
    throw new AppError('Failed to write file to storage', 502, 'STORAGE_WRITE_FAILED');
  }

  // The token is the ONLY thing POST /chat trusts: it binds this exact blob key,
  // mime, size and filename to (event, sender), so the message route never has
  // to trust a client-supplied URL or metadata. `url` is returned only for the
  // client's local compose preview.
  const name = sanitizeFilename(originalName);
  const attachmentToken = issueChatAttachmentToken({
    key,
    mime,
    size: buffer.byteLength,
    name,
    eventId: event.id,
    senderId: sender.senderId,
  });

  return NextResponse.json({
    url: assetUrlFromKey(key),
    token: attachmentToken,
    name,
    mime,
    size: buffer.byteLength,
  });
});
