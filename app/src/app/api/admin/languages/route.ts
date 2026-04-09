import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';

import { prisma } from '@/lib/db';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { UnauthorizedError, ValidationError } from '@/lib/errors';
import { invalidateSettingsCache } from '@/lib/settings';

const updateLocalesSchema = z.object({
  availableLocales: z.array(z.string().min(2).max(5)),
  localeNames: z.record(z.string().min(2).max(5), z.string().max(50)),
});

const updateTranslationsSchema = z.object({
  locale: z.string().min(2).max(5),
  overrides: z.record(z.string(), z.string()),
});

export const GET = withErrorHandling(async () => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const settings = await prisma.siteSetting.findUnique({
    where: { id: 'singleton' },
    select: {
      availableLocales: true,
      localeNames: true,
      translationOverrides: true,
    },
  });

  return NextResponse.json(settings ?? {
    availableLocales: ['it', 'en'],
    localeNames: { it: 'Italiano', en: 'English' },
    translationOverrides: {},
  });
});

export const PUT = withErrorHandling(async (request: NextRequest) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const body = await parseJsonBody(request) as Record<string, unknown>;

  if ('locale' in body && 'overrides' in body) {
    const parsed = updateTranslationsSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((i) => i.message).join(', '),
      );
    }

    const settings = await prisma.siteSetting.findUnique({
      where: { id: 'singleton' },
      select: { translationOverrides: true },
    });

    const existing =
      (settings?.translationOverrides as Record<string, Record<string, string>>) ?? {};
    existing[parsed.data.locale] = {
      ...existing[parsed.data.locale],
      ...parsed.data.overrides,
    };

    const updated = await prisma.siteSetting.update({
      where: { id: 'singleton' },
      data: { translationOverrides: existing },
      select: {
        availableLocales: true,
        localeNames: true,
        translationOverrides: true,
      },
    });

    invalidateSettingsCache();
    return NextResponse.json(updated);
  }

  const parsed = updateLocalesSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((i) => i.message).join(', '),
    );
  }

  const updated = await prisma.siteSetting.update({
    where: { id: 'singleton' },
    data: {
      availableLocales: parsed.data.availableLocales,
      localeNames: parsed.data.localeNames,
    },
    select: {
      availableLocales: true,
      localeNames: true,
      translationOverrides: true,
    },
  });

  invalidateSettingsCache();
  return NextResponse.json(updated);
});
