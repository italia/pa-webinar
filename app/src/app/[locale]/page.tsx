import { Fragment } from 'react';
import { getTranslations, getLocale } from 'next-intl/server';

import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { Link } from '@/i18n/navigation';
import { publicEventStatusWhere } from '@/lib/events/visibility';
import EventListClient from '@/components/events/event-list-client';

async function loadUpcomingEvents() {
  const events = await prisma.event.findMany({
    // Anche PROVISIONING/IDLE (schedulati): l'evento non sparisce dalla
    // home nei minuti di pre-warm prima dell'inizio.
    where: publicEventStatusWhere({ includeEnded: false }),
    include: { _count: { select: { registrations: true } } },
    orderBy: { startsAt: 'asc' },
    take: 6,
  });

  return events.map((e) => ({
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
  }));
}

/**
 * Decorative sprite icon from the Bootstrap Italia sprite sheet.
 *
 * We render the SVG <use> inline rather than via design-react-kit's <Icon>
 * because the landing page is the most-rendered surface of the site and the
 * client <Icon> wrapper has triggered hydration mismatches elsewhere. Inline
 * <use> stays fully server-rendered and is the canonical .italia markup.
 * All icons here are decorative, so they are hidden from assistive tech.
 */
function SvgIcon({
  id,
  className,
  size,
}: {
  id: string;
  className?: string;
  size?: number;
}) {
  const dim = size ?? 24;
  return (
    <svg
      className={`icon${className ? ` ${className}` : ''}`}
      width={dim}
      height={dim}
      aria-hidden="true"
      focusable="false"
    >
      <use href={`/svg/sprites.svg#${id}`} />
    </svg>
  );
}

export default async function HomePage() {
  const _locale = await getLocale();
  const settings = await getSettings();
  const upcoming = await loadUpcomingEvents();
  const parseTitleKicker = settings.parseTitleKicker;

  if (settings.homePageMode === 'EVENTS_LIST') {
    return <EventsListHome upcoming={upcoming} parseTitleKicker={parseTitleKicker} />;
  }

  if (settings.homePageMode === 'CUSTOM' && settings.customHomeHtml) {
    return (
      <>
        <div
          className="container py-5"
          dangerouslySetInnerHTML={{ __html: settings.customHomeHtml }}
        />
        <EventsSection upcoming={upcoming} parseTitleKicker={parseTitleKicker} />
      </>
    );
  }

  // Default: LANDING
  return <LandingHome upcoming={upcoming} parseTitleKicker={parseTitleKicker} />;
}

async function EventsSection({
  upcoming,
  parseTitleKicker,
}: {
  upcoming: Awaited<ReturnType<typeof loadUpcomingEvents>>;
  parseTitleKicker: boolean;
}) {
  const t = await getTranslations('home');

  return (
    <section className="py-5" aria-labelledby="home-upcoming-title">
      <div className="container">
        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-4">
          <h2 id="home-upcoming-title" className="h3 fw-semibold mb-0">
            {t('upcoming.title')}
          </h2>
          <Link
            href="/events"
            className="text-primary text-decoration-none fw-semibold d-inline-flex align-items-center gap-1"
            style={{ fontSize: '0.95rem' }}
          >
            {t('upcoming.viewAll')}
            <SvgIcon id="it-arrow-right" className="icon-sm icon-primary" size={18} />
          </Link>
        </div>
        {upcoming.length === 0 ? (
          <div
            className="p-5 rounded-3 text-center"
            style={{ backgroundColor: '#F5F7FB' }}
          >
            <p className="text-secondary mb-0 lead">{t('upcoming.noEvents')}</p>
          </div>
        ) : (
          <EventListClient events={upcoming} parseTitleKicker={parseTitleKicker} />
        )}
      </div>
    </section>
  );
}

