import { getTranslations, getLocale } from 'next-intl/server';

import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { Link } from '@/i18n/navigation';
import EventListClient from '@/components/events/event-list-client';

async function loadUpcomingEvents() {
  const events = await prisma.event.findMany({
    where: { status: { in: ['PUBLISHED', 'LIVE'] } },
    include: { _count: { select: { registrations: true } } },
    orderBy: { startsAt: 'asc' },
    take: 6,
  });

  return events.map((e) => ({
    id: e.id,
    slug: e.slug,
    titleIt: e.titleIt,
    titleEn: e.titleEn,
    descriptionIt: e.descriptionIt,
    descriptionEn: e.descriptionEn,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    timezone: e.timezone,
    maxParticipants: e.maxParticipants,
    registrationCount: e._count.registrations,
    status: e.status,
    recordingUrl: e.recordingUrl,
    speakersIt: e.speakersIt,
    speakersEn: e.speakersEn,
    organizerName: e.organizerName,
    imageUrl: e.imageUrl,
  }));
}

export default async function HomePage() {
  const _locale = await getLocale();
  const settings = await getSettings();
  const upcoming = await loadUpcomingEvents();

  if (settings.homePageMode === 'EVENTS_LIST') {
    return <EventsListHome upcoming={upcoming} />;
  }

  if (settings.homePageMode === 'CUSTOM' && settings.customHomeHtml) {
    return (
      <>
        <div
          className="container py-5"
          dangerouslySetInnerHTML={{ __html: settings.customHomeHtml }}
        />
        <EventsSection upcoming={upcoming} />
      </>
    );
  }

  // Default: LANDING
  return <LandingHome upcoming={upcoming} />;
}

async function EventsSection({
  upcoming,
}: {
  upcoming: Awaited<ReturnType<typeof loadUpcomingEvents>>;
}) {
  const t = await getTranslations('home');

  return (
    <section className="py-5">
      <div className="container">
        <div className="d-flex justify-content-between align-items-center mb-4">
          <h2 className="h3 fw-semibold mb-0">{t('upcoming.title')}</h2>
          <Link
            href="/eventi"
            className="text-primary text-decoration-none fw-semibold"
            style={{ fontSize: '0.95rem' }}
          >
            {t('upcoming.viewAll')} &rarr;
          </Link>
        </div>
        {upcoming.length === 0 ? (
          <div
            className="p-5 rounded-3 text-center"
            style={{ backgroundColor: '#F5F7FB' }}
          >
            <p className="text-secondary mb-0 lead">
              {t('upcoming.noEvents')}
            </p>
          </div>
        ) : (
          <EventListClient events={upcoming} />
        )}
      </div>
    </section>
  );
}

async function EventsListHome({
  upcoming,
}: {
  upcoming: Awaited<ReturnType<typeof loadUpcomingEvents>>;
}) {
  const t = await getTranslations('home');

  return (
    <section className="py-5">
      <div className="container">
        <h1 className="h2 fw-bold mb-4">{t('upcoming.title')}</h1>
        {upcoming.length === 0 ? (
          <div
            className="p-5 rounded-3 text-center"
            style={{ backgroundColor: '#F5F7FB' }}
          >
            <p className="text-secondary mb-0 lead">
              {t('upcoming.noEvents')}
            </p>
          </div>
        ) : (
          <EventListClient events={upcoming} />
        )}
        <div className="text-center mt-4">
          <Link href="/eventi" className="btn btn-primary btn-lg">
            {t('upcoming.viewAll')}
          </Link>
        </div>
      </div>
    </section>
  );
}

