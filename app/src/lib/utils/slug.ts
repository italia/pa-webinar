import { prisma } from '@/lib/db';

/**
 * Convert a string to a URL-safe kebab-case slug.
 * Handles Italian diacritics and special characters.
 */
function toKebab(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')    // non-alphanum → hyphen
    .replace(/^-+|-+$/g, '')        // trim leading/trailing hyphens
    .replace(/-{2,}/g, '-');         // collapse consecutive hyphens
}

/**
 * Generate a unique slug from the Italian title.
 * Appends a numeric suffix if the base slug already exists.
 */
export async function generateUniqueSlug(titleIt: string): Promise<string> {
  const base = toKebab(titleIt);

  const existing = await prisma.event.findUnique({ where: { slug: base } });
  if (!existing) return base;

  let suffix = 2;
  while (suffix < 1000) {
    const candidate = `${base}-${suffix}`;
    const found = await prisma.event.findUnique({
      where: { slug: candidate },
    });
    if (!found) return candidate;
    suffix += 1;
  }

  return `${base}-${Date.now()}`;
}
