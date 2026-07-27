/**
 * POST /api/admin/events/:id/duplicate
 *
 * Admin-only: creates a DRAFT copy of an existing event so an operator
 * can tweak the next occurrence without re-entering all the config
 * (privacy policy, feature toggles, speakers, branding, …).
 *
 * What we copy: the ENTIRE configuration — titles (with "(copia)" appended),
 * description, schedule, every feature toggle, the capture/AI flags,
 * registration rules, privacy text, speakers/organiser info, GDPR template
 * link, cover image, event type, sizing overrides. The scalar side is
 * enumerated in lib/events/duplicate-fields.
 *
 * Relations follow the same rule — the copy inherits the configuration, not the
 * life of the occurrence: tags, organisers, named moderator/speaker grants (each
 * with a fresh token), the agenda, questionnaires and the reminder schedule.
 * Which ones, and why the others are left behind, is enumerated in
 * lib/events/duplicate-relations.
 *
 * What we reset: status (→ DRAFT), moderatorToken, jitsiRoomName, slug,
 * runtime/analytics state (lastActiveAt, provisioningStartedAt,
 * peakParticipants, recording URLs/metadata, capacityEstimateJson) and the join
 * password — a fresh copy must not inherit a secret the operator cannot see.
 *
 * Optional body:
 *   { "nextOccurrence": true }        project the date from the source's RRULE
 *   { "startsAt": ISO, "endsAt": ISO } explicit reschedule
 * Neither → same dates as the source (historic behaviour).
 */
import { randomUUID } from 'crypto';

import { cookies } from 'next/headers';

import { z } from 'zod';

import { withErrorHandling } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { prisma } from '@/lib/db';
import {
  AppError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '@/lib/errors';
import { duplicatedConfig } from '@/lib/events/duplicate-fields';
import {
  DUPLICATE_SOURCE_INCLUDE,
  duplicatedRelations,
} from '@/lib/events/duplicate-relations';
import { nextOccurrenceAfter } from '@/lib/utils/recurrence';
import { generateUniqueSlug } from '@/lib/utils/slug';
import type { LocalizedField } from '@/lib/utils/locale';

export const dynamic = 'force-dynamic';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Append "(copia)" / "(copy)" to each locale's title so the duplicate
 * is visually distinct in event lists. Non-standard locales get the
 * Italian suffix (admin UI is primarily IT).
 */
function suffixTitle(title: LocalizedField): Record<string, string> {
  if (!title || typeof title !== 'object') {
    return { it: '(copia)' };
  }
  const out: Record<string, string> = {};
  for (const [locale, value] of Object.entries(title)) {
    if (typeof value !== 'string') continue;
    const suffix = locale === 'en' ? '(copy)' : '(copia)';
    out[locale] = value.trim().length > 0 ? `${value} ${suffix}` : suffix;
  }
  return out;
}

/**
 * The body is validated rather than cast: `{ "startsAt": 1 }` used to reach
 * `new Date(1)` and return a 201 for a copy dated 1970, and a truthy string
 * `"false"` in `nextOccurrence` used to silently reschedule the copy.
 */
const duplicateOptionsSchema = z
  .object({
    nextOccurrence: z.boolean().optional(),
    // `local: true` accetta anche un ISO senza fuso (`2026-09-01T10:00:00`):
    // rifiutarlo restringerebbe ciò che l'endpoint accettava prima.
    startsAt: z.string().datetime({ offset: true, local: true }).optional(),
    endsAt: z.string().datetime({ offset: true, local: true }).optional(),
  })
  .strict()
  // Le date si validano anche fra loro, non solo una per una: da sole
  // passavano richieste che l'endpoint poi ignorava, rispondendo 201 con le
  // date dell'originale — cioè programmando la copia dove nessuno ha chiesto.
  .refine((o) => !(o.endsAt && !o.startsAt), {
    message: 'endsAt requires startsAt',
    path: ['startsAt'],
  })
  .refine((o) => !(o.startsAt && o.endsAt && new Date(o.endsAt) <= new Date(o.startsAt)), {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  });

type DuplicateOptions = z.infer<typeof duplicateOptionsSchema>;

/**
 * Body is optional: an empty POST (no body at all, or `{}`) keeps the historic
 * "same dates as the source" behaviour. A body that IS present must be valid —
 * silently ignoring a malformed one would schedule the copy somewhere the
 * operator never asked for.
 */
async function readOptions(request: Request): Promise<DuplicateOptions> {
  const raw = await request.text();
  if (raw.trim().length === 0) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppError('Invalid JSON body', 400, 'INVALID_BODY');
  }

  const result = duplicateOptionsSchema.safeParse(parsed);
  if (!result.success) {
    throw new ValidationError(result.error.issues[0]?.message ?? 'Invalid body');
  }
  return result.data;
}

