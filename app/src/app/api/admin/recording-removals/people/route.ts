// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * GET /api/admin/recording-removals/people?recordingId=
 *
 * Chi era in sala mentre la registrazione girava, raggruppato per persona
 * (lib/recording/redaction/people), per riconoscere chi chiede di essere tolto.
 * Nomi e orari di ingresso e uscita: gli stessi che l'amministrazione vede
 * fra gli iscritti, non il contenuto della registrazione.
 */
import { cookies } from 'next/headers';

import { withErrorHandling } from '@/lib/api-handler';
import { requireAdmin } from '@/lib/auth/staff-session';
import { ValidationError } from '@/lib/errors';
import { personeDellaRegistrazione } from '@/lib/recording/redaction/people';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withErrorHandling(async (request) => {
  await requireAdmin(await cookies());
  const recordingId = new URL(request.url).searchParams.get('recordingId') ?? '';
  if (!UUID_RE.test(recordingId)) throw new ValidationError('recordingId must be a UUID');
  const persone = await personeDellaRegistrazione(recordingId);
  return Response.json({
    people: persone.map(({ endpointIds: _endpoint, ...p }) => p),
  });
});
