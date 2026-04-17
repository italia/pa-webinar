import { getRequestConfig } from 'next-intl/server';

import { prisma } from '@/lib/db';
import { DEFAULT_TIMEZONE } from '@/lib/utils/date-format';

import { locales, type Locale } from './config';

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
  let timeZone = DEFAULT_TIMEZONE;
  try {
    const settings = await prisma.siteSetting.findFirst({
      select: { defaultTimezone: true },
    });
    if (settings?.defaultTimezone) timeZone = settings.defaultTimezone;
  } catch {
    // Any DB hiccup at i18n load time shouldn't take down rendering.
  }

  return {
    locale,
    timeZone,
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});
