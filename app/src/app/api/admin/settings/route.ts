import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { publicSettings } from '@/lib/settings/public-projection';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { updateSettingsSchema } from '@/lib/validation/site-settings';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { UnauthorizedError, ValidationError } from '@/lib/errors';
import { invalidateSettingsCache, leggiOCrea } from '@/lib/settings';


export const GET = withErrorHandling(async () => {
  const cookieStore = await cookies();
  const isAdmin = await isAdminAuthenticated(cookieStore);

  // Letta senza cache (il pannello rilegge subito cio' che ha appena
  // salvato) e creata al primo uso con la stessa creazione idempotente di
  // getSettings: su un'installazione nuova le prime richieste arrivano
  // insieme, e una sola crea la riga.
  const settings = await leggiOCrea();

  if (isAdmin) {
    return NextResponse.json(settings);
  }

  return NextResponse.json(publicSettings(settings), {
    headers: {
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
    },
  });
});

export const PUT = withErrorHandling(async (request: NextRequest) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) {
    throw new UnauthorizedError();
  }

  const body = await parseJsonBody(request);
  const { id: _id, updatedAt: _updatedAt, ...cleanBody } = body as Record<string, unknown>;
  const parsed = updateSettingsSchema.safeParse(cleanBody);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }

  // Zod Record<string,string> is structurally InputJsonValue but TS can't prove it
  const updated = await prisma.siteSetting.update({
    where: { id: 'singleton' },
    data: parsed.data as Prisma.SiteSettingUpdateInput,
  });

  invalidateSettingsCache();

  await logAdminAction({
    request,
    action: 'SITE_SETTINGS_UPDATE',
    details: { fields: Object.keys(parsed.data) },
  });

  return NextResponse.json(updated);
});
