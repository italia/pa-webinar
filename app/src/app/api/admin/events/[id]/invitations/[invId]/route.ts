/**
 * Admin: single invitation.
 *
 *   PATCH  — edit name / role / email / linked person
 *   DELETE — remove the row (and its token if already minted)
 */

import { cookies } from 'next/headers';
import { z } from 'zod';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { encryptPII, hashEmail, tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { AppError, UnauthorizedError, ValidationError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const patchSchema = z.object({
  email: z.string().email().max(200).optional(),
  name: z.string().min(1).max(200).nullable().optional(),
  role: z.enum(['GUEST', 'SPEAKER']).optional(),
  personId: z.string().uuid().nullable().optional(),
});

async function requireBelongs(eventId: string, invId: string) {
  if (!UUID_RE.test(eventId) || !UUID_RE.test(invId)) {
    throw new AppError('UUIDs required', 400, 'BAD_REQUEST');
  }
  const row = await prisma.eventInvitation.findUnique({ where: { id: invId } });
  if (!row || row.eventId !== eventId) {
    throw new AppError('Invitation not found', 404, 'NOT_FOUND');
  }
  return row;
}

export const PATCH = withErrorHandling(async (request, context) => {
  if (!(await isAdminAuthenticated(await cookies()))) throw new UnauthorizedError();
  const { id, invId } = await context.params;
  await requireBelongs(id, invId);

  const body = await parseJsonBody(request);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }

  const data: Record<string, unknown> = { ...parsed.data };
  if (typeof data.email === 'string') {
    const emailNorm = (data.email as string).trim().toLowerCase();
    data.email = encryptPII(emailNorm);
    data.emailHash = hashEmail(emailNorm);
  }

  try {
    const updated = await prisma.eventInvitation.update({
      where: { id: invId },
      data,
    });

    await logAdminAction({
      request,
      action: 'EVENT_INVITATION_UPDATE',
      target: updated.id,
      details: { fields: Object.keys(parsed.data) },
    });

    return Response.json({ ...updated, email: tryDecryptPII(updated.email) });
  } catch (e: unknown) {
    if (typeof e === 'object' && e && 'code' in e && (e as { code: string }).code === 'P2002') {
      throw new AppError('Another invitation for this event already uses that email', 409, 'CONFLICT');
    }
    throw e;
  }
});

export const DELETE = withErrorHandling(async (request, context) => {
  if (!(await isAdminAuthenticated(await cookies()))) throw new UnauthorizedError();
  const { id, invId } = await context.params;
  await requireBelongs(id, invId);

  await prisma.eventInvitation.delete({ where: { id: invId } });

  await logAdminAction({
    request,
    action: 'EVENT_INVITATION_DELETE',
    target: invId,
  });

  return Response.json({ deleted: true, id: invId });
});
