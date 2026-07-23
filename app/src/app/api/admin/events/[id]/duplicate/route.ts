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
 * link, cover image, event type, sizing overrides — plus the reminder schedule.
 *
 * The capture flags matter more than they look: this endpoint used to drop
 * `multitrackRecordingEnabled`, `retainParticipantTracks`, the four AI flags,
 * `aiTargetLocales`, `expectedSpeakers`, `agendaEnabled`, `wordCloudEnabled`,
 * `autoStartRecording`, `videoQuality` and `recurrenceRule` on the floor. For a
 * recurring call (Caffettino, DevIt sync) that is the whole point of duplicating:
 * the operator would only discover the loss after the event, with no multitrack
 * audio and no transcript. See docs/ROADMAP.md, "Eventi ricorrenti / serie".
 *
 * What we reset: status (→ DRAFT), moderatorToken, jitsiRoomName, slug,
 * runtime/analytics state (lastActiveAt, provisioningStartedAt,
 * peakParticipants, recording URLs/metadata, capacityEstimateJson) and the join
 * password — a fresh copy must not inherit a secret the operator cannot see.
 *
 * What we skip: the other relations (registrations, questions, polls,
 * materials, feedback, sessions) — those belong to the occurrence that ran.
 *
 * Optional body:
 *   { "nextOccurrence": true }        project the date from the source's RRULE
 *   { "startsAt": ISO, "endsAt": ISO } explicit reschedule
 * Neither → same dates as the source (historic behaviour).
 */
import { randomUUID } from 'crypto';

import { cookies } from 'next/headers';

import { withErrorHandling } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError, UnauthorizedError } from '@/lib/errors';
import { duplicatedConfig } from '@/lib/events/duplicate-fields';
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

interface DuplicateOptions {
  nextOccurrence?: boolean;
  startsAt?: string;
  endsAt?: string;
}

/** Body is optional: an empty POST keeps the historic "same dates" behaviour. */
async function readOptions(request: Request): Promise<DuplicateOptions> {
  try {
    const raw = await request.json();
    return raw && typeof raw === 'object' ? (raw as DuplicateOptions) : {};
  } catch {
    return {};
  }
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

  const explicitStart = options.startsAt ? new Date(options.startsAt) : null;
  if (explicitStart && !Number.isNaN(explicitStart.getTime())) {
    const explicitEnd = options.endsAt ? new Date(options.endsAt) : null;
    return {
      startsAt: explicitStart,
      endsAt:
        explicitEnd && !Number.isNaN(explicitEnd.getTime()) && explicitEnd > explicitStart
          ? explicitEnd
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

  const source = await prisma.event.findUnique({ where: { id } });
  if (!source) throw new NotFoundError('Event not found');

  const reminders = await prisma.eventReminder.findMany({
    where: { eventId: source.id },
    select: { offsetMinutes: true, label: true },
    orderBy: { offsetMinutes: 'desc' },
  });

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

      // Reminder schedule: a duplicate with no reminders quietly stops warning
      // registrants, which is exactly the kind of loss nobody notices in time.
      ...(reminders.length > 0 && {
        reminders: {
          create: reminders.map((r) => ({
            offsetMinutes: r.offsetMinutes,
            label: r.label,
          })),
        },
      }),
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
