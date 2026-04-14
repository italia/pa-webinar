const IT_PATHS: Record<string, string> = {
  '/events': '/eventi',
  '/events/': '/eventi/',
  '/calendar': '/calendario',
  '/accessibility': '/accessibilita',
  '/legal-notice': '/note-legali',
  '/privacy/my-data': '/privacy/i-miei-dati',
};

/**
 * Build a public-facing URL with localized path segments.
 * For Italian locale, translates known path segments.
 * For all other locales, uses the English (internal) path.
 *
 * Use this for external URLs (emails, SEO, Open Graph, iCal) where
 * the URL must match what the user sees in their browser.
 * For internal navigation (Link href, router.push, redirect), use English paths directly.
 */
export function localizedPath(path: string, locale: string): string {
  if (locale !== 'it') return `/${locale}${path}`;

  let localized = path;
  for (const [en, it] of Object.entries(IT_PATHS)) {
    if (localized.startsWith(en)) {
      localized = it + localized.slice(en.length);
      break;
    }
  }
  return `/${locale}${localized}`;
}

/**
 * Build a full external URL with localized path segments.
 */
export function localizedUrl(baseUrl: string, path: string, locale: string): string {
  return `${baseUrl}${localizedPath(path, locale)}`;
}
