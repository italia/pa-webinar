// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { cookies } from 'next/headers';

import { withErrorHandling } from '@/lib/api-handler';
import { NotFoundError, ForbiddenError } from '@/lib/errors';
import { prisma } from '@/lib/db';
import {
  extractModeratorToken,
  constantTimeEqual,
} from '@/lib/auth/moderator';
import {
  generateRecordingSasUrl,
  deleteRecordingBlob,
  fileDelloStorage,
} from '@/lib/storage/recordings';
import { CAMPI_VIDEO_VUOTI, sessioniSenzaFile } from '@/lib/events/recording-fields';
import { accessoRegistrazioneConStaff } from '@/lib/recording/audience';
import { tracciaLetturaContenuto } from '@/lib/recording/content-access';

export const dynamic = 'force-dynamic';

// Short-lived read-SAS so the browser can keep a long download / seek
// session open on a single-hour recording (≤1 GB MsTeams export at
// 720p fits with room to spare).
const PLAYBACK_SAS_EXPIRY_MINUTES = 120;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withErrorHandling(async (_request, context) => {
  const { param } = await context.params;
  const isUuid = UUID_RE.test(param);

  const event = await prisma.event.findFirst({
    where: isUuid
      ? { OR: [{ id: param }, { slug: param }] }
      : { slug: param },
    select: {
      id: true,
      recordingUrl: true,
      status: true,
      eventType: true,
      recordingPublished: true,
      transcriptPublished: true,
      recordingAudience: true,
      recordingDestination: true,
      postEventPublic: true,
      postEventPublicUntil: true,
    },
  });

  if (!event?.recordingUrl) throw new NotFoundError('Recording');
  if (event.status !== 'ENDED' && event.status !== 'ARCHIVED') {
    throw new ForbiddenError('Recording not yet available');
  }
  // Chi puo' vedere la registrazione (lib/recording/audience): pubblicata nella
  // finestra post-evento, per tutti o per i soli iscritti; lo staff che
  // organizza l'evento anche prima, per l'anteprima della pagina; di una
  // chiamata rapida, chi era in sala (pass di presenza) e chi la organizza.
  const { accesso, staff } = await accessoRegistrazioneConStaff(event, await cookies());
  const senzaPubblicazione =
    accesso === 'staff' || (accesso === 'presente' && event.eventType === 'INSTANT');
  if (!accesso || (!event.recordingPublished && !senzaPubblicazione)) {
    throw new ForbiddenError('Recording not published');
  }
  if (staff) {
    await tracciaLetturaContenuto({ ...staff, eventId: event.id, recordingId: null, superficie: 'video' });
  }

  // 302 to a signed blob URL so the browser streams directly from
  // Azure (range requests, no bandwidth through our pod) while the
  // private-container permission is still enforced by SAS. Only the
  // event's own files are signed (lib/storage/recordings): a URL that
  // points to another event's file answers 404, never a redirect to it.
  // An external URL (not a file of our storage) is followed as stored.
  const signed = await generateRecordingSasUrl(
    event.recordingUrl,
    PLAYBACK_SAS_EXPIRY_MINUTES,
    event.id,
  ).catch(() => null);
  if (!signed && fileDelloStorage(event.recordingUrl)) {
    throw new NotFoundError('Recording');
  }

  // Chi viene rimandato dipende dalla richiesta: niente cache condivise.
  return new Response(null, {
    status: 302,
    headers: { Location: signed ?? event.recordingUrl, 'Cache-Control': 'private, no-store' },
  });
});

export const DELETE = withErrorHandling(async (request, context) => {
  const { param } = await context.params;
  const isUuid = UUID_RE.test(param);

  const token = extractModeratorToken(request);
  if (!token) throw new ForbiddenError('Moderator token required');

  const event = await prisma.event.findFirst({
    where: isUuid
      ? { OR: [{ id: param }, { slug: param }] }
      : { slug: param },
    select: {
      id: true,
      moderatorToken: true,
      recordingUrl: true,
      tempRecordingUrl: true,
      recordingPublished: true,
    },
  });

  if (!event) throw new NotFoundError('Event');
  if (!constantTimeEqual(event.moderatorToken, token)) {
    throw new ForbiddenError('Invalid moderator token');
  }

  // Delete the actual blobs from the RECORDINGS storage domain, keyed off the
  // stored URL (the published recording and any temp upload). Best-effort: the
  // DB scrub below must still run even if a blob delete fails, so a storage
  // hiccup can't block GDPR erasure.
  for (const recordingUrl of [event.recordingUrl, event.tempRecordingUrl]) {
    if (!recordingUrl) continue;
    try {
      await deleteRecordingBlob(recordingUrl);
    } catch (err) {
      console.error('[recording DELETE] blob delete failed:', err);
    }
  }

  await prisma.$transaction([
    prisma.event.update({
      where: { id: event.id },
      data: {
        ...CAMPI_VIDEO_VUOTI,
        tempRecordingUrl: null,
        tempRecordingStartedAt: null,
        // Cio' che resta (trascrizioni, sintesi) ha la durata della
        // registrazione: tolto il video pubblicato, conta al piu' presto da
        // adesso, non dalla fine dell'evento (lib/gdpr/cleanup-selection).
        ...(event.recordingPublished && { recordingRetentionFrom: new Date() }),
      },
    }),
    ...(event.recordingUrl
      ? [prisma.callSession.updateMany(sessioniSenzaFile(event.id, event.recordingUrl))]
      : []),
    prisma.gdprAuditLog.create({
      data: {
        eventId: event.id,
        action: 'RECORDING_DELETED',
        recordCount: 1,
        details: JSON.stringify({
          hadRecordingUrl: !!event.recordingUrl,
          hadTempRecordingUrl: !!event.tempRecordingUrl,
        }),
      },
    }),
  ]);

  return Response.json({ deleted: true });
});
