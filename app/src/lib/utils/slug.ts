import { prisma } from '@/lib/db';
import { toKebab } from '@/lib/utils/kebab';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';

/**
 * Generate a unique slug from the Italian title.
 * Appends a numeric suffix if the base slug already exists.
 */
export async function generateUniqueSlug(title: LocalizedField): Promise<string> {
  const base = toKebab(getLocalized(title, 'it'));

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
