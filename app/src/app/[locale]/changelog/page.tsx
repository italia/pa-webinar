import type { Metadata } from 'next';
import { getTranslations, getLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { getChangelog } from '@/content/changelog';
import { getSettings } from '@/lib/settings';

// Marks the release matching the currently deployed build so visitors can see
// "what am I running". Only meaningful on release builds where the tag is set.
const CURRENT_VERSION = process.env.NEXT_PUBLIC_BUILD_VERSION ?? '';

interface ChangelogPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: ChangelogPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'changelog' });
  return { title: t('metaTitle') };
}

export default async function ChangelogPage() {
  const t = await getTranslations('changelog');
  const locale = await getLocale();
  const settings = await getSettings();

  // Release notes in the reader's language, falling back to English (see
  // content/changelog): the page used to render Italian to everyone.
  const releases = getChangelog(locale);

  const dateFmt = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const repoUrl =
    typeof settings.githubUrl === 'string' && settings.githubUrl.startsWith('http')
      ? settings.githubUrl.replace(/\/+$/, '')
      : null;

  return (
    <div className="container py-5">
      <div className="row justify-content-center">
        <div className="col-lg-9">
          <header className="mb-4">
            <h1 className="mb-3">{t('title')}</h1>
            <p className="lead text-muted mb-0">{t('intro')}</p>
          </header>

          <ol className="list-unstyled d-flex flex-column gap-3 mb-0">
            {releases.map((rel) => {
              const isCurrent = CURRENT_VERSION === rel.version;
              return (
                <li key={rel.version}>
                  <article
                    className="card border-0 shadow-sm"
                    style={{
                      borderRadius: 8,
                      borderLeft: isCurrent
                        ? '4px solid var(--app-primary, #06c)'
                        : undefined,
                    }}
                    aria-label={`v${rel.version}`}
                  >
                    <div className="card-body p-4">
                      <div className="d-flex flex-wrap align-items-baseline gap-2 mb-2">
                        <span
                          className="badge rounded-pill"
                          style={{
                            background: 'var(--app-primary, #06c)',
                            color: '#fff',
                            fontSize: '0.9rem',
                          }}
                        >
                          v{rel.version}
                        </span>
                        {isCurrent && (
                          <span className="badge rounded-pill bg-success">
                            {t('current')}
                          </span>
                        )}
                        {rel.security && (
                          <span
                            className="badge rounded-pill"
                            style={{ background: '#FFF3CD', color: '#664D03', fontSize: '0.8rem' }}
                          >
                            🔒 {t('securityBadge')}
                          </span>
                        )}
                        <time
                          className="text-muted"
                          dateTime={rel.date}
                          style={{ fontSize: '0.85rem' }}
                        >
                          {dateFmt.format(new Date(rel.date))}
                        </time>
                        {/* Link per-versione alla release GitHub, che porta l'SBOM
                            di quella versione. Reso solo quando il repo è pubblico
                            (githubUrl impostato) E quella release ha davvero un
                            asset SBOM (`rel.sbom`): molte versioni sono solo tag
                            git, senza release né SBOM — un link generico su tutte
                            darebbe un 404 o prometterebbe un SBOM inesistente. */}
                        {repoUrl && rel.sbom && (
                          <a
                            className="ms-auto"
                            style={{ fontSize: '0.82rem' }}
                            href={`${repoUrl}/releases/tag/v${rel.version}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {t('releaseLink')} ↗
                          </a>
                        )}
                      </div>
                      <h2 className="h5 mb-3" lang={rel.textLocale}>
                        {rel.title}
                      </h2>
                      <ul className="mb-0 ps-3 d-flex flex-column gap-1" lang={rel.textLocale}>
                        {rel.notes.map((note, i) => (
                          <li key={i} style={{ fontSize: '0.94rem' }}>
                            {note}
                          </li>
                        ))}
                      </ul>

                      {/* Due livelli: le note d'impatto utente sopra, il dettaglio
                          tecnico in una linguetta comprimibile. `<details>` è
                          nativo (niente JS, accessibile). Il contenuto è in
                          inglese — è per chi sviluppa/riusa — la sola etichetta
                          è tradotta. Compare solo dove il dettaglio esiste. */}
                      {rel.technical && rel.technical.length > 0 && (
                        <details className="mt-3">
                          <summary
                            className="text-muted"
                            style={{ fontSize: '0.85rem', cursor: 'pointer' }}
                          >
                            {t('technicalDetail')}
                          </summary>
                          <ul
                            className="mt-2 mb-0 ps-3 d-flex flex-column gap-1"
                            lang="en"
                            style={{ fontSize: '0.86rem', color: 'var(--app-muted, #5a6772)' }}
                          >
                            {rel.technical.map((line, i) => (
                              <li key={i}>{line}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                  </article>
                </li>
              );
            })}
          </ol>

          {/* Trasparenza a livello di sito, sempre pubblica: la distinta dei
              componenti attuali la dà /service-inventory (CycloneDX 1.6), l'SBOM
              del deploy corrente e la Scorecard le dà /security. I link
              per-versione a GitHub (con l'SBOM di quella release) sono sulle
              card, quando il repo è pubblico. */}
          <p className="text-muted mt-4 mb-0" style={{ fontSize: '0.88rem' }}>
            {t('transparencyNote')}{' '}
            <Link href="/service-inventory">{t('transparencyInventory')}</Link>
            {' · '}
            <Link href="/security">{t('transparencySecurity')}</Link>
            .
          </p>

          {/* I link diretti a GitHub compaiono SOLO se un amministratore ha
              impostato un repository pubblico (githubUrl vuoto in prod oggi).
              Cosi' non pubblichiamo mai un link a un 404. */}
          {repoUrl && (
            <p className="text-muted mt-2 mb-0" style={{ fontSize: '0.88rem' }}>
              {t('sourceNote')}{' '}
              <a href={`${repoUrl}/releases`} target="_blank" rel="noopener noreferrer">
                {t('sourceLink')}
              </a>
              {' · '}
              <a
                href={`${repoUrl}/blob/main/CHANGELOG.md`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('rawChangelog')}
              </a>
              .
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