/**
 * Dates for the copy. Explicit values win; `nextOccurrence` projects the first
 * date the source's RRULE yields strictly after now, keeping the original
 * duration and time of day. With no rule to project from we fall back to the
 * source dates rather than inventing a cadence — the operator can still edit
 * the draft, and a wrong guessed date is worse than an obvious placeholder.
 */
function resolveSchedule(
  source: { startsAt: Date; endsAt: Date; recurrenceRule: string | null },
  options: DuplicateOptions,
): { startsAt: Date; endsAt: Date } {
  const durationMs = source.endsAt.getTime() - source.startsAt.getTime();

  // Le date arrivano già validate dallo schema: sono ISO parsabili, `endsAt`
  // non viaggia mai da solo ed è sempre successivo a `startsAt`. Qui resta solo
  // la scelta della durata quando la fine non è stata indicata.
  if (options.startsAt) {
    const explicitStart = new Date(options.startsAt);
    return {
      startsAt: explicitStart,
      endsAt: options.endsAt
        ? new Date(options.endsAt)
        : new Date(explicitStart.getTime() + durationMs),
    };
  }

  if (options.nextOccurrence && source.recurrenceRule) {
    // Seek past the occurrences already held rather than enumerating a window:
    // a daily series running for months would otherwise yield only past dates,
    // and the copy would silently keep the source's (past) schedule.
    const upcoming = nextOccurrenceAfter(source.recurrenceRule, source.startsAt, new Date());
    if (upcoming) {
      return { startsAt: upcoming, endsAt: new Date(upcoming.getTime() + durationMs) };
    }
  }

  return { startsAt: source.startsAt, endsAt: source.endsAt };
}

export const POST = withErrorHandling(async (request, context) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const { id } = await context.params;
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    throw new AppError('id must be a UUID', 400, 'BAD_REQUEST');
  }

  // L'include e il costruttore delle relazioni vivono insieme in
  // lib/events/duplicate-relations.ts: separarli significherebbe poter
  // aggiungere una relazione da copiare senza caricarla, e perderla in silenzio.
  const source = await prisma.event.findUnique({
    where: { id },
    include: DUPLICATE_SOURCE_INCLUDE,
  });
  if (!source) throw new NotFoundError('Event not found');

  const { startsAt, endsAt } = resolveSchedule(source, await readOptions(request));

  const newTitle = suffixTitle(source.title as LocalizedField);
  const newSlug = await generateUniqueSlug(newTitle);
  const moderatorToken = randomUUID();
  const jitsiRoomName = `evt-${randomUUID()}`;

  const duplicate = await prisma.event.create({
    data: {
      // Everything the copy inherits, from the single classified list — see
      // lib/events/duplicate-fields.ts for why this is not spelled out inline.
      ...duplicatedConfig(source),

      // …and the handful of values a copy must NOT inherit.
      slug: newSlug,
      title: newTitle,
      jitsiRoomName,
      moderatorToken,
      status: 'DRAFT',
      startsAt,
      endsAt,

      // Le relazioni ereditate, dallo stesso elenco classificato: tag,
      // organizzatori, co-moderatori (con token NUOVI), scaletta, questionari e
      // promemoria. Prima qui c'erano solo i promemoria, scritti a mano — ed è
      // per questo che tutto il resto si perdeva a ogni duplicazione.
      ...duplicatedRelations(source),
    },
  });

  await logAdminAction({
    request,
    action: 'EVENT_DUPLICATE',
    target: duplicate.id,
    details: { sourceId: source.id },
  });

  return Response.json(
    {
      id: duplicate.id,
      slug: duplicate.slug,
      moderatorToken: duplicate.moderatorToken,
    },
    { status: 201 },
  );
});
