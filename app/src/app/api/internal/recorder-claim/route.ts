/**
 * POST /api/internal/recorder-claim  (ADR-013 Fase 3)
 *
 * Il recorder, all'avvio, reclama lo specifico recording che l'operator gli
 * ha assegnato (env RECORDING_ID) e riceve il work-order: il JWT bot per
 * entrare in stanza (receive-only) e il nome stanza. ingestUrl e
 * upload-url-endpoint il recorder li costruisce dalla sua `PORTAL_URL`.
 *
 * Il bot entra come `member` (non moderatore); la natura receive-only è
 * imposta dal recorder stesso (lib-jitsi-meet `startSilent`). Le credenziali
 * non vivono nell'operator: vengono coniate qui, al claim.
 *
 * Auth: CRON_API_KEY (header x-api-key).
 */

import { z } from 'zod';

import { withErrorHandling } from '@/lib/api-handler';
import { assertCronApiKey } from '@/lib/auth/cron';
import { prisma } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { generateJitsiJwt } from '@/lib/auth/jwt';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ recordingId: z.string().uuid() });

export const POST = withErrorHandling(async (request) => {
  assertCronApiKey(request);

  const { recordingId } = bodySchema.parse(await request.json());

  const recording = await prisma.recording.findUnique({
    where: { id: recordingId },
    select: {
      id: true,
      eventId: true,
      event: { select: { jitsiRoomName: true, endsAt: true } },
    },
  });
  if (!recording) throw new NotFoundError('Recording');

  const roomName = recording.event.jitsiRoomName;
  // TTL del JWT bot legato alla durata residua dell'evento (+30min di
  // margine), così su eventi lunghi il bot non si disconnette a metà (il
  // default participant sarebbe 90min). Cap a 6h = activeDeadlineSeconds
  // del Job recorder; minimo 10min.
  const remainingSec = Math.ceil(
    (recording.event.endsAt.getTime() - Date.now()) / 1000,
  );
  const expiresInSeconds = Math.min(
    Math.max(remainingSec + 30 * 60, 10 * 60),
    6 * 60 * 60,
  );
  const jwt = await generateJitsiJwt({
    roomName,
    displayName: '📼 Recorder',
    // uniqueId stabile per recording → Jitsi lo tratta come un endpoint solo.
    uniqueId: `rec-bot-${recording.id}`,
    isModerator: false,
    expiresInSeconds,
  });

  return Response.json({
    recordingId: recording.id,
    eventId: recording.eventId,
    roomName,
    jwt,
  });
});
