/**
 * Nome leggibile di un codice di lingua ISO-639-1.
 *
 *   localeDisplayName('it') → "italiano"
 *   localeDisplayName('en') → "inglese"
 *   localeDisplayName('zz') → "ZZ"   (fallback al codice maiuscolo)
 *
 * `Intl.DisplayNames` è supportato da tutti i runtime in cui gira
 * Next.js 15 (Node >= 18 + browser moderni). Lo wrap qui per centrale
 * il fallback e per evitare di importare il polyfill in più posti.
 */
export function localeDisplayName(lang: string, displayIn: string = 'it'): string {
  try {
    const n = new Intl.DisplayNames([displayIn], { type: 'language' });
    return n.of(lang) ?? lang.toUpperCase();
  } catch {
    return lang.toUpperCase();
  }
}
