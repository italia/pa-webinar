/**
 * Admin: event invitations (pre-registration list).
 *
 *   GET  — list invitations for the event (includes linked Person if any)
 *   POST — add an invitation (by email; optional personId to link rubrica)
 *
 * Auth: admin session cookie.
 *
 * Tokens for the registration magic link are *not* generated here —
 * they're minted at send-time by a separate endpoint so staging an
 * invitation doesn't commit to emailing it yet.
 */

import { cookies } from 'next/headers';
import { z } from 'zod';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { prisma } from '@/lib/db';
import { AppError, UnauthorizedError, ValidationError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const addSchema = z.object({
  email: z.string().email().max(200),
  name: z.string().min(1).max(200).optional(),
  role: z.enum(['GUEST', 'SPEAKER']).default('GUEST'),
  personId: z.string().uuid().nullable().optional(),
});

async function loadEvent(id: string) {
  if (!UUID_RE.test(id)) throw new AppError('id must be a UUID', 400, 'BAD_REQUEST');
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) throw new AppError('Event not found', 404, 'NOT_FOUND');
  return event;
}

export const GET = withErrorHandling(async (_request, context) => {
  if (!(await isAdminAuthenticated(await cookies()))) throw new UnauthorizedError();
  const { id } = await context.params;
  const event = await loadEvent(id);

  const rows = await prisma.eventInvitation.findMany({
    where: { eventId: event.id },
    include: {
      person: {
        select: { id: true, displayName: true, organization: true, organizationRole: true },
      },
    },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
  });

  return Response.json({ rows });
});

export const POST = withErrorHandling(async (request, context) => {
  if (!(await isAdminAuthenticated(await cookies()))) throw new UnauthorizedError();
  const { id } = await context.params;
  const event = await loadEvent(id);

  const body = await parseJsonBody(request);
  const parsed = addSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }

  // Normalize email for the unique (eventId, email) index.
  const email = parsed.data.email.trim().toLowerCase();

  try {
    const created = await prisma.eventInvitation.create({
      data: {
        eventId: event.id,
        email,
        name: parsed.data.name ?? null,
        role: parsed.data.role,
        personId: parsed.data.personId ?? null,
      },
      include: {
        person: {
          select: { id: true, displayName: true, organization: true, organizationRole: true },
        },
      },
    });
    return Response.json(created, { status: 201 });
  } catch (e: unknown) {
    if (typeof e === 'object' && e && 'code' in e && (e as { code: string }).code === 'P2002') {
      throw new AppError('This email is already invited to the event', 409, 'CONFLICT');
    }
    throw e;
  }
});
