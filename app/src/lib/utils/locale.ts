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

export type LocalizedField = Record<string, string> | null | undefined;

/**
 * Retrieve a localized string from a multilingual JSON field.
 * Falls back to the given fallback locale (default: 'it'),
 * then to the first available value.
 *
 * An EMPTY (or whitespace-only) translation counts as absent and falls through.
 * The event form writes one key per enabled locale and leaves the ones nobody
 * filled in as "", so `obj[locale] ?? …` — which only falls back on
 * null/undefined — returned the empty string and stopped there. In production
 * that produced confirmation emails with the subject "Registration confirmed: "
 * and no event name anywhere in the body, plus an iCal attachment with an empty
 * SUMMARY, for everyone who registered from an /en page of an
 * Italian-only-titled event. "Not translated" must mean "show the original",
 * never "show nothing".
 */
export function getLocalized(
  field: LocalizedField,
  locale: string,
  fallbackLocale: string = 'it',
): string {
  if (!field || typeof field !== 'object') return '';
  const obj = field as Record<string, string>;
  const usable = (v: unknown): v is string =>
    typeof v === 'string' && v.trim().length > 0;

  if (usable(obj[locale])) return obj[locale];
  if (usable(obj[fallbackLocale])) return obj[fallbackLocale];
  return Object.values(obj).find(usable) ?? '';
}

/**
 * Set a value in a multilingual JSON field, returning a new object.
 */
export function setLocalized(
  field: LocalizedField,
  locale: string,
  value: string,
): Record<string, string> {
  const obj = (field && typeof field === 'object') ? { ...field } : {};
  obj[locale] = value;
  return obj;
}

/**
 * Pick the localized title/description for an event.
 * Works with the new JSON-based multilingual fields.
 */
export function localiseEvent(
  event: { title: unknown; description: unknown },
  locale: Locale,
): { title: string; description: string } {
  return {
    title: getLocalized(event.title as LocalizedField, locale),
    description: getLocalized(event.description as LocalizedField, locale),
  };
}
