/**
 * Email template resolver: merges DB overrides (EmailTemplate model) with the
 * hardcoded defaults in `templates.ts`, then interpolates `{{placeholder}}`
 * tokens on user-editable fields. Non-editable labels stay in the defaults
 * file — adding a new overridable field here requires a Prisma migration.
 */
import { prisma } from '@/lib/db';

export type EmailTemplateKey = 'confirmation' | 'reminder';

export const EMAIL_TEMPLATE_KEYS: readonly EmailTemplateKey[] = [
  'confirmation',
  'reminder',
] as const;

export const OVERRIDABLE_FIELDS = [
  'subject',
  'heading',
  'bodyIntro',
  'ctaLabel',
  'infoNote',
  'footerNote',
] as const;

export type OverridableField = (typeof OVERRIDABLE_FIELDS)[number];

export type EmailTemplateOverride = Partial<Record<OverridableField, string | null>>;

export interface ResolvedEmailTemplate {
  subject: string;
  heading: string;
  bodyIntro: string | null;
  ctaLabel: string;
  infoNote: string | null;
  footerNote: string;
}

export interface TemplatePlaceholders {
  eventTitle?: string;
  eventDate?: string;
  eventTime?: string;
  eventDuration?: string;
  joinUrl?: string;
  eventPageUrl?: string;
  siteName?: string;
  offsetMinutes?: number | string;
}

const ALLOWED_PLACEHOLDERS: readonly (keyof TemplatePlaceholders)[] = [
  'eventTitle',
  'eventDate',
  'eventTime',
  'eventDuration',
  'joinUrl',
  'eventPageUrl',
  'siteName',
  'offsetMinutes',
];

export function interpolate(
  template: string,
  vars: TemplatePlaceholders,
): string {
  return template.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (match, name: string) => {
    if (!(ALLOWED_PLACEHOLDERS as readonly string[]).includes(name)) {
      return match;
    }
    const v = vars[name as keyof TemplatePlaceholders];
    return v === undefined || v === null ? '' : String(v);
  });
}

export async function loadEmailTemplateOverride(
  key: EmailTemplateKey,
  locale: string,
): Promise<EmailTemplateOverride | null> {
  try {
    const row = await prisma.emailTemplate.findUnique({
      where: { key_locale: { key, locale } },
    });
    if (!row) return null;
    return {
      subject: row.subject,
      heading: row.heading,
      bodyIntro: row.bodyIntro,
      ctaLabel: row.ctaLabel,
      infoNote: row.infoNote,
      footerNote: row.footerNote,
    };
  } catch (err) {
    console.error('[email] failed to load template override', { key, locale, err });
    return null;
  }
}

/**
 * Merge a DB override on top of base defaults. Each field falls back to the
 * base value when the override is missing or empty. Placeholders inside the
 * merged strings are then interpolated.
 */
export function applyOverride(
  base: ResolvedEmailTemplate,
  override: EmailTemplateOverride | null,
  vars: TemplatePlaceholders,
): ResolvedEmailTemplate {
  const pick = (field: OverridableField, fallback: string | null): string | null => {
    const v = override?.[field];
    if (v === undefined || v === null || v === '') return fallback;
    return interpolate(v, vars);
  };

  return {
    subject: pick('subject', base.subject) ?? base.subject,
    heading: pick('heading', base.heading) ?? base.heading,
    bodyIntro: pick('bodyIntro', base.bodyIntro),
    ctaLabel: pick('ctaLabel', base.ctaLabel) ?? base.ctaLabel,
    infoNote: pick('infoNote', base.infoNote),
    footerNote: pick('footerNote', base.footerNote) ?? base.footerNote,
  };
}
