/**
 * Home in parole semplici.
 *
 * Pensata per chi non frequenta gli eventi online e deve capire in dieci
 * secondi cosa fare: un titolo, una frase, un invito solo. Nessun nome di
 * tecnologia, nessuna sigla, nessun elenco di funzionalita' — quelle si
 * scoprono usandole, non leggendole.
 *
 * I tre passi non sono decorazione: la domanda che arriva piu' spesso a chi
 * organizza non e' «cosa fa questa piattaforma» ma «devo installare
 * qualcosa?».
 */
import { getTranslations } from 'next-intl/server';

import EventListClient from '@/components/events/event-list-client';
import SvgIcon from '@/components/home/svg-icon';
import type { EventoHome } from '@/components/home/landing-istituzionale';
import { Link, percorso } from '@/i18n/navigation';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';

interface Props {
  upcoming: EventoHome[];
  parseTitleKicker: boolean;
  organizationName: string;
  locale: string;
}

export default async function LandingSemplice({
  upcoming,
  parseTitleKicker,
  organizationName,
  locale,
}: Props) {
  const t = await getTranslations('home');
  const prossimo = upcoming[0];

  const passi: { key: 'choose' | 'name' | 'enter'; icon: string }[] = [
    { key: 'choose', icon: 'it-calendar' },
    { key: 'name', icon: 'it-user' },
    { key: 'enter', icon: 'it-video' },
  ];

  return (
    <>
      <section className="py-5" aria-labelledby="home-semplice-title">
        <div className="container py-4 py-lg-5">
          <div className="row justify-content-center text-center">
            <div className="col-lg-9 col-xl-8">
              <h1 id="home-semplice-title" className="display-5 fw-bold mb-3">
                {t('simple.title', { organization: organizationName })}
              </h1>
              <p className="lead mb-4" style={{ color: '#33485F' }}>
                {t('simple.subtitle')}
              </p>

              {prossimo ? (
                <>
                  <Link
                    href={percorso(`/events/${prossimo.slug}`)}
                    className="btn btn-primary btn-lg px-5"
                  >
                    {t('simple.cta')}
                  </Link>
                  <p className="mt-3 mb-0" style={{ color: '#33485F' }}>
                    <span className="fw-semibold">
                      {getLocalized(prossimo.title as LocalizedField, locale)}
                    </span>
                    {' · '}
                    {new Intl.DateTimeFormat(locale, {
                      dateStyle: 'long',
                      timeStyle: 'short',
                      timeZone: prossimo.timezone || 'Europe/Rome',
                    }).format(new Date(prossimo.startsAt))}
                  </p>
                </>
              ) : (
                <p className="mb-0 lead text-secondary">{t('simple.noEvents')}</p>
              )}
            </div>
          </div>
        </div>
      </section>

      <section
        className="py-5"
        style={{ backgroundColor: '#F5F7FB' }}
        aria-labelledby="home-semplice-steps"
      >
        <div className="container">
          <h2 id="home-semplice-steps" className="h4 fw-semibold text-center mb-4">
            {t('simple.stepsTitle')}
          </h2>
          <div className="row g-4 justify-content-center">
            {passi.map((p, i) => (
              <div className="col-md-4" key={p.key}>
                <div className="text-center px-3">
                  <div
                    className="d-inline-flex align-items-center justify-content-center rounded-circle mb-3"
                    style={{ width: 64, height: 64, backgroundColor: '#E3EDF9' }}
                  >
                    <SvgIcon id={p.icon} className="icon-primary" size={28} />
                  </div>
                  <p className="fw-semibold mb-1">
                    {i + 1}. {t(`simple.steps.${p.key}.title`)}
                  </p>
                  <p className="mb-0" style={{ color: '#33485F', fontSize: '0.95rem' }}>
                    {t(`simple.steps.${p.key}.body`)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {upcoming.length > 0 && (
        <section className="py-5" aria-labelledby="home-semplice-list">
          <div className="container">
            <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-4">
              <h2 id="home-semplice-list" className="h4 fw-semibold mb-0">
                {t('simple.listTitle')}
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
            <EventListClient events={upcoming} parseTitleKicker={parseTitleKicker} />
          </div>
        </section>
      )}
    </>
  );
}
