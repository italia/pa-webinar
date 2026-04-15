/**
 * Internal endpoint called by the Jibri finalize script to obtain a
 * short-lived write-SAS URL for uploading a freshly recorded mp4 to
 * object storage. Keeps the storage account key out of the Jibri pod.
 *
 * Request:
 *   POST /api/internal/recording-upload-url
 *   x-api-key: <CRON_API_KEY>
 *   { "roomName": "call-xxx", "filename": "call-xxx_2026-04-15_23-21.mp4" }
 *
 * Response:
 *   { "uploadUrl": "<blob-url>?<sas>", "recordingUrl": "<blob-url>" }
 *
 * The SAS is scoped to this single blob with create+write permissions
 * and a 30-minute expiry — enough for a large file upload without
 * leaving a long-lived token on the Jibri host.
 */

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { assertCronApiKey } from '@/lib/auth/cron';
import { ValidationError } from '@/lib/errors';
import { generateRecordingUploadUrl } from '@/lib/storage/recordings';

export const dynamic = 'force-dynamic';

const SAS_EXPIRY_MINUTES = 30;

export const POST = withErrorHandling(async (request) => {
  assertCronApiKey(request);

  const body = (await parseJsonBody(request)) as Record<string, unknown>;
  const filename = typeof body.filename === 'string' ? body.filename : '';
  const roomName = typeof body.roomName === 'string' ? body.roomName : '';

  if (!filename || !roomName) {
    throw new ValidationError('roomName and filename are required');
  }

  // Prevent path traversal — the SAS is scoped per blob, but sanitising
  // the filename keeps the resulting URL predictable and defends against
  // a compromised Jibri from uploading to arbitrary blob paths.
  if (filename.includes('/') || filename.includes('..')) {
    throw new ValidationError('filename must not contain path separators');
  }

  const result = await generateRecordingUploadUrl(filename, SAS_EXPIRY_MINUTES);

  if (!result) {
    return Response.json(
      { error: 'recording storage is not configured' },
      { status: 503 },
    );
  }

  return Response.json({
    uploadUrl: result.uploadUrl,
    recordingUrl: result.recordingUrl,
    expiresInMinutes: SAS_EXPIRY_MINUTES,
  });
});
