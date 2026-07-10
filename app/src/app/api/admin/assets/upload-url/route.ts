/**
 * Admin-only server-side asset upload.
 *
 * The admin form (e.g. FileOrUrlInput) posts a multipart/form-data body
 * with a single `file` field and a `?type=image|audio|document` query
 * hint. We validate size + MIME, compute a predictable object key under
 * `assets/{type}/{yyyy}/{mm}/...`, and write the bytes to the "files"
 * storage domain. The response carries the canonical public URL that
 * the parent form should persist.
 *
 * Why server-side (not a presigned PUT)?
 *   - These are small assets (logos, splash audio, flyers): routing
 *     through the Next app keeps the client code trivial and lets us
 *     enforce MIME/size centrally, without trusting the browser.
 *   - Large media (recordings) still use the presigned-PUT flow in
 *     /api/admin/publications/upload-url.
 *
 * Security notes:
 *   - Gated by the `admin_session` JWT cookie (same as every /admin API),
 *     plus a per-IP rate limit.
 *   - MIME is validated in two stages: the declared `file.type` must be in
 *     the allow-list for the requested `type`, AND the file's real magic
 *     bytes must match that declared type (contentMatchesDeclaredMime).
 *     Extension is not trusted.
 *   - Size is capped three ways: an early Content-Length pre-check (before
 *     buffering), the File#size, and a post-read byte-length check.
 *   - Uploads land in a PRIVATE container and are served back through
 *     /api/assets with nosniff + attachment-for-non-inline-safe headers.
 */

import { randomUUID } from 'crypto';

import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';

import { withErrorHandling } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { logAdminAction } from '@/lib/audit/admin-audit';
import {
  AppError,
  RateLimitError,
  UnauthorizedError,
  ValidationError,
} from '@/lib/errors';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { getFilesStorage } from '@/lib/storage';
import { getPublicEnv } from '@/lib/env';
import {
  buildAssetKey,
  sanitizeFilename,
  type AssetType,
} from '@/lib/utils/asset-key';
import { contentMatchesDeclaredMime } from '@/lib/utils/mime-sniff';

export const dynamic = 'force-dynamic';

type AssetKind = AssetType;

const ALLOWED_MIME: Record<AssetKind, ReadonlySet<string>> = {
  image: new Set([
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/svg+xml',
    'image/gif',
  ]),
  audio: new Set([
    'audio/mpeg',
    'audio/wav',
    'audio/ogg',
    'audio/mp4',
    'audio/webm',
  ]),
  document: new Set([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'text/plain',
  ]),
};

// Caps in bytes (MiB-based to match object-store dashboards).
const MAX_SIZE: Record<AssetKind, number> = {
  image: 10 * 1024 * 1024,
  audio: 20 * 1024 * 1024,
  document: 25 * 1024 * 1024,
};

function assertAssetKind(raw: string | null): AssetKind {
  if (raw === 'image' || raw === 'audio' || raw === 'document') return raw;
  throw new ValidationError(
    'Query parameter `type` must be one of: image, audio, document',
  );
}

