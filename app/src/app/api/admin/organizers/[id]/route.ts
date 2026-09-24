/**
 * /api/admin/organizers/:id — attivazione, nome, eliminazione (ADR-014).
 *
 * Eliminare un account non elimina i suoi eventi: tornano
 * all'amministrazione (la relazione e' SetNull).
 */
import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { encryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { NotFoundError, UnauthorizedError, ValidationError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const patchSchema = z
  .object({
    active: z.boolean().optional(),
    name: z.string().trim().min(2).max(120).optional(),
  })
  .strict();

/**
 * Nuovo link da moderatore per ogni evento dell'organizzatore. Il link
 * principale e' condiviso: chi lo usava legittimamente lo ritrova, nuovo,
 * nella pagina dell'evento.
 */
async function ruotaTokenEventi(tx: Prisma.TransactionClient, accountId: string): Promise<void> {
  const eventi = await tx.event.findMany({ where: { createdById: accountId }, select: { id: true } });
  for (const e of eventi) {
    await tx.event.update({ where: { id: e.id }, data: { moderatorToken: randomUUID() } });
  }
}

async function idValido(context: { params: Promise<{ id: string }> }): Promise<string> {
  const { id } = await context.params;
  if (!UUID_RE.test(id)) throw new NotFoundError('Organizer');
  return id;
}

export const PATCH = withErrorHandling(async (request, context) => {
  if (!(await isAdminAuthenticated(await cookies()))) throw new UnauthorizedError();
  const id = await idValido(context as { params: Promise<{ id: string }> });
  const parsed = patchSchema.safeParse(await parseJsonBody(request));
  if (!parsed.success) throw new ValidationError('Validation failed');
  const { active, name } = parsed.data;
  const esiste = await prisma.staffAccount.findUnique({ where: { id }, select: { id: true } });
  if (!esiste) throw new NotFoundError('Organizer');
  await prisma.$transaction(async (tx) => {
    await tx.staffAccount.update({
      where: { id },
      data: {
        ...(active !== undefined && { active }),
        ...(name !== undefined && { name: encryptPII(name) }),
      },
    });
    if (active === false) {
      // Disattivare chiude anche i link di accesso ancora in giro...
      await tx.staffLoginToken.deleteMany({ where: { accountId: id, usedAt: null } });
      // ...e i link da moderatore dei suoi eventi, che ha visto tutti: senza,
      // resterebbe fuori dall'area ma continuerebbe a modificare, pubblicare
      // o cancellare i suoi eventi da quei link.
      await ruotaTokenEventi(tx, id);
    }
  });
  await logAdminAction({
    request,
    action: active === false ? 'ORGANIZER_DEACTIVATE' : 'ORGANIZER_UPDATE',
    target: id,
  });
  return Response.json({ ok: true });
});

export const DELETE = withErrorHandling(async (request, context) => {
  if (!(await isAdminAuthenticated(await cookies()))) throw new UnauthorizedError();
  const id = await idValido(context as { params: Promise<{ id: string }> });
  // Gli eventi tornano all'amministrazione (SetNull), e i loro link da
  // moderatore cambiano: quelli vecchi li conosceva chi se ne va.
  const res = await prisma.$transaction(async (tx) => {
    await ruotaTokenEventi(tx, id);
    return tx.staffAccount.deleteMany({ where: { id } });
  });
  if (res.count === 0) throw new NotFoundError('Organizer');
  await logAdminAction({ request, action: 'ORGANIZER_DELETE', target: id });
  return Response.json({ ok: true });
});
