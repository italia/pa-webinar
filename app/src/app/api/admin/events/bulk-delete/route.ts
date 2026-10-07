import { cookies } from 'next/headers';
import { z } from 'zod';

import { eventScope, requireStaff } from '@/lib/auth/staff-session';
import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { prisma } from '@/lib/db';
import { ValidationError } from '@/lib/errors';
import { removeFilesOfEventsBeingDeleted } from '@/lib/events/material-files';

export const dynamic = 'force-dynamic';

/** Quanto puo' durare un'eliminazione in blocco: i file nello storage si
 *  cancellano uno a uno, a righe bloccate. */
const BULK_DELETE_TIMEOUT_MS = 120_000;

const bulkDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
});

export const POST = withErrorHandling(async (request) => {
  // L'organizzatore agisce solo sui propri eventi: gli altri identificativi
  // della selezione restano fuori dal filtro, e il conteggio lo dice (ADR-014).
  const session = await requireStaff(await cookies());

  const body = await parseJsonBody(request);
  const parsed = bulkDeleteSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }

  // Gli eventi in diretta restano: hanno persone in sala. Le righe restano
  // bloccate finche' file e righe se ne vanno: un cambio di stato nel
  // frattempo aspetta, e la scelta fatta qui vale per tutta l'operazione
  // (vedi DELETE /api/events/[param]).
  const { deleted, skippedLive } = await prisma.$transaction(
    async (tx) => {
      const candidati = await tx.event.findMany({
        where: { id: { in: parsed.data.ids }, ...eventScope(session) },
        select: { id: true },
      });
      if (candidati.length === 0) return { deleted: 0, skippedLive: 0 };
      const righe = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id::text AS id, status::text AS status FROM events
        WHERE id = ANY(${candidati.map((c) => c.id)}::uuid[])
        FOR NO KEY UPDATE`;
      const daEliminare = righe.filter((r) => r.status !== 'LIVE').map((r) => r.id);
      if (daEliminare.length === 0) return { deleted: 0, skippedLive: righe.length };
      // I file degli eventi (materiali caricati, allegati di chat) se ne vanno
      // prima: la cascata porta via le righe, e dopo nessuno saprebbe più
      // quali blob cancellare. Se lo storage non risponde gli eventi restano (503).
      await removeFilesOfEventsBeingDeleted({ id: { in: daEliminare } });
      const result = await tx.event.deleteMany({ where: { id: { in: daEliminare } } });
      return { deleted: result.count, skippedLive: righe.length - daEliminare.length };
    },
    { timeout: BULK_DELETE_TIMEOUT_MS },
  );

  await logAdminAction({
    request,
    action: 'EVENT_BULK_DELETE',
    details: { ids: parsed.data.ids, deleted, skippedLive },
  });

  return Response.json({ deleted, skippedLive });
});
