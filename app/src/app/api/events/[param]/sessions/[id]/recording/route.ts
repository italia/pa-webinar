// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * GET /api/events/[param]/sessions/[id]/recording
 *
 * Il file registrato in una sessione della sala (CallSession.recordingUrl),
 * per chi organizza l'evento: 302 a un indirizzo firmato e di breve durata
 * dello storage. Al browser non arriva mai l'indirizzo canonico del file: gli
 * elenchi dell'amministrazione e il pannello delle sessioni puntano qui.
 *
 * Solo l'organizzatore (lib/recording/content-access), con la lettura
 * tracciata nel registro GDPR dell'evento. Il video pubblicato dell'evento
 * passa da `/api/events/[param]/recording`, con le regole del pubblico.
 */

import { cookies } from 'next/headers';

import { withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { eventParamWhere } from '@/lib/events/event-param';
import {
  requireEventContent,
  tracciaLetturaContenuto,
} from '@/lib/recording/content-access';
import { fileDelloStorage, generateRecordingSasUrl } from '@/lib/storage/recordings';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PLAYBACK_SAS_EXPIRY_MINUTES = 120;

export const GET = withErrorHandling(async (_request, context) => {
  const { param, id } = (await context.params) as { param: string; id: string };
  if (!UUID_RE.test(id)) throw new NotFoundError('CallSession');

  const event = await prisma.event.findFirst({
    where: eventParamWhere(param),
    select: { id: true },
  });
  if (!event) throw new NotFoundError('Event');

  const accesso = await requireEventContent(await cookies(), event.id, 'video');

  const session = await prisma.callSession.findFirst({
    where: { id, eventId: event.id },
    select: { id: true, recordingUrl: true, recording: { select: { id: true } } },
  });
  if (!session?.recordingUrl) throw new NotFoundError('Recording');

  const signed = await generateRecordingSasUrl(
    session.recordingUrl,
    PLAYBACK_SAS_EXPIRY_MINUTES,
    event.id
  ).catch(() => null);
  if (!signed && fileDelloStorage(session.recordingUrl))
    throw new NotFoundError('Recording');

  await tracciaLetturaContenuto({
    ...accesso,
    recordingId: session.recording?.id ?? null,
    superficie: 'video',
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: signed ?? session.recordingUrl,
      'Cache-Control': 'private, no-store',
    },
  });
});
