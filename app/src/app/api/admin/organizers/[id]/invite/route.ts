/**
 * POST /api/admin/organizers/:id/invite — manda un nuovo link di accesso
 * (ADR-014). Serve anche come «ho perso il link»: il precedente, se non
 * usato, resta valido fino alla sua scadenza.
 */
import { cookies } from 'next/headers';
import { z } from 'zod';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { inviaLinkAccesso } from '@/lib/auth/staff-login';
import { prisma } from '@/lib/db';
import { NotFoundError, UnauthorizedError, ValidationError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const schema = z.object({ locale: z.string().min(2).max(5).default('it') });

export const POST = withErrorHandling(async (request, context) => {
  if (!(await isAdminAuthenticated(await cookies()))) throw new UnauthorizedError();
  const { id } = await (context as { params: Promise<{ id: string }> }).params;
  if (!UUID_RE.test(id)) throw new NotFoundError('Organizer');
  const parsed = schema.safeParse(await parseJsonBody(request).catch(() => ({})));
  if (!parsed.success) throw new ValidationError('Validation failed');
  const account = await prisma.staffAccount.findUnique({
    where: { id },
    select: { id: true, email: true, name: true, active: true },
  });
  if (!account) throw new NotFoundError('Organizer');
  if (!account.active) throw new ValidationError('organizer_inactive');
  await inviaLinkAccesso(account, parsed.data.locale);
  await logAdminAction({ request, action: 'ORGANIZER_INVITE', target: id });
  return Response.json({ ok: true }, { status: 202 });
});
