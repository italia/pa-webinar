/**
 * Issue a short-lived SAS write URL so the browser can upload a
 * video directly to our Azure Blob container, bypassing our Next.js
 * server entirely (no egress bottleneck, no 5xx risk on large files).
 *
 * Expected flow:
 *   1. Admin opens /admin/publications/new, picks an MP4 / WebM /
 *      MOV file.
 *   2. Client GETs /api/admin/publications/upload-url?filename=...
 *      which returns { uploadUrl, recordingUrl }.
 *   3. Client uploads to `uploadUrl` via the Azure SDK's
 *      BlockBlobClient (multi-block so 500 MiB+ files work).
 *   4. Client POSTs metadata + `recordingUrl` to
 *      /api/admin/publications which creates the LEGACY Event.
 *
 * The SAS is scoped to a single blob name and expires in 60 minutes —
 * enough for a 1-hour MsTeams export on a residential uplink, short
 * enough to limit the blast radius if a log with the SAS leaks.
 */

import { randomUUID } from 'crypto';
import { cookies } from 'next/headers';

import { withErrorHandling } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { AppError, UnauthorizedError } from '@/lib/errors';
import {
  generateRecordingUploadUrl,
  isRecordingStorageConfigured,
} from '@/lib/storage/recordings';

export const dynamic = 'force-dynamic';

const SAS_EXPIRY_MINUTES = 60;
const ALLOWED_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v']);

// `publications/<year>/<uuid>.<ext>` groups uploads by year so the
// Azure Storage browser stays navigable as the archive grows.
function buildObjectName(originalName: string): string {
  const dot = originalName.lastIndexOf('.');
  const extRaw = dot >= 0 ? originalName.slice(dot + 1).toLowerCase() : '';
  const ext = ALLOWED_EXTENSIONS.has(extRaw) ? extRaw : 'mp4';
  const year = new Date().getUTCFullYear();
  return `publications/${year}/${randomUUID()}.${ext}`;
}

export const GET = withErrorHandling(async (request) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  if (!isRecordingStorageConfigured()) {
    throw new AppError(
      'Recording storage not configured',
      503,
      'STORAGE_UNAVAILABLE',
    );
  }

  const url = new URL(request.url);
  const filename = url.searchParams.get('filename')?.trim();
  if (!filename) {
    throw new AppError('Missing `filename` query parameter', 400, 'BAD_REQUEST');
  }

  const objectName = buildObjectName(filename);
  const result = await generateRecordingUploadUrl(objectName, SAS_EXPIRY_MINUTES);
  if (!result) {
    throw new AppError(
      'Unable to generate upload URL',
      500,
      'STORAGE_ERROR',
    );
  }

  return Response.json({
    uploadUrl: result.uploadUrl,
    recordingUrl: result.recordingUrl,
    objectName,
    expiresInSeconds: SAS_EXPIRY_MINUTES * 60,
  });
});
