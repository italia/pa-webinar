/**
 * Convert a string to a URL-safe kebab-case slug.
 * Handles Italian diacritics and special characters. Client-safe: no I/O.
 */
export function toKebab(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // non-alphanum → hyphen
    .replace(/^-+|-+$/g, '') // trim leading/trailing hyphens
    .replace(/-{2,}/g, '-'); // collapse consecutive hyphens
}
