import { cookies } from 'next/headers';
import { z } from 'zod';

import { eventScope, requireStaff } from '@/lib/auth/staff-session';
import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { prisma } from '@/lib/db';
import { ValidationError } from '@/lib/errors';
import { closeOpenSessions } from '@/lib/events/call-sessions';

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

  // Archiviare un evento ancora in servizio (LIVE, in pausa, in
  // preparazione) chiude anche le sue sessioni di chiamata, nella stessa
  // transazione: altrimenti resterebbero senza fine (lib/events/call-sessions).
  // Quelle di un evento già concluso le chiude il giro del ciclo di vita, con
  // un orario stimato sulla chiusura invece che su adesso.
  const where = { id: { in: parsed.data.ids }, ...eventScope(session) };
  const result = await prisma.$transaction(async (tx) => {
    const targets = await tx.event.findMany({ where, select: { id: true, status: true } });
    const archived = await tx.event.updateMany({ where, data: { status: 'ARCHIVED' } });
    await closeOpenSessions(
      tx,
      targets.filter((e) => e.status !== 'ENDED' && e.status !== 'ARCHIVED').map((e) => e.id),
      new Date(),
    );
    return archived;
  });

  await logAdminAction({
    request,
    action: 'EVENT_BULK_ARCHIVE',
    details: { ids: parsed.data.ids, archived: result.count },
  });

  return Response.json({ archived: result.count });
});
