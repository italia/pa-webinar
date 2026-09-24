/**
 * /api/admin/organizers — gli account degli organizzatori (ADR-014).
 * Solo l'amministrazione dell'istanza.
 */
import { Prisma } from '@prisma/client';
import { cookies } from 'next/headers';
import { z } from 'zod';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { inviaLinkAccesso } from '@/lib/auth/staff-login';
import { encryptPII, hashEmail, tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { ConflictError, UnauthorizedError, ValidationError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async () => {
  if (!(await isAdminAuthenticated(await cookies()))) throw new UnauthorizedError();
  const rows = await prisma.staffAccount.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      createdAt: true,
      lastLoginAt: true,
      _count: { select: { events: true } },
    },
  });
  return Response.json({
    rows: rows.map((r) => ({
      id: r.id,
      name: tryDecryptPII(r.name) ?? '',
      email: tryDecryptPII(r.email) ?? '',
      role: r.role,
      active: r.active,
      createdAt: r.createdAt.toISOString(),
      lastLoginAt: r.lastLoginAt?.toISOString() ?? null,
      eventCount: r._count.events,
    })),
  });
});

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  invite: z.boolean().default(true),
  locale: z.string().min(2).max(5).default('it'),
});

export const POST = withErrorHandling(async (request) => {
  if (!(await isAdminAuthenticated(await cookies()))) throw new UnauthorizedError();
  const parsed = createSchema.safeParse(await parseJsonBody(request));
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }
  const { name, email, invite, locale } = parsed.data;
  const emailHash = hashEmail(email);
  if (await prisma.staffAccount.findUnique({ where: { emailHash }, select: { id: true } })) {
    throw new ConflictError('organizer_exists');
  }
  let account: { id: string; email: string; name: string };
  try {
    account = await prisma.staffAccount.create({
      data: { emailHash, email: encryptPII(email), name: encryptPII(name) },
      select: { id: true, email: true, name: true },
    });
  } catch (err) {
    // Due richieste con la stessa email arrivate insieme: il controllo sopra
    // lo passano entrambe, il vincolo di unicita' ne ferma una.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictError('organizer_exists');
    }
    throw err;
  }
  await logAdminAction({ request, action: 'ORGANIZER_CREATE', target: account.id });

  // L'account c'e' comunque: se l'invio non riesce lo si dice, e il link si
  // rimanda dalla riga dell'elenco. Fallire qui con un 500 lascerebbe un
  // account creato che un secondo tentativo trova gia' esistente.
  let invited = false;
  if (invite) {
    try {
      await inviaLinkAccesso(account, locale);
      invited = true;
    } catch (err) {
      console.error('[organizers] invio del link non riuscito', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return Response.json({ id: account.id, invited }, { status: 201 });
});
