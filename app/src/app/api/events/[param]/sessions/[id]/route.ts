// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { withErrorHandling } from '@/lib/api-handler';
import { ForbiddenError, NotFoundError } from '@/lib/errors';
import { prisma } from '@/lib/db';
import { extractModeratorToken } from '@/lib/auth/moderator';
import { CAMPI_VIDEO_VUOTI } from '@/lib/events/recording-fields';
import { deleteRecordingBlob } from '@/lib/storage/recordings';
import { tryDecryptJSON } from '@/lib/crypto/pii';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withErrorHandling(async (request, context) => {
  const { param, id } = await context.params;
  const token = extractModeratorToken(request);
  if (!token) throw new ForbiddenError('Moderator token required');

  const isUuid = UUID_RE.test(param);
  const event = await prisma.event.findFirst({
    where: {
      ...(isUuid ? { OR: [{ id: param }, { slug: param }] } : { slug: param }),
      moderatorToken: token,
    },
    select: { id: true },
  });
  if (!event) throw new NotFoundError('Event');

  if (!UUID_RE.test(id)) throw new NotFoundError('CallSession');

  const session = await prisma.callSession.findFirst({
    where: { id, eventId: event.id },
  });
  if (!session) throw new NotFoundError('CallSession');

  return Response.json({
    id: session.id,
    jitsiRoomName: session.jitsiRoomName,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
    duration: session.duration,
    peakParticipants: session.peakParticipants,
    participants: tryDecryptJSON(session.participants, []),
    recordingUrl: session.recordingUrl,
    recordingFileSize: session.recordingFileSize
      ? Number(session.recordingFileSize)
      : null,
    recordingDuration: session.recordingDuration,
    recordingFilename: session.recordingFilename,
    telemetry: session.telemetry,
    createdAt: session.createdAt.toISOString(),
  });
});

export const DELETE = withErrorHandling(async (request, context) => {
  const { param, id } = await context.params;
  const token = extractModeratorToken(request);
  if (!token) throw new ForbiddenError('Moderator token required');

  const isUuid = UUID_RE.test(param);
  const event = await prisma.event.findFirst({
    where: {
      ...(isUuid ? { OR: [{ id: param }, { slug: param }] } : { slug: param }),
      moderatorToken: token,
    },
    select: { id: true, recordingUrl: true },
  });
  if (!event) throw new NotFoundError('Event');

  if (!UUID_RE.test(id)) throw new NotFoundError('CallSession');

  const session = await prisma.callSession.findFirst({
    where: { id, eventId: event.id },
    select: { id: true, recordingUrl: true, recording: { select: { id: true } } },
  });
  if (!session) throw new NotFoundError('CallSession');

  // Se il file tolto e' quello pubblicato sull'evento, la pagina non deve piu'
  // puntarci. La cancellazione di una registrazione resta tracciata, anche
  // quando la sessione aveva solo la riga della registrazione: va via a cascata.
  const eraPubblicato =
    !!session.recordingUrl && session.recordingUrl === event.recordingUrl;
  await prisma.$transaction([
    prisma.callSession.delete({ where: { id: session.id } }),
    ...(eraPubblicato
      ? [
          prisma.event.update({
            where: { id: event.id },
            data: CAMPI_VIDEO_VUOTI,
          }),
        ]
      : []),
    ...(session.recordingUrl || session.recording
      ? [
          prisma.gdprAuditLog.create({
            data: {
              eventId: event.id,
              action: 'RECORDING_DELETED',
              recordCount: 1,
              details: JSON.stringify({
                callSession: session.id,
                wasEventRecording: eraPubblicato,
              }),
            },
          }),
        ]
      : []),
  ]);

  // Dopo la transazione: se fallisse, il file c'e' ancora e la pagina continua a
  // funzionare. Il file si cancella dallo storage delle registrazioni partendo
  // dall'URL salvato. Se resta, la riconciliazione lo trova come orfano.
  if (session.recordingUrl) {
    try {
      await deleteRecordingBlob(session.recordingUrl);
    } catch (err) {
      console.error('[sessions DELETE] blob delete failed:', err);
    }
  }

  return Response.json({ deleted: true });
});
