/**
 * Shared resolver for the public `[param]` event routes, where the path segment
 * may be either an event UUID or a slug. Kept in one place so the several live
 * ingest routes (speaker-events, hand-raises, attendance/leave, …) don't each
 * re-implement the same UUID sniff + where clause.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Prisma `where` matching an event by id (if the param looks like a UUID) or slug. */
export function eventParamWhere(param: string) {
  return UUID_RE.test(param)
    ? { OR: [{ id: param }, { slug: param }] }
    : { slug: param };
}
