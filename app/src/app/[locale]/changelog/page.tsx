import type { Metadata } from 'next';
import { getTranslations, getLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import ReleaseCadence from '@/components/changelog/release-cadence';
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

  // Ordinate dalla più recente: la prima e l'ultima dell'elenco sono gli estremi.
  const newest = releases[0];
  const oldest = releases[releases.length - 1];
  const cadenceSummary =
    newest && oldest
      ? t('cadenceSummary', {
          count: releases.length,
          from: dateFmt.format(new Date(oldest.date)),
          to: dateFmt.format(new Date(newest.date)),
        })
      : '';

  return (
    <div className="container py-5">
      <div className="row justify-content-center">
        <div className="col-lg-9">
          <header className="mb-4">
            <h1 className="mb-3">{t('title')}</h1>
            <p className="lead text-muted mb-3">{t('intro')}</p>

            {/* Il ritmo, non la cronologia: vedi il commento in ReleaseCadence.
                Il riassunto è TESTO, e viene prima del disegno — il grafico lo
                illustra, non lo sostituisce. */}
            {releases.length > 1 && (
              <section aria-labelledby="cadence-h" className="mt-4">
                <h2 id="cadence-h" className="h6 text-muted mb-1">
                  {t('cadence')}
                </h2>
                <p className="text-muted mb-2" style={{ fontSize: '0.88rem' }}>
                  {cadenceSummary}
                </p>
                <ReleaseCadence
                  releases={releases.map((r) => ({ version: r.version, date: r.date }))}
                  currentVersion={CURRENT_VERSION}
                  formatDate={(d) => dateFmt.format(d)}
                  locale={locale}
                  label={cadenceSummary}
                />
              </section>
            )}
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
                        <time
                          className="text-muted"
                          dateTime={rel.date}
                          style={{ fontSize: '0.85rem' }}
                        >
                          {dateFmt.format(new Date(rel.date))}
                        </time>
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
                    </div>
                  </article>
                </li>
              );
            })}
          </ol>

          {/* Trasparenza per-versione, verso le pagine PUBBLICHE che la
              piattaforma gia' serve. NON verso GitHub: il repository e'
              privato (le release danno 404 al pubblico) e le versioni piu'
              recenti non hanno nemmeno una GitHub Release. La distinta dei
              componenti la da' /service-inventory (CycloneDX 1.6), l'SBOM e la
              Scorecard le da' /security. */}
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
