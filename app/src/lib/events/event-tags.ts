/**
 * Le etichette di un evento: dagli slug scelti nel wizard alle righe di
 * collegamento. Le usano la creazione, la modifica dell'evento e la rotta
 * delle etichette dell'amministrazione, cosi' la regola e' una sola.
 *
 * Uno slug che non esiste (piu') si scarta: l'elenco delle etichette lo cura
 * l'amministrazione (/api/admin/tags).
 */

import type { Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

/** Le etichette che esistono fra quelle nominate. */
export async function resolveTags(
  db: Db,
  slugs: readonly string[],
): Promise<Array<{ id: string; slug: string }>> {
  if (slugs.length === 0) return [];
  return db.tag.findMany({
    where: { slug: { in: [...slugs] } },
    select: { id: true, slug: true },
  });
}

export async function tagIdsFromSlugs(db: Db, slugs: readonly string[]): Promise<string[]> {
  return (await resolveTags(db, slugs)).map((tag) => tag.id);
}

/** Le etichette che l'evento ha adesso. */
export async function eventTagIds(db: Db, eventId: string): Promise<string[]> {
  const links = await db.eventTagLink.findMany({ where: { eventId }, select: { tagId: true } });
  return links.map((link) => link.tagId);
}

/** Lo stesso insieme di etichette, in qualunque ordine. */
export function sameTagIds(a: readonly string[], b: readonly string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && [...sa].every((id) => sb.has(id));
}

/** Sostituisce le etichette dell'evento con queste (nessuna: le toglie). */
export async function replaceEventTags(
  db: Db,
  eventId: string,
  tagIds: readonly string[],
): Promise<void> {
  await db.eventTagLink.deleteMany({ where: { eventId } });
  if (tagIds.length > 0) {
    await db.eventTagLink.createMany({
      data: tagIds.map((tagId) => ({ eventId, tagId })),
      skipDuplicates: true,
    });
  }
}
