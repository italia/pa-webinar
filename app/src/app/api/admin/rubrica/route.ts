// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * Admin rubrica (address book) list.
 *
 * L'elenco delle persone in rubrica, indipendente dalle iscrizioni ai singoli
 * eventi. Solo per l'amministrazione.
 *
 * GET elenca, senza testo da cercare e senza indirizzi:
 *   orgType?       — OrganizationType enum value
 *   includeOpted?  — 'out' per comprendere chi ha ritirato il consenso (default:
 *                    solo chi lo ha dato). La pagina della rubrica gestisce ogni
 *                    voce.
 *   limit?         — default 200, max 1000
 *   offset?        — pagination offset
 *
 * POST cerca per nome, email o ente, con il testo nel corpo JSON
 * (lib/persons/ricerca-rubrica) e gli stessi filtri: `q`, `orgType`,
 * `includeOptedOut`, `withEmail`, `limit`, `offset`. L'email serve al confronto
 * anche senza `withEmail`, ma nella risposta c'e' solo con `withEmail`, che
 * restituisce solo le voci che ne hanno una: al selettore del wizard serve per
 * mettere la persona in un evento. Se le voci sono piu' di quelle che si guardano,
 * `scanLimit` dice quante ne ha guardate.
 */

import { cookies } from 'next/headers';
import type { OrganizationType, Prisma } from '@prisma/client';
import { z } from 'zod';

import { parseJsonBody, withErrorHandling } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { UnauthorizedError, ValidationError } from '@/lib/errors';
import { VOCI_ESAMINATE_MAX, voceCorrisponde } from '@/lib/persons/ricerca-rubrica';
import { ORGANIZATION_TYPES } from '@/lib/validation/schemas';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

const ricercaSchema = z.object({
  q: z.string().trim().min(1).max(200),
  orgType: z.enum(ORGANIZATION_TYPES).optional(),
  includeOptedOut: z.boolean().optional(),
  withEmail: z.boolean().optional(),
  limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
  offset: z.number().int().min(0).optional(),
});

interface Filtri {
  orgType: OrganizationType | null;
  includeOptedOut: boolean;
  withEmail: boolean;
  limit: number;
  offset: number;
}

// Sort by lastActiveAt only — alphabetical sort on encrypted
// displayName is meaningless (ciphertext order is random).
const ORDINE: Prisma.PersonOrderByWithRelationInput[] = [{ lastActiveAt: 'desc' }];

function vociDeiFiltri({ orgType, includeOptedOut, withEmail }: Filtri): Prisma.PersonWhereInput {
  const where: Prisma.PersonWhereInput = {};
  if (!includeOptedOut) where.optedInToAddressBook = true;
  if (orgType) where.organizationType = orgType;
  // Senza un indirizzo la persona non si potrebbe aggiungere a un evento, e il
  // selettore non la propone.
  if (withEmail) where.email = { not: null };
  return where;
}

async function elenco(
  filtri: Filtri,
  where: Prisma.PersonWhereInput,
  { skip, total, scanLimit }: { skip: number; total: number | null; scanLimit?: number },
): Promise<Response> {
  const { withEmail, limit, offset } = filtri;
  const [rows, conteggio] = await Promise.all([
    prisma.person.findMany({
      where,
      orderBy: ORDINE,
      take: limit,
      skip,
      select: {
        id: true,
        displayName: true,
        email: withEmail,
        organization: true,
        organizationRole: true,
        organizationType: true,
        optedInToAddressBook: true,
        optedInAt: true,
        optedOutAt: true,
        lastActiveAt: true,
        retentionMonths: true,
        createdAt: true,
        _count: { select: { registrations: true } },
      },
    }),
    total ?? prisma.person.count({ where }),
  ]);

  return Response.json(
    {
      rows: rows.map((r) => ({
        id: r.id,
        displayName: tryDecryptPII(r.displayName),
        organization: r.organization,
        organizationRole: r.organizationRole,
        organizationType: r.organizationType,
        optedInToAddressBook: r.optedInToAddressBook,
        optedInAt: r.optedInAt?.toISOString() ?? null,
        optedOutAt: r.optedOutAt?.toISOString() ?? null,
        lastActiveAt: r.lastActiveAt.toISOString(),
        retentionMonths: r.retentionMonths,
        createdAt: r.createdAt.toISOString(),
        registrationCount: r._count.registrations,
        ...(withEmail ? { email: tryDecryptPII(r.email) } : {}),
      })),
      total: conteggio,
      limit,
      offset,
      ...(scanLimit ? { scanLimit } : {}),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

async function richiediAmministrazione(): Promise<void> {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();
}

export const GET = withErrorHandling(async (request) => {
  await richiediAmministrazione();

  const url = new URL(request.url);
  const filtri: Filtri = {
    orgType: url.searchParams.get('orgType') as OrganizationType | null,
    includeOptedOut: url.searchParams.get('includeOpted') === 'out',
    withEmail: false,
    limit: Math.min(
      parseInt(url.searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10),
      MAX_LIMIT,
    ),
    offset: parseInt(url.searchParams.get('offset') ?? '0', 10),
  };
  return elenco(filtri, vociDeiFiltri(filtri), { skip: filtri.offset, total: null });
});

export const POST = withErrorHandling(async (request) => {
  await richiediAmministrazione();

  const parsed = ricercaSchema.safeParse(await parseJsonBody(request, 2048));
  if (!parsed.success) throw new ValidationError('Invalid search');
  const { q, orgType, includeOptedOut, withEmail, limit, offset } = parsed.data;
  const filtri: Filtri = {
    orgType: orgType ?? null,
    includeOptedOut: includeOptedOut === true,
    withEmail: withEmail === true,
    limit: limit ?? DEFAULT_LIMIT,
    offset: offset ?? 0,
  };
  const where = vociDeiFiltri(filtri);

  const voci = await prisma.person.findMany({
    where,
    orderBy: ORDINE,
    // Una voce in piu' dice se ne sono rimaste fuori.
    take: VOCI_ESAMINATE_MAX + 1,
    select: { id: true, displayName: true, email: true, organization: true },
  });
  const trovate = voci
    .slice(0, VOCI_ESAMINATE_MAX)
    .filter((v) =>
      voceCorrisponde([tryDecryptPII(v.displayName), tryDecryptPII(v.email), v.organization], q),
    )
    .map((v) => v.id);
  const pagina = trovate.slice(filtri.offset, filtri.offset + filtri.limit);

  return elenco(
    filtri,
    { AND: [where, { id: { in: pagina } }] },
    {
      skip: 0,
      total: trovate.length,
      ...(voci.length > VOCI_ESAMINATE_MAX ? { scanLimit: VOCI_ESAMINATE_MAX } : {}),
    },
  );
});
