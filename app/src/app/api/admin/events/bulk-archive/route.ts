import { cookies } from 'next/headers';
import { z } from 'zod';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { prisma } from '@/lib/db';
import { UnauthorizedError, ValidationError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const bulkArchiveSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
});

export const POST = withErrorHandling(async (request) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const body = await parseJsonBody(request);
  const parsed = bulkArchiveSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }

  const result = await prisma.event.updateMany({
    where: { id: { in: parsed.data.ids } },
    data: { status: 'ARCHIVED' },
  });

  await logAdminAction({
    request,
    action: 'EVENT_BULK_ARCHIVE',
    details: { ids: parsed.data.ids, archived: result.count },
  });

  return Response.json({ archived: result.count });
});