async function LandingHome({
  upcoming,
}: {
  upcoming: Awaited<ReturnType<typeof loadUpcomingEvents>>;
}) {
  const t = await getTranslations('home');

  const features = [
    {
      icon: '🎥',
      title: t('features.video.title'),
      desc: t('features.video.desc'),
    },
    {
      icon: '❓',
      title: t('features.qa.title'),
      desc: t('features.qa.desc'),
    },
    {
      icon: '🔒',
      title: t('features.privacy.title'),
      desc: t('features.privacy.desc'),
    },
  ];

  const steps = [
    {
      num: 1,
      title: t('howItWorks.step1.title'),
      desc: t('howItWorks.step1.desc'),
    },
    {
      num: 2,
      title: t('howItWorks.step2.title'),
      desc: t('howItWorks.step2.desc'),
    },
    {
      num: 3,
      title: t('howItWorks.step3.title'),
      desc: t('howItWorks.step3.desc'),
    },
    {
      num: 4,
      title: t('howItWorks.step4.title'),
      desc: t('howItWorks.step4.desc'),
    },
  ];

  return (
    <>
      {/* ── Hero ── */}
      <section
        className="text-white py-5"
        style={{
          background:
            'linear-gradient(135deg, #0066CC 0%, #004A99 50%, #003366 100%)',
        }}
      >
        <div className="container py-4 py-lg-5">
          <div className="row justify-content-center text-center">
            <div className="col-lg-8 col-xl-7">
              <h1
                className="display-5 fw-bold mb-3"
                style={{ letterSpacing: '-0.02em' }}
              >
                {t('hero.title')}
              </h1>
              <p
                className="lead mb-4"
                style={{ opacity: 0.9, fontSize: '1.15rem', lineHeight: 1.6 }}
              >
                {t('hero.subtitle')}
              </p>
              <div className="d-flex flex-column flex-sm-row gap-3 justify-content-center">
                <Link
                  href="/eventi"
                  className="btn btn-light btn-lg px-4 fw-semibold text-primary"
                >
                  {t('hero.browseEvents')}
                </Link>
                <Link
                  href="/admin/login"
                  className="btn btn-outline-light btn-lg px-4"
                >
                  {t('hero.organizeEvent')}
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="py-5" style={{ backgroundColor: '#F5F7FB' }}>
        <div className="container">
          <h2 className="h3 fw-semibold text-center mb-5">
            {t('features.title')}
          </h2>
          <div className="row g-4">
            {features.map((f) => (
              <div key={f.title} className="col-md-4">
                <div
                  className="bg-white rounded-3 p-4 h-100 text-center"
                  style={{
                    border: '1px solid #e8e8e8',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                  }}
                >
                  <div
                    className="mb-3"
                    style={{ fontSize: '2.5rem', lineHeight: 1 }}
                  >
                    {f.icon}
                  </div>
                  <h3 className="h5 fw-semibold mb-2">{f.title}</h3>
                  <p
                    className="text-secondary mb-0"
                    style={{ fontSize: '0.95rem' }}
                  >
                    {f.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Upcoming events ── */}
      <EventsSection upcoming={upcoming} />

      {/* ── How it works ── */}
      <section className="py-5" style={{ backgroundColor: '#F5F7FB' }}>
        <div className="container">
          <h2 className="h3 fw-semibold text-center mb-5">
            {t('howItWorks.title')}
          </h2>
          <div className="row g-4 justify-content-center">
            {steps.map((s, idx) => (
              <div key={s.num} className="col-sm-6 col-lg-3">
                <div className="text-center position-relative">
                  <div
                    className="d-inline-flex align-items-center justify-content-center rounded-circle bg-primary text-white fw-bold mb-3"
                    style={{ width: 52, height: 52, fontSize: '1.3rem' }}
                  >
                    {s.num}
                  </div>
                  {idx < steps.length - 1 && (
                    <div
                      className="d-none d-lg-block position-absolute"
                      style={{
                        top: 26,
                        left: 'calc(50% + 35px)',
                        width: 'calc(100% - 70px)',
                        height: 2,
                        backgroundColor: '#0066CC',
                        opacity: 0.25,
                      }}
                      aria-hidden="true"
                    />
                  )}
                  <h3 className="h6 fw-semibold mb-1">{s.title}</h3>
                  <p
                    className="text-secondary mb-0 small"
                    style={{ maxWidth: 200, margin: '0 auto' }}
                  >
                    {s.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
