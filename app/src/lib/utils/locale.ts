import type { Event } from '@prisma/client';

import { defaultLocale, locales, type Locale } from '@/i18n/config';

/**
 * Determine the preferred locale from the request.
 * Priority: ?locale query param > Accept-Language header > default.
 */
export function resolveLocale(request: Request): Locale {
  const url = new URL(request.url);
  const param = url.searchParams.get('locale');
  if (param && locales.includes(param as Locale)) {
    return param as Locale;
  }

  const accept = request.headers.get('accept-language');
  if (accept) {
    for (const part of accept.split(',')) {
      const tag = part.split(';')[0];
      if (!tag) continue;
      const lang = tag.trim().substring(0, 2).toLowerCase();
      if (locales.includes(lang as Locale)) {
        return lang as Locale;
      }
    }
  }

  return defaultLocale;
}

/**
 * Pick the localised title/description for an event.
 * Falls back to Italian if the requested locale translation is missing.
 */
export function localiseEvent(
  event: Event,
  locale: Locale,
): { title: string; description: string } {
  if (locale === 'en') {
    return {
      title: event.titleEn ?? event.titleIt,
      description: event.descriptionEn ?? event.descriptionIt,
    };
  }
  return {
    title: event.titleIt,
    description: event.descriptionIt,
  };
}
