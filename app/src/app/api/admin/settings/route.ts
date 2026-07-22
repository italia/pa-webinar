import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';

import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { publicSettings } from '@/lib/settings/public-projection';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { logAdminAction } from '@/lib/audit/admin-audit';
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
  waitingRoomEngine: z.enum(['GARDEN', 'GAME', 'CLASSIC']).optional(),
  customHomeHtml: z.string().max(50000).nullish(),
  footerLinks: z.array(z.object({
    title: z.string().max(100),
    url: z.string().max(500),
    section: z.enum(['main', 'legal']).optional(),
  })).max(20).optional(),
  privacyPolicy: z.record(z.string(), z.string().max(100000)).optional(),
  accessibility: z.record(z.string(), z.string().max(100000)).optional(),
  defaultLocale: z.string().min(2).max(5).optional(),
  defaultTimezone: z.string().min(1).max(64).optional(),
  statusPageEnabled: z.boolean().optional(),
  guestAccessEnabled: z.boolean().optional(),
  publicRegistrationEnabled: z.boolean().optional(),
  calendarPublic: z.boolean().optional(),
  parseTitleKicker: z.boolean().optional(),
  jitsiWatermarkUrl: z.string().url().nullish(),
  jitsiWatermarkEnabled: z.boolean().optional(),
  jitsiWatermarkOpacity: z.number().min(0).max(1).optional(),
  jitsiWatermarkPosition: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']).optional(),
  videoQuality: z.enum(['SAVE_DATA', 'BALANCED', 'HIGH', 'MAX']).optional(),
  githubUrl: z.string().url().nullish(),
  supportEmail: z.string().email().nullish(),
  // Nome mittente mostrato in posta; stringa vuota = torna al default.
  gravatarEnabled: z.boolean().optional(),
  emailFromName: z.string().max(100).nullish(),
  emailReplyTo: z.string().email().nullish(),
  availableLocales: z.array(z.string().min(2).max(5)).optional(),
  localeNames: z.record(z.string().min(2).max(5), z.string().max(50)).optional(),
  translationOverrides: z.record(z.string(), z.record(z.string(), z.string())).optional(),
  jvbInactiveGraceMinutes: z.number().int().min(5).max(240).optional(),
  jvbPreScaleMinutes: z.number().int().min(1).max(60).optional(),
  jvbEmptyCloseMinutes: z.number().int().min(-1).max(240).optional(),
  waitingRoomLeadMinutes: z.number().int().min(0).max(1440).optional(),
  reactionsMode: z.enum(['NATIVE', 'CUSTOM']).optional(),
  jvbStressWarnPercent: z.number().int().min(0).max(100).optional(),
  jvbStressCriticalPercent: z.number().int().min(0).max(100).optional(),
  jvbProvisioningTimeoutMinutes: z.number().int().min(1).max(120).optional(),
  statusPollIntervalSeconds: z.number().int().min(5).max(600).optional(),
  // Per-cluster JVB/Jibri sizing — see docs/CONFIGURATION.md "Scaling".
  jvbCpuCoresPerPod: z.number().int().min(1).max(128).optional(),
  jvbReceiversPerCore: z.number().min(0.1).max(100).optional(),
  jvbSendersPerCore: z.number().min(0.1).max(100).optional(),
  jvbMaxReplicas: z.number().int().min(1).max(50).optional(),
  jibriCpuCoresPerPod: z.number().int().min(1).max(32).optional(),
  defaultSenderRatioPct: z.number().int().min(0).max(100).optional(),
  // Soft-exit grace window applied to LIVE events past endsAt.
  eventGracePeriodMinutes: z.number().int().min(-1).max(240).optional(),
  orphanRecordingGraceDays: z.number().int().min(0).max(365).optional(),
  // ── Postprod AI pipeline ──────────────────────────────────────
  // Kill-switch + provider routing. I provider sono limitati al
  // sottoinsieme "in-cluster" supportato — vedi lib/ai/providers.ts.
  aiPipelineEnabled: z.boolean().optional(),
  aiLlmProvider: z.enum(['vllm']).optional(),
  aiAsrProvider: z.enum(['whisperx']).optional(),
  aiTtsEngine: z.enum(['piper']).optional(),
  // Comma-separated ISO-639-1, gestito come stringa per coerenza
  // con la colonna `text` in DB (parsing fatto in lib/ai/providers).
  aiDefaultTargetLocales: z.string().max(200).optional(),
  aiMaxConcurrentJobs: z.number().int().min(1).max(20).optional(),
  aiJobMaxAttempts: z.number().int().min(1).max(20).optional(),
  aiArtifactRetentionDays: z.number().int().min(0).max(3650).optional(),
  aiConsentDisclosure: z.record(z.string(), z.string().max(2000)).optional(),
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

    return NextResponse.json(publicSettings(created), {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  }

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
