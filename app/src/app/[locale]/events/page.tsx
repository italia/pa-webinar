import type { Metadata } from 'next';
import { getTranslations, getLocale } from 'next-intl/server';

import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import EventListClient from '@/components/events/event-list-client';

export const revalidate = 60;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('events');
  return { title: t('title') };
}

export default async function EventiPage() {
  const t = await getTranslations('events');
  const locale = await getLocale();
  const settings = await getSettings();

  const events = await prisma.event.findMany({
    where: { status: { in: ['PUBLISHED', 'LIVE', 'ENDED'] } },
    include: { _count: { select: { registrations: true } } },
    orderBy: { startsAt: 'asc' },
  });

  const upcoming = events
    .filter((e) => e.status === 'PUBLISHED' || e.status === 'LIVE')
    .map((e) => serialise(e, locale));

  const past = events
    .filter((e) => e.status === 'ENDED')
    .map((e) => serialise(e, locale));

  return (
    <div className="container py-5">
      <h1 className="mb-2">{t('title')}</h1>
      <p className="lead text-muted mb-5" style={{ maxWidth: '680px' }}>
        {settings.siteDescription}
      </p>

      <section className="mb-5">
        <h2
          className="h4 fw-semibold pb-2 mb-4"
          style={{ borderBottom: '2px solid #0066CC' }}
        >
          {t('upcoming')}
        </h2>
        {upcoming.length === 0 ? (
          <div
            className="p-4 rounded text-center"
            style={{ backgroundColor: '#F5F7FB' }}
          >
            <p className="text-muted mb-0">{t('noUpcoming')}</p>
          </div>
        ) : (
          <EventListClient events={upcoming} />
        )}
      </section>

      {past.length > 0 && (
        <section>
          <h2
            className="h4 fw-semibold pb-2 mb-4"
            style={{ borderBottom: '2px solid #5A768A' }}
          >
            {t('past')}
          </h2>
          <EventListClient events={past} muted />
        </section>
      )}
    </div>
  );
}

interface EventWithCount {
  id: string;
  slug: string;
  title: unknown;
  description: unknown;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  maxParticipants: number;
  status: string;
  recordingUrl: string | null;
  speakersInfo: unknown;
  organizerName: string | null;
  imageUrl: string | null;
  _count: { registrations: number };
}

function serialise(e: EventWithCount, _locale: string) {
  return {
    id: e.id,
    slug: e.slug,
    title: e.title as Record<string, string>,
    description: e.description as Record<string, string> | null,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    timezone: e.timezone,
    maxParticipants: e.maxParticipants,
    registrationCount: e._count.registrations,
    status: e.status,
    recordingUrl: e.recordingUrl,
    speakersInfo: e.speakersInfo as Record<string, string> | null,
    organizerName: e.organizerName,
    imageUrl: e.imageUrl,
  };
}
