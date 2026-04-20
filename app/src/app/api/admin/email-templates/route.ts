/**
 * Admin endpoints for per-(key, locale) email template overrides.
 * Each override is an upsert — clearing every field is the "reset to default"
 * UX path; callers can also DELETE to remove the row.
 */
import { cookies } from 'next/headers';
import { z } from 'zod';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { prisma } from '@/lib/db';
import { UnauthorizedError, ValidationError } from '@/lib/errors';
import {
  EMAIL_TEMPLATE_KEYS,
  type EmailTemplateKey,
} from '@/lib/email/resolve-template';

export const dynamic = 'force-dynamic';

const upsertSchema = z.object({
  key: z.enum(EMAIL_TEMPLATE_KEYS as unknown as [EmailTemplateKey, ...EmailTemplateKey[]]),
  locale: z.string().regex(/^[a-z]{2}$/),
  subject: z.string().max(200).nullish(),
  heading: z.string().max(200).nullish(),
  bodyIntro: z.string().max(2000).nullish(),
  ctaLabel: z.string().max(100).nullish(),
  infoNote: z.string().max(2000).nullish(),
  footerNote: z.string().max(2000).nullish(),
});

const deleteSchema = z.object({
  key: z.enum(EMAIL_TEMPLATE_KEYS as unknown as [EmailTemplateKey, ...EmailTemplateKey[]]),
  locale: z.string().regex(/^[a-z]{2}$/),
});

export const GET = withErrorHandling(async () => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const rows = await prisma.emailTemplate.findMany({
    orderBy: [{ key: 'asc' }, { locale: 'asc' }],
  });

  return Response.json(
    {
      rows: rows.map((r) => ({
        id: r.id,
        key: r.key,
        locale: r.locale,
        subject: r.subject,
        heading: r.heading,
        bodyIntro: r.bodyIntro,
        ctaLabel: r.ctaLabel,
        infoNote: r.infoNote,
        footerNote: r.footerNote,
        updatedAt: r.updatedAt.toISOString(),
        updatedBy: r.updatedBy,
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});

export const PUT = withErrorHandling(async (request) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const body = await parseJsonBody(request);
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }
  const { key, locale, ...fields } = parsed.data;

  const normalize = (v: string | null | undefined) =>
    v === undefined || v === null ? null : v.trim() === '' ? null : v;

  const saved = await prisma.emailTemplate.upsert({
    where: { key_locale: { key, locale } },
    create: {
      key,
      locale,
      subject: normalize(fields.subject),
      heading: normalize(fields.heading),
      bodyIntro: normalize(fields.bodyIntro),
      ctaLabel: normalize(fields.ctaLabel),
      infoNote: normalize(fields.infoNote),
      footerNote: normalize(fields.footerNote),
    },
    update: {
      subject: normalize(fields.subject),
      heading: normalize(fields.heading),
      bodyIntro: normalize(fields.bodyIntro),
      ctaLabel: normalize(fields.ctaLabel),
      infoNote: normalize(fields.infoNote),
      footerNote: normalize(fields.footerNote),
    },
  });

  return Response.json({
    id: saved.id,
    key: saved.key,
    locale: saved.locale,
    subject: saved.subject,
    heading: saved.heading,
    bodyIntro: saved.bodyIntro,
    ctaLabel: saved.ctaLabel,
    infoNote: saved.infoNote,
    footerNote: saved.footerNote,
    updatedAt: saved.updatedAt.toISOString(),
  });
});

export const DELETE = withErrorHandling(async (request) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const body = await parseJsonBody(request);
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }
  const { key, locale } = parsed.data;

  await prisma.emailTemplate.deleteMany({ where: { key, locale } });
  return Response.json({ ok: true });
});