export const POST = withErrorHandling(async (request: NextRequest) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const ip = getClientIp(request);
  const rl = rateLimit(`asset-upload:${ip}`, { limit: 30, windowMs: 60_000 });
  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  }

  const url = new URL(request.url);
  const type = assertAssetKind(url.searchParams.get('type'));

  // Reject oversized bodies BEFORE buffering the whole multipart payload into
  // memory. Content-Length includes multipart framing overhead, so allow a
  // small margin over the type's byte cap.
  const declaredLen = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declaredLen) && declaredLen > MAX_SIZE[type] + 4096) {
    throw new AppError(
      `File too large: declared ${declaredLen} bytes exceeds ${MAX_SIZE[type]} byte cap for assetType=${type}`,
      413,
      'PAYLOAD_TOO_LARGE',
    );
  }

  const storage = getFilesStorage();
  if (!storage) {
    throw new AppError(
      'Files storage is not configured on this instance. Set STORAGE_FILES_* or AZURE_STORAGE_* env vars.',
      503,
      'STORAGE_UNAVAILABLE',
    );
  }

  // Parse multipart/form-data. Next's route handlers accept Request.formData()
  // out of the box; it handles File / Blob fields natively.
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new AppError(
      'Request body must be multipart/form-data',
      400,
      'BAD_REQUEST',
    );
  }

  const fileField = form.get('file');
  if (!(fileField instanceof File)) {
    throw new ValidationError('Missing `file` field in form data');
  }

  const mime = fileField.type || 'application/octet-stream';
  const allowedForType = ALLOWED_MIME[type];
  if (!allowedForType.has(mime)) {
    throw new AppError(
      `MIME type "${mime}" is not allowed for assetType=${type}. Allowed: ${Array.from(
        allowedForType,
      ).join(', ')}`,
      415,
      'UNSUPPORTED_MEDIA_TYPE',
    );
  }

  const maxBytes = MAX_SIZE[type];
  if (fileField.size > maxBytes) {
    throw new AppError(
      `File too large: ${fileField.size} bytes exceeds ${maxBytes} byte cap for assetType=${type}`,
      413,
      'PAYLOAD_TOO_LARGE',
    );
  }

  // Read bytes — File#arrayBuffer already materialises the upload in memory,
  // which is acceptable given the caps above (≤ 25 MiB).
  const arrayBuffer = await fileField.arrayBuffer();
  // Double-check the actual size (defense-in-depth against spoofed Content-Length).
  if (arrayBuffer.byteLength > maxBytes) {
    throw new AppError(
      `File too large after read: ${arrayBuffer.byteLength} byte cap for assetType=${type}`,
      413,
      'PAYLOAD_TOO_LARGE',
    );
  }
  const buffer = Buffer.from(arrayBuffer);

  // Defense-in-depth: the declared MIME is client-controlled and was only
  // checked against the allow-list above. Sniff the real magic bytes and
  // reject a mismatch so arbitrary content can't masquerade as an allowed type.
  if (!contentMatchesDeclaredMime(buffer, mime)) {
    throw new AppError(
      `File content does not match declared MIME type "${mime}"`,
      415,
      'UNSUPPORTED_MEDIA_TYPE',
    );
  }

  const originalName = fileField.name || 'upload';
  const key = buildAssetKey(type, originalName, { uuid: randomUUID() });

  try {
    await storage.put(key, buffer, mime);
  } catch (err) {
    console.error('[assets/upload-url] storage.put failed:', err);
    throw new AppError(
      'Failed to write file to object storage',
      502,
      'STORAGE_WRITE_FAILED',
    );
  }

  // Persist a STABLE, app-served URL rather than the bare blob URL: the files
  // container is private (the storage account has public blob access disabled),
  // so /api/assets/<key> streams the blob through a short server-side SAS. We
  // strip the `assets/` prefix here because the serving route re-adds it (and
  // only ever serves that prefix). Absolute when NEXT_PUBLIC_APP_URL is set so
  // the value works as an og:image too.
  // Always absolute: consumers persist this via schemas that require an
  // absolute URL (materials, site settings). Prefer the configured public
  // origin; fall back to the request origin when NEXT_PUBLIC_APP_URL is unset
  // so dev/test deployments don't produce a relative URL the DB layer rejects.
  const appBase =
    getPublicEnv('NEXT_PUBLIC_APP_URL').replace(/\/+$/, '') ||
    new URL(request.url).origin;
  const servePath = `/api/assets/${key.replace(/^assets\//, '')}`;
  const servedUrl = `${appBase}${servePath}`;

  await logAdminAction({
    request,
    action: 'ASSET_UPLOAD',
    target: key,
    details: { type, mime, size: buffer.byteLength },
  });

  return Response.json({
    url: servedUrl,
    key,
    mime,
    size: buffer.byteLength,
    filename: sanitizeFilename(originalName),
  });
});
