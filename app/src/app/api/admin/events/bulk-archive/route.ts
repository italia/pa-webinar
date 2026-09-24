import { cookies } from 'next/headers';
import { z } from 'zod';

import { eventScope, requireStaff } from '@/lib/auth/staff-session';
import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { prisma } from '@/lib/db';
import { ValidationError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const bulkArchiveSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
});

export const POST = withErrorHandling(async (request) => {
  // L'organizzatore agisce solo sui propri eventi: gli altri identificativi
  // della selezione restano fuori dal filtro, e il conteggio lo dice (ADR-014).
  const session = await requireStaff(await cookies());

  const body = await parseJsonBody(request);
  const parsed = bulkArchiveSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }

  const result = await prisma.event.updateMany({
    where: { id: { in: parsed.data.ids }, ...eventScope(session) },
    data: { status: 'ARCHIVED' },
  });

  await logAdminAction({
    request,
    action: 'EVENT_BULK_ARCHIVE',
    details: { ids: parsed.data.ids, archived: result.count },
  });

  return Response.json({ archived: result.count });
});
