import { getRequestConfig } from 'next-intl/server';

import { prisma } from '@/lib/db';
import { DEFAULT_TIMEZONE } from '@/lib/utils/date-format';

import { locales, type Locale } from './config';

type Messages = Record<string, unknown>;
type LocaleOverrides = Record<string, string>;

/**
 * Apply admin-editable translation overrides on top of the bundled message
 * defaults. Overrides are stored in `SiteSetting.translationOverrides` as
 * `{ [locale]: { "dotted.message.key": "value" } }` and edited from
 * /admin/settings/languages.
 *
 * This is the platform's reuse seam: an adopting PA can rebrand any string
 * (hero copy, CTAs, ...) from the admin without touching the JSON catalogs or
 * the code, while the shipped i18n values remain the fallback. We deep-clone
 * the imported messages first so we never mutate the module-cached object, and
 * we fail open — a malformed override must never break rendering.
 */
function applyOverrides(messages: Messages, overrides: LocaleOverrides): Messages {
  const out = structuredClone(messages);
  for (const [path, value] of Object.entries(overrides)) {
    if (typeof value !== 'string' || !path) continue;
    const segments = path.split('.');
    let node: Record<string, unknown> = out;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i]!;
      const next = node[seg];
      if (typeof next !== 'object' || next === null) {
        node[seg] = {};
      }
      node = node[seg] as Record<string, unknown>;
    }
    node[segments[segments.length - 1]!] = value;
  }
  return out;
}

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;

  if (!locale || !locales.includes(locale as Locale)) {
    locale = 'it';
  }

  // Global time zone for every next-intl Formatter (client + server).
  // Without this, Intl.DateTimeFormat falls back to UTC and every admin
  // dashboard renders dates an hour or two off from what the operator
  // expects. We read SiteSetting once per request and fail closed to
  // Europe/Rome so the SSR path stays fast when the DB is unreachable.
  // The same row also carries the runtime translation overrides.
  let timeZone = DEFAULT_TIMEZONE;
  let overrides: LocaleOverrides | undefined;
  try {
    const settings = await prisma.siteSetting.findFirst({
      select: { defaultTimezone: true, translationOverrides: true },
    });
    if (settings?.defaultTimezone) timeZone = settings.defaultTimezone;
    const all = settings?.translationOverrides as
      | Record<string, LocaleOverrides>
      | null
      | undefined;
    if (all && typeof all === 'object') overrides = all[locale];
  } catch {
    // Any DB hiccup at i18n load time shouldn't take down rendering.
  }

  let messages = (await import(`./messages/${locale}.json`)).default as Messages;
  if (overrides && Object.keys(overrides).length > 0) {
    try {
      messages = applyOverrides(messages, overrides);
    } catch {
      // Bad override payload must never take down the page — keep defaults.
    }
  }

  return {
    locale,
    timeZone,
    messages,
  };
});
