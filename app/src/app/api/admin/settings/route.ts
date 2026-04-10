import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';

import { prisma } from '@/lib/db';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { UnauthorizedError, ValidationError } from '@/lib/errors';
import { invalidateSettingsCache } from '@/lib/settings';

const updateSettingsSchema = z.object({
  siteName: z.string().min(1).max(200).optional(),
  siteDescription: z.string().max(2000).optional(),
  organizationName: z.string().max(200).optional(),
  organizationNameShort: z.string().max(100).optional(),
  organizationUrl: z.string().url().or(z.literal('')).optional(),
  parentOrganization: z.string().max(200).optional(),
  parentOrganizationUrl: z.string().url().or(z.literal('')).optional(),
  logoUrl: z.string().url().nullish(),
  faviconUrl: z.string().url().nullish(),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  seoTitle: z.string().max(200).optional(),
  seoDescription: z.string().max(2000).optional(),
  seoImage: z.string().url().nullish(),
  homePageMode: z.enum(['LANDING', 'EVENTS_LIST', 'CUSTOM']).optional(),
  customHomeHtml: z.string().max(50000).nullish(),
  footerLinks: z.array(z.object({
    title: z.string().max(100),
    url: z.string().max(500),
    section: z.enum(['main', 'legal']).optional(),
  })).max(20).optional(),
  privacyPolicyIt: z.string().max(100000).nullish(),
  privacyPolicyEn: z.string().max(100000).nullish(),
  accessibilityIt: z.string().max(100000).nullish(),
  accessibilityEn: z.string().max(100000).nullish(),
  statusPageEnabled: z.boolean().optional(),
  guestAccessEnabled: z.boolean().optional(),
  publicRegistrationEnabled: z.boolean().optional(),
  calendarPublic: z.boolean().optional(),
  jitsiWatermarkUrl: z.string().url().nullish(),
  jitsiWatermarkEnabled: z.boolean().optional(),
  jitsiWatermarkOpacity: z.number().min(0).max(1).optional(),
  jitsiWatermarkPosition: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']).optional(),
  githubUrl: z.string().url().nullish(),
  supportEmail: z.string().email().nullish(),
  availableLocales: z.array(z.string().min(2).max(5)).optional(),
  localeNames: z.record(z.string().min(2).max(5), z.string().max(50)).optional(),
  translationOverrides: z.record(z.string(), z.record(z.string(), z.string())).optional(),
}).strict();

export const GET = withErrorHandling(async () => {
  const cookieStore = await cookies();
  const isAdmin = await isAdminAuthenticated(cookieStore);

  const settings = await prisma.siteSetting.findUnique({
    where: { id: 'singleton' },
  });

  if (!settings) {
    const created = await prisma.siteSetting.create({
      data: { id: 'singleton' },
    });

    if (isAdmin) {
      return NextResponse.json(created);
    }

    const { customHomeHtml: _, ...publicSettings } = created;
    return NextResponse.json(publicSettings, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  }

  if (isAdmin) {
    return NextResponse.json(settings);
  }

  const { customHomeHtml: _, ...publicSettings } = settings;
  return NextResponse.json(publicSettings, {
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

  const updated = await prisma.siteSetting.update({
    where: { id: 'singleton' },
    data: parsed.data,
  });

  invalidateSettingsCache();

  return NextResponse.json(updated);
});
