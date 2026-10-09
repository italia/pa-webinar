import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { getTranslations, getLocale } from 'next-intl/server';

import { getStaffSession, puoGestire } from '@/lib/auth/staff-session';
import AccessDenied from '@/components/admin/access-denied';
import { tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { getPublicEnv } from '@/lib/env';
import { getSettings } from '@/lib/settings';
import { guestAccessAllowed } from '@/lib/events/guest-window';
import EventManagementClient from '@/components/admin/event-management-client';
import { localizedPath } from '@/lib/utils/localized-url';
import { eventPageMetadata } from '@/components/admin/admin-page-title';

interface EventManagePageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const [{ id }, { token }] = await Promise.all([params, searchParams]);
  return eventPageMetadata('/admin/events/[id]', id, { token, conToken: true });
}

export default async function EventManagePage({
  params,
  searchParams,
}: EventManagePageProps) {
  const { id } = await params;
  const { token } = await searchParams;
  const t = await getTranslations('admin');
  const locale = await getLocale();

  // Chi arriva dall'area di amministrazione (l'elenco, la libreria video)
  // non ha il token nell'indirizzo: vale la sessione dello staff, e per
  // l'organizzatore solo sugli eventi che gestisce (eventScope, ADR-014).
  const session = await getStaffSession(await cookies());

  // Con una sessione che puo' gestire l'evento il token nell'indirizzo non
  // serve: si torna all'indirizzo pulito, che non lo espone a cronologia,
  // log e condivisioni dello schermo. Chi ha solo il link del moderatore
  // (anche un organizzatore su un evento altrui) continua a entrare col token.
  if (token && session && UUID_RE.test(id) && (await puoGestire(session, id))) {
    redirect(localizedPath(`/admin/events/${id}`, locale));
  }
  const staff = token ? null : session;

  if (!token && !staff) {
    return (
      <div className="container py-5">
        <h1 className="mb-4">{t('title')}</h1>
        <div className="callout callout-highlight">
          <p>{t('noToken')}</p>
        </div>
      </div>
    );
  }

  // Guard against non-UUID slugs hitting this dynamic route: Next.js picks
  // the [id] segment for any path that doesn't match a sibling static route
  // (e.g. /admin/events/<typo>). Hitting Prisma with a non-UUID throws
  // P2023 Inconsistent column data instead of a clean 404.
  if (!UUID_RE.test(id)) {
    notFound();
  }
  if (staff && !(await puoGestire(staff, id))) return <AccessDenied />;

  const event = await prisma.event.findUnique({
    where: { id },
    include: {
      registrations: {
        select: {
          id: true,
          displayName: true,
          organization: true,
          organizationRole: true,
          organizationType: true,
          joinedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      },
      materials: {
        orderBy: { createdAt: 'desc' },
      },
      reminders: {
        include: { _count: { select: { sentRecords: true } } },
        orderBy: { offsetMinutes: 'desc' },
      },
      gdprAuditLogs: {
        orderBy: { createdAt: 'desc' },
        take: 50,
      },
      tagLinks: { include: { tag: true } },
      organizers: { orderBy: { sortOrder: 'asc' } },
      additionalMods: { orderBy: { createdAt: 'asc' } },
      questionnaires: true,
      _count: { select: { registrations: true, recordings: true } },
    },
  });

  if (!event) {
    notFound();
  }
  if (!staff && event.moderatorToken !== token) {
    notFound();
  }

  const baseUrl = getPublicEnv('NEXT_PUBLIC_APP_URL');
  const settings = await getSettings();

  const serialized = {
    id: event.id,
    slug: event.slug,
    title: event.title as Record<string, string>,
    description: event.description as Record<string, string>,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    timezone: event.timezone,
    maxParticipants: event.maxParticipants,
    peakParticipants: event.peakParticipants,
    registrationCount: event._count.registrations,
    qaEnabled: event.qaEnabled,
    chatEnabled: event.chatEnabled,
    recordingEnabled: event.recordingEnabled,
    participantsCanUnmute: event.participantsCanUnmute,
    participantsCanStartVideo: event.participantsCanStartVideo,
    participantsCanShareScreen: event.participantsCanShareScreen,
    status: event.status,
    eventType: event.eventType,
    // Solo se c'e', mai l'hash: serve a dire a chi organizza che la sala
    // chiedera' la password a chi entra da ospite.
    hasJoinPassword: event.joinPasswordHash !== null,
    coverImageUrl: event.coverImageUrl,
    imageUrl: event.imageUrl,
    parseTitleKicker: event.parseTitleKicker,
    expectedSenderRatioPct: event.expectedSenderRatioPct,
    capacityEstimateJson: event.capacityEstimateJson as Record<string, unknown> | null,
    recordingUrl: event.recordingUrl,
    tempRecordingUrl: event.tempRecordingUrl,
    tempRecordingStartedAt: event.tempRecordingStartedAt?.toISOString() ?? null,
    recordingPublished: event.recordingPublished,
    recordingPublishedAt: event.recordingPublishedAt?.toISOString() ?? null,
    recordingFileSize: event.recordingFileSize ? Number(event.recordingFileSize) : null,
    recordingDuration: event.recordingDuration,
    recordingDeleteAfterDays: event.recordingDeleteAfterDays,
    youtubeUrl: event.youtubeUrl,
    libraryListed: event.libraryListed,
    // A Recording ROW exists (live capture happened) → the AI pipeline can run.
    // Gated separately from recordingUrl: an externally/manually-set recordingUrl
    // has no Recording row, so "Generate AI" would 404.
    hasRecordingRow: event._count.recordings > 0,
    postEventPublic: event.postEventPublic,
    postEventPublicUntil: event.postEventPublicUntil?.toISOString() ?? null,
    postEventShowQA: event.postEventShowQA,
    postEventShowMaterials: event.postEventShowMaterials,
    postEventShowPolls: event.postEventShowPolls,
    postEventShowFeedback: event.postEventShowFeedback,
    postEventShowRecap: event.postEventShowRecap,
    postEventShowWordCloud: event.postEventShowWordCloud,
    postEventEmailEnabled: event.postEventEmailEnabled,
    recordingNotifyEnabled: event.recordingNotifyEnabled,
    recordingNotifiedAt: event.recordingNotifiedAt?.toISOString() ?? null,
    feedbackEnabled: event.feedbackEnabled,
    recordingConsentText: event.recordingConsentText,
    moderatorToken: event.moderatorToken,
    moderatorName: event.moderatorName,
    moderatorEmail: tryDecryptPII(event.moderatorEmail),
    jitsiRoomName: event.jitsiRoomName,
    dataRetentionDays: event.dataRetentionDays,
    privacyPolicyUrl: event.privacyPolicyUrl,
    privacyPolicyText: event.privacyPolicyText,
    speakersInfo: event.speakersInfo as Record<string, string> | null,
    createdAt: event.createdAt.toISOString(),
    requireOrganization: event.requireOrganization,
    requireOrganizationRole: event.requireOrganizationRole,
    requireOrganizationType: event.requireOrganizationType,
    tags: event.tagLinks.map((link) => ({
      id: link.tag.id,
      slug: link.tag.slug,
      name: link.tag.name as Record<string, string>,
      color: link.tag.color,
    })),
    organizers: event.organizers.map((o) => ({
      id: o.id,
      name: o.name,
      logoUrl: o.logoUrl,
      websiteUrl: o.websiteUrl,
    })),
    eventModerators: event.additionalMods.map((m) => ({
      id: m.id,
      name: tryDecryptPII(m.name) ?? m.name,
      email: tryDecryptPII(m.email),
      role: m.role,
      revokedAt: m.revokedAt?.toISOString() ?? null,
    })),
    questionnaireCount: event.questionnaires.length,
    registrations: event.registrations.map((r) => ({
      id: r.id,
      displayName: tryDecryptPII(r.displayName) ?? r.displayName,
      organization: r.organization,
      organizationRole: r.organizationRole,
      organizationType: r.organizationType,
      joinedAt: r.joinedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
    materials: event.materials.map((m) => ({
      id: m.id,
      title: m.title,
      url: m.url,
      description: m.description,
      addedBy: m.addedBy,
      createdAt: m.createdAt.toISOString(),
    })),
    reminders: event.reminders.map((r) => ({
      id: r.id,
      offsetMinutes: r.offsetMinutes,
      label: r.label,
      sentCount: r._count.sentRecords,
      createdAt: r.createdAt.toISOString(),
    })),
    gdprAuditLogs: event.gdprAuditLogs.map((l) => ({
      id: l.id,
      action: l.action,
      recordCount: l.recordCount,
      details: l.details,
      createdAt: l.createdAt.toISOString(),
    })),
  };

  // The effective kicker flag: per-event override if set, otherwise
  // inherit the site-wide default.
  const effectiveKicker =
    event.parseTitleKicker !== null
      ? event.parseTitleKicker
      : settings.parseTitleKicker;

  return (
    <div className="container py-5">
      <EventManagementClient
        event={serialized}
        baseUrl={baseUrl}
        locale={locale}
        kickerEnabled={effectiveKicker}
        guestEntryOpen={guestAccessAllowed(event, settings.guestAccessEnabled)}
        // L'istante di questo rendering: le finestre a tempo della pagina
        // pubblica si valutano su questo finche' il browser non ha il suo
        // orologio, cosi' la prima passata del client coincide col server.
        renderedAt={Date.now()}
        viaToken={staff ? null : (token ?? null)}
      />
    </div>
  );
}