async function EventsListHome({
  upcoming,
  parseTitleKicker,
}: {
  upcoming: Awaited<ReturnType<typeof loadUpcomingEvents>>;
  parseTitleKicker: boolean;
}) {
  const t = await getTranslations('home');

  return (
    <section className="py-5" aria-labelledby="home-list-title">
      <div className="container">
        <h1 id="home-list-title" className="h2 fw-bold mb-4">
          {t('upcoming.title')}
        </h1>
        {upcoming.length === 0 ? (
          <div
            className="p-5 rounded-3 text-center"
            style={{ backgroundColor: '#F5F7FB' }}
          >
            <p className="text-secondary mb-0 lead">{t('upcoming.noEvents')}</p>
          </div>
        ) : (
          <EventListClient events={upcoming} parseTitleKicker={parseTitleKicker} />
        )}
        <div className="text-center mt-4">
          <Link href="/events" className="btn btn-primary btn-lg">
            {t('upcoming.viewAll')}
          </Link>
        </div>
      </div>
    </section>
  );
}

async function LandingHome({
  upcoming,
  parseTitleKicker,
}: {
  upcoming: Awaited<ReturnType<typeof loadUpcomingEvents>>;
  parseTitleKicker: boolean;
}) {
  const t = await getTranslations('home');

  const heroBadges: { id: string; label: string }[] = [
    { id: 'it-video', label: t('hero.badges.noInstall') },
    { id: 'it-comment', label: t('hero.badges.interactive') },
    { id: 'it-file-video', label: t('hero.badges.recordings') },
    { id: 'it-hearing', label: t('hero.badges.accessible') },
  ];

  const steps = [1, 2, 3, 4] as const;

  const during: { key: string; icon: string }[] = [
    { key: 'qa', icon: 'it-comment' },
    { key: 'polls', icon: 'it-chart-line' },
    { key: 'wordcloud', icon: 'it-software' },
    { key: 'reactions', icon: 'it-star-full' },
    { key: 'chat', icon: 'it-mail-open' },
    { key: 'agenda', icon: 'it-list' },
  ];

  const afterEvent: { key: string; icon: string }[] = [
    { key: 'library', icon: 'it-video' },
    { key: 'transcript', icon: 'it-file-video' },
    { key: 'translation', icon: 'it-flag' },
    { key: 'dubbing', icon: 'it-hearing' },
  ];

  const projectPoints: { key: string; icon: string }[] = [
    { key: 'sovereignty', icon: 'it-locked' },
    { key: 'openSource', icon: 'it-open-source' },
    { key: 'gdpr', icon: 'it-lock' },
  ];

  // Open technologies behind the platform. Proper nouns → not translated.
  const techStack = [
    '.italia',
    'Next.js',
    'Jitsi Meet',
    'Kubernetes',
    'PostgreSQL',
    'WhisperX',
    'Qwen3',
  ];

  // High-level flow shown as a mini-diagram. Proper-noun labels → not translated.
  const archFlow = ['Browser', '.italia · Next.js', 'Jitsi Meet', 'AI in-cluster'];

  return (
    <>
      {/* ── Hero (community-first) ──────────────────────────────────────── */}
      <section
        className="text-white py-5"
        style={{
          background:
            'linear-gradient(135deg, #0066CC 0%, #004A99 50%, #003366 100%)',
        }}
        aria-labelledby="home-hero-title"
      >
        <div className="container py-4 py-lg-5">
          <div className="row justify-content-center text-center">
            <div className="col-lg-9 col-xl-8">
              <p
                className="text-uppercase fw-semibold mb-3"
                style={{ letterSpacing: '0.08em', fontSize: '0.85rem', opacity: 0.95 }}
              >
                {t('hero.kicker')}
              </p>
              <h1
                id="home-hero-title"
                className="display-5 fw-bold mb-3"
                style={{ letterSpacing: '-0.02em' }}
              >
                {t('hero.title')}
              </h1>
              <p
                className="lead mb-4 mx-auto"
                style={{ opacity: 0.92, fontSize: '1.15rem', lineHeight: 1.6, maxWidth: 660 }}
              >
                {t('hero.subtitle')}
              </p>
              <div className="d-flex flex-column flex-sm-row gap-3 justify-content-center mb-4">
                <Link
                  href="/events"
                  className="btn btn-light btn-lg px-4 fw-semibold text-primary"
                >
                  {t('hero.browseEvents')}
                </Link>
                <Link
                  href="/video-library"
                  className="btn btn-outline-light btn-lg px-4"
                >
                  {t('hero.watchRecordings')}
                </Link>
              </div>
              <ul className="list-unstyled d-flex flex-wrap justify-content-center gap-3 gap-md-4 mb-0 mt-4">
                {heroBadges.map((b) => (
                  <li
                    key={b.label}
                    className="d-inline-flex align-items-center gap-2"
                    style={{ fontSize: '0.95rem', opacity: 0.95 }}
                  >
                    <SvgIcon id={b.id} className="icon-white icon-sm" size={20} />
                    <span className="fw-semibold">{b.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── Prossimi eventi (subito, community-first) ──────────────────── */}
      <EventsSection upcoming={upcoming} parseTitleKicker={parseTitleKicker} />

      {/* ── Come si partecipa ──────────────────────────────────────────── */}
      <section className="py-5" style={{ backgroundColor: '#F5F7FB' }} aria-labelledby="home-howitworks-title">
        <div className="container">
          <div className="text-center mb-5">
            <h2 id="home-howitworks-title" className="h3 fw-semibold mb-2">
              {t('howItWorks.title')}
            </h2>
            <p className="text-secondary mb-0 mx-auto" style={{ maxWidth: 520 }}>
              {t('howItWorks.subtitle')}
            </p>
          </div>
          <ol className="row g-4 justify-content-center list-unstyled mb-0">
            {steps.map((num, idx) => (
              <li key={num} className="col-sm-6 col-lg-3">
                <div className="text-center position-relative">
                  <div
                    className="d-inline-flex align-items-center justify-content-center rounded-circle bg-primary text-white fw-bold mb-3"
                    style={{ width: 52, height: 52, fontSize: '1.3rem' }}
                    aria-hidden="true"
                  >
                    {num}
                  </div>
                  {idx < steps.length - 1 && (
                    <div
                      className="d-none d-lg-block position-absolute"
                      style={{
                        top: 26,
                        left: 'calc(50% + 35px)',
                        width: 'calc(100% - 70px)',
                        height: 2,
                        backgroundColor: 'var(--app-primary)',
                        opacity: 0.25,
                      }}
                      aria-hidden="true"
                    />
                  )}
                  <h3 className="h6 fw-semibold mb-1">
                    {t(`howItWorks.step${num}.title`)}
                  </h3>
                  <p
                    className="text-secondary mb-0 small mx-auto"
                    style={{ maxWidth: 200 }}
                  >
                    {t(`howItWorks.step${num}.desc`)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Cosa puoi fare durante un evento ───────────────────────────── */}
      <section className="py-5" aria-labelledby="home-during-title">
        <div className="container">
          <div className="text-center mb-5">
            <h2 id="home-during-title" className="h3 fw-semibold mb-2">
              {t('during.title')}
            </h2>
            <p className="text-secondary mb-0 mx-auto" style={{ maxWidth: 560 }}>
              {t('during.subtitle')}
            </p>
          </div>
          <div className="row g-4">
            {during.map((f) => (
              <div key={f.key} className="col-sm-6 col-lg-4">
                <div className="d-flex gap-3 h-100">
                  <span
                    className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0"
                    style={{ width: 48, height: 48, backgroundColor: 'rgba(0,102,204,0.10)' }}
                  >
                    <SvgIcon id={f.icon} className="icon-primary" size={24} />
                  </span>
                  <div>
                    <h3 className="h6 fw-semibold mb-1">{t(`during.${f.key}.title`)}</h3>
                    <p className="text-secondary mb-0" style={{ fontSize: '0.9rem' }}>
                      {t(`during.${f.key}.desc`)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Dopo l'evento (registrazioni + pipeline AI) ───────────────── */}
      <section className="py-5" style={{ backgroundColor: '#F5F7FB' }} aria-labelledby="home-after-title">
        <div className="container">
          <div className="text-center mb-5">
            <h2 id="home-after-title" className="h3 fw-semibold mb-2">
              {t('afterEvent.title')}
            </h2>
            <p className="text-secondary mb-0 mx-auto" style={{ maxWidth: 560 }}>
              {t('afterEvent.subtitle')}
            </p>
          </div>
          <div className="row g-4">
            {afterEvent.map((f) => (
              <div key={f.key} className="col-sm-6 col-lg-3">
                <div className="card h-100 border-0 rounded-3 shadow-sm">
                  <div className="card-body p-4">
                    <span
                      className="d-inline-flex align-items-center justify-content-center rounded-3 mb-3"
                      style={{ width: 52, height: 52, backgroundColor: 'rgba(0,102,204,0.10)' }}
                    >
                      <SvgIcon id={f.icon} className="icon-primary" size={26} />
                    </span>
                    <h3 className="h6 fw-semibold mb-2">{t(`afterEvent.${f.key}.title`)}</h3>
                    <p className="text-secondary mb-0" style={{ fontSize: '0.92rem' }}>
                      {t(`afterEvent.${f.key}.desc`)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Teaser progetto (in fondo: pubblico = altre PA / curiosi) ──── */}
      <section
        className="text-white py-5"
        style={{ background: 'linear-gradient(135deg, #17324D 0%, #102438 100%)' }}
        aria-labelledby="home-project-title"
      >
        <div className="container">
          <div className="row align-items-center g-4 g-lg-5">
            <div className="col-lg-5">
              <p
                className="text-uppercase fw-semibold mb-2"
                style={{ letterSpacing: '0.08em', fontSize: '0.8rem', opacity: 0.7 }}
              >
                {t('projectTeaser.kicker')}
              </p>
              <h2 id="home-project-title" className="h3 fw-bold mb-3">
                {t('projectTeaser.title')}
              </h2>
              <p className="mb-4" style={{ opacity: 0.85, lineHeight: 1.6 }}>
                {t('projectTeaser.body')}
              </p>
              <Link
                href="/service-inventory"
                className="btn btn-outline-light d-inline-flex align-items-center gap-2"
              >
                <SvgIcon id="it-list" className="icon-white icon-sm" size={18} />
                {t('projectTeaser.cta')}
              </Link>
              <div className="mt-4">
                <p
                  className="text-uppercase fw-semibold mb-2"
                  style={{ letterSpacing: '0.06em', fontSize: '0.72rem', opacity: 0.6 }}
                >
                  {t('projectTeaser.techTitle')}
                </p>
                <ul className="list-unstyled d-flex flex-wrap gap-2 mb-0">
                  {techStack.map((tech) => (
                    <li
                      key={tech}
                      className="px-2 py-1 rounded"
                      style={{
                        backgroundColor: 'rgba(255,255,255,0.10)',
                        fontSize: '0.82rem',
                      }}
                    >
                      {tech}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="col-lg-7">
              <div className="row g-3">
                {projectPoints.map((p) => (
                  <div key={p.key} className="col-12">
                    <div className="d-flex gap-3">
                      <span
                        className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0"
                        style={{ width: 44, height: 44, backgroundColor: 'rgba(255,255,255,0.12)' }}
                      >
                        <SvgIcon id={p.icon} className="icon-white" size={24} />
                      </span>
                      <div>
                        <h3 className="h6 fw-semibold mb-1 text-white">
                          {t(`projectTeaser.${p.key}.title`)}
                        </h3>
                        <p className="mb-0" style={{ opacity: 0.82, fontSize: '0.92rem' }}>
                          {t(`projectTeaser.${p.key}.desc`)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Mini-diagramma architettura (high-level, etichette = nomi propri) */}
          <div
            className="mt-5 pt-4"
            style={{ borderTop: '1px solid rgba(255,255,255,0.15)' }}
          >
            <p
              className="text-uppercase fw-semibold text-center mb-3"
              style={{ letterSpacing: '0.06em', fontSize: '0.72rem', opacity: 0.6 }}
            >
              {t('projectTeaser.archTitle')}
            </p>
            <ol className="list-unstyled d-flex flex-wrap align-items-center justify-content-center gap-2 gap-md-3 mb-0">
              {archFlow.map((node, idx) => (
                <Fragment key={node}>
                  <li
                    className="px-3 py-2 rounded-3 fw-semibold"
                    style={{ backgroundColor: 'rgba(255,255,255,0.10)', fontSize: '0.9rem' }}
                  >
                    {node}
                  </li>
                  {idx < archFlow.length - 1 && (
                    <li aria-hidden="true" className="d-inline-flex">
                      <SvgIcon id="it-arrow-right" className="icon-white icon-sm" size={18} />
                    </li>
                  )}
                </Fragment>
              ))}
            </ol>
          </div>
        </div>
      </section>
    </>
  );
}
