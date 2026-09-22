/**
 * Home sobria e istituzionale.
 *
 * L'impianto predefinito racconta il progetto — come funziona, con quali
 * tecnologie, cosa si puo' fare in diretta — ed e' la pagina giusta per chi la
 * piattaforma la propone. Per un ente che la riusa e pubblica i propri
 * incontri e' la pagina sbagliata: chi arriva cerca il prossimo appuntamento e
 * il modo di iscriversi, non l'architettura.
 *
 * Qui in cima c'e' l'ente e il prossimo appuntamento, sotto gli altri, e le
 * tre righe di rassicurazione sono scritte in italiano corrente: nessun nome
 * di tecnologia, nessuna sigla.
 */
import { getTranslations } from 'next-intl/server';

import EventListClient from '@/components/events/event-list-client';
import SvgIcon from '@/components/home/svg-icon';
import { Link } from '@/i18n/navigation';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';

export interface EventoHome {
  id: string;
  slug: string;
  title: Record<string, string>;
  description: Record<string, string> | null;
  startsAt: string;
  endsAt: string;
  timezone: string;
  maxParticipants: number;
  registrationCount: number;
  status: string;
  recordingUrl: string | null;
  speakersInfo: Record<string, string> | null;
  organizerName: string | null;
  imageUrl: string | null;
  parseTitleKicker: boolean | null;
}

interface Props {
  upcoming: EventoHome[];
  parseTitleKicker: boolean;
  organizationName: string;
  siteDescription: string;
  locale: string;
}

export default async function LandingIstituzionale({
  upcoming,
  parseTitleKicker,
  organizationName,
  siteDescription,
  locale,
}: Props) {
  const t = await getTranslations('home');
  const prossimo = upcoming[0];
  const altri = upcoming.slice(1);

  const punti: { key: 'noInstall' | 'accessible' | 'privacy'; icon: string }[] = [
    { key: 'noInstall', icon: 'it-video' },
    { key: 'accessible', icon: 'it-hearing' },
    { key: 'privacy', icon: 'it-lock' },
  ];

  return (
    <>
      <section
        className="py-5"
        style={{ backgroundColor: '#F5F7FB', borderBottom: '1px solid #E3E7EF' }}
        aria-labelledby="home-ist-title"
      >
        <div className="container py-3">
          <p
            className="text-uppercase fw-semibold mb-2"
            style={{ letterSpacing: '0.08em', fontSize: '0.82rem', color: '#5B6B7F' }}
          >
            {organizationName}
          </p>
          <h1 id="home-ist-title" className="h1 fw-bold mb-3">
            {t('institutional.title')}
          </h1>
          {siteDescription && (
            <p className="lead mb-0" style={{ maxWidth: '46rem', color: '#33485F' }}>
              {siteDescription}
            </p>
          )}
        </div>
      </section>

      {/* Il prossimo appuntamento in evidenza: e' la domanda con cui la
          maggior parte delle persone arriva su questa pagina. */}
      <section className="py-5" aria-labelledby="home-ist-next">
        <div className="container">
          <h2 id="home-ist-next" className="h4 fw-semibold mb-3">
            {t('institutional.nextTitle')}
          </h2>

          {prossimo ? (
            <div
              className="p-4 p-lg-5 rounded-3"
              style={{ border: '1px solid #E3E7EF', backgroundColor: '#fff' }}
            >
              <p className="fw-semibold mb-2" style={{ color: '#0066CC' }}>
                <SvgIcon id="it-calendar" className="icon-sm icon-primary me-2" size={18} />
                {new Intl.DateTimeFormat(locale, {
                  dateStyle: 'full',
                  timeStyle: 'short',
                  timeZone: prossimo.timezone || 'Europe/Rome',
                }).format(new Date(prossimo.startsAt))}
              </p>
              <h3 className="h3 fw-bold mb-3">
                {getLocalized(prossimo.title as LocalizedField, locale)}
              </h3>
              {prossimo.description && (
                <p className="mb-4" style={{ maxWidth: '48rem', color: '#33485F' }}>
                  {getLocalized(prossimo.description as LocalizedField, locale).slice(0, 260)}
                </p>
              )}
              <Link href={`/events/${prossimo.slug}`} className="btn btn-primary btn-lg">
                {t('institutional.nextCta')}
              </Link>
            </div>
          ) : (
            <div className="p-5 rounded-3 text-center" style={{ backgroundColor: '#F5F7FB' }}>
              <p className="text-secondary mb-0 lead">{t('upcoming.noEvents')}</p>
            </div>
          )}
        </div>
      </section>

      {altri.length > 0 && (
        <section className="pb-5" aria-labelledby="home-ist-others">
          <div className="container">
            <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-4">
              <h2 id="home-ist-others" className="h4 fw-semibold mb-0">
                {t('institutional.othersTitle')}
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
            <EventListClient events={altri} parseTitleKicker={parseTitleKicker} />
          </div>
        </section>
      )}

      <section
        className="py-5"
        style={{ backgroundColor: '#F5F7FB', borderTop: '1px solid #E3E7EF' }}
        aria-labelledby="home-ist-points"
      >
        <div className="container">
          <h2 id="home-ist-points" className="visually-hidden">
            {t('institutional.pointsTitle')}
          </h2>
          <div className="row g-4">
            {punti.map((p) => (
              <div className="col-md-4" key={p.key}>
                <div className="d-flex gap-3">
                  <SvgIcon id={p.icon} className="icon-primary flex-shrink-0" size={28} />
                  <div>
                    <p className="fw-semibold mb-1">{t(`institutional.points.${p.key}.title`)}</p>
                    <p className="mb-0" style={{ color: '#33485F', fontSize: '0.95rem' }}>
                      {t(`institutional.points.${p.key}.body`)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
