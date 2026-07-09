/**
 * PUT /api/admin/postprod/speakers/[id]
 *
 * Map a diarization speaker (SPEAKER_00, SPEAKER_01, ...) to a real
 * identity. Two modes:
 *   - displayName only: free-text label, no Person link
 *   - personId: link to a rubrica entry (Person table). displayName is
 *               copied from Person.displayName at link time.
 *
 * Setting both clears the previous personId if a new one is provided;
 * passing personId=null + displayName=null clears the mapping.
 */

import { z } from 'zod';
import { cookies } from 'next/headers';

import { withErrorHandling } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { prisma } from '@/lib/db';
import { NotFoundError, UnauthorizedError } from '@/lib/errors';
import { tryDecryptPII } from '@/lib/crypto/pii';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  displayName: z.string().min(1).max(200).nullable(),
  // Optional: when omitted, the existing Person link is left untouched (a
  // plain rename must not drop a previously-mapped rubrica identity). Pass
  // null explicitly to clear the link.
  personId: z.string().uuid().nullable().optional(),
});

export const PUT = withErrorHandling(async (request, context) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const { id } = (await (context as { params: Promise<{ id: string }> }).params);
  const parsed = bodySchema.parse(await request.json());

  const speaker = await prisma.speaker.findUnique({
    where: { id },
    select: { id: true, recordingId: true, diarLabel: true },
  });
  if (!speaker) throw new NotFoundError('Speaker');

  // If linking to a Person, snapshot the displayName so we don't have
  // to read encrypted Person.displayName on every render. We tolerate
  // legacy plaintext via tryDecryptPII.
  let resolvedDisplayName = parsed.displayName;
  if (parsed.personId) {
    const person = await prisma.person.findUnique({
      where: { id: parsed.personId },
      select: { displayName: true },
    });
    if (!person) throw new NotFoundError('Person');
    resolvedDisplayName =
      parsed.displayName ?? tryDecryptPII(person.displayName ?? '') ?? null;
  }

  const updated = await prisma.speaker.update({
    where: { id },
    data: {
      displayName: resolvedDisplayName,
      // Only touch the link when the caller provided personId (undefined =
      // leave as-is; null = clear). Prisma treats `undefined` as no-op.
      ...(parsed.personId !== undefined ? { personId: parsed.personId } : {}),
    },
  });

  await logAdminAction({
    request,
    action: 'POSTPROD_SPEAKER_MAP',
    target: id,
    details: {
      recordingId: speaker.recordingId,
      diarLabel: speaker.diarLabel,
      displayName: resolvedDisplayName,
      personId: updated.personId,
    },
  });

  return Response.json({
    ok: true,
    id: updated.id,
    displayName: updated.displayName,
    personId: updated.personId,
  });
});
