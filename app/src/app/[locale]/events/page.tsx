import type { Metadata } from 'next';
import type { Prisma } from '@prisma/client';
import { getTranslations, getLocale } from 'next-intl/server';

import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { publicEventStatusWhere } from '@/lib/events/visibility';
import EventListClient from '@/components/events/event-list-client';

export const revalidate = 60;

interface EventsPageProps {
  searchParams: Promise<{ tag?: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('events');
  return { title: t('title') };
}

export default async function EventiPage({ searchParams }: EventsPageProps) {
  const t = await getTranslations('events');
  const locale = await getLocale();
  const settings = await getSettings();
  const { tag: activeTag } = await searchParams;

  // Include anche PROVISIONING/IDLE degli eventi schedulati (pre-warm/pausa):
  // un evento non deve sparire dal listing nei minuti prima dell'inizio.
  const baseWhere: Prisma.EventWhereInput = publicEventStatusWhere();

  const where: Prisma.EventWhereInput = activeTag
    ? {
        ...baseWhere,
        tagLinks: { some: { tag: { slug: activeTag } } },
      }
    : baseWhere;

  const [events, availableTags] = await Promise.all([
    prisma.event.findMany({
      where,
      include: {
        _count: { select: { registrations: true } },
        tagLinks: { include: { tag: true } },
      },
      orderBy: { startsAt: 'asc' },
    }),
    prisma.tag.findMany({
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
    }),
  ]);

  const upcoming = events
    .filter((e) => e.status !== 'ENDED')
    .map((e) => serialise(e, locale));

  const past = events
    .filter((e) => e.status === 'ENDED')
    .map((e) => serialise(e, locale));

  const tagList = availableTags.map((tag) => ({
    slug: tag.slug,
    name: tag.name as Record<string, string>,
    color: tag.color,
  }));

  return (
    <div className="container py-5">
      <h1 className="mb-2">{t('title')}</h1>
      <p className="lead text-muted mb-4" style={{ maxWidth: '680px' }}>
        {settings.siteDescription}
      </p>

      {tagList.length > 0 && (
        <TagFilterRow tags={tagList} activeTag={activeTag} locale={locale} />
      )}

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
          <EventListClient events={upcoming} parseTitleKicker={settings.parseTitleKicker} />
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
          <EventListClient events={past} muted parseTitleKicker={settings.parseTitleKicker} />
        </section>
      )}
    </div>
  );
}

interface TagFilterRowProps {
  tags: Array<{ slug: string; name: Record<string, string>; color: string | null }>;
  activeTag: string | undefined;
  locale: string;
}

async function TagFilterRow({ tags, activeTag, locale }: TagFilterRowProps) {
  const t = await getTranslations('events.list');

  function hexWithAlpha(hex: string, alpha: number): string {
    const clean = hex.replace('#', '');
    const normalized =
      clean.length === 3
        ? clean
            .split('')
            .map((c) => c + c)
            .join('')
        : clean;
    if (normalized.length !== 6) return hex;
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    if ([r, g, b].some((v) => Number.isNaN(v))) return hex;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  return (
    <div className="mb-4">
      <div className="small fw-semibold mb-2" style={{ color: 'var(--app-text)' }}>
        {t('filterByTag')}
      </div>
      <div className="d-flex flex-wrap gap-2">
        <a
          href={`/${locale}/events`}
          className="btn btn-sm"
          aria-pressed={!activeTag}
          style={{
            borderRadius: 20,
            border: '1px solid #0066CC',
            backgroundColor: !activeTag ? '#0066CC' : 'rgba(0,102,204,0.1)',
            color: !activeTag ? '#fff' : 'var(--app-primary)',
            fontWeight: 500,
            padding: '4px 12px',
          }}
        >
          {t('allTags')}
        </a>
        {tags.map((tag) => {
          const active = activeTag === tag.slug;
          const displayName =
            tag.name[locale] ?? tag.name.it ?? tag.name.en ?? tag.slug;
          const color = tag.color ?? '#0066CC';
          return (
            <a
              key={tag.slug}
              href={`/${locale}/events?tag=${encodeURIComponent(tag.slug)}`}
              className="btn btn-sm"
              aria-pressed={active}
              style={{
                borderRadius: 20,
                border: `1px solid ${color}`,
                backgroundColor: active ? color : hexWithAlpha(color, 0.1),
                color: active ? '#fff' : color,
                fontWeight: 500,
                padding: '4px 12px',
                textDecoration: 'none',
              }}
            >
              {displayName}
            </a>
          );
        })}
      </div>
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
  parseTitleKicker: boolean | null;
  _count: { registrations: number };
  tagLinks: Array<{
    tag: {
      slug: string;
      name: unknown;
      color: string | null;
    };
  }>;
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
    parseTitleKicker: e.parseTitleKicker,
    tags: e.tagLinks.map((link) => ({
      slug: link.tag.slug,
      name: link.tag.name as Record<string, string>,
      color: link.tag.color,
    })),
  };
}
