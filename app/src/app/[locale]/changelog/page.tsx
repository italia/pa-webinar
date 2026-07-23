import type { Metadata } from 'next';
import { getTranslations, getLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { getChangelog } from '@/content/changelog';
import { getSettings } from '@/lib/settings';
import { githubRepoUrl } from '@/lib/changelog/repo';
import { SbomViewer } from '@/components/changelog/sbom-viewer';

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

  // Only a trusted github.com repo lights up the artifact/source/Scorecard links
  // — the SBOM route applies the same guard, so page and API agree on what a
  // valid public repo is (the admin validator only checks it's a URL).
  const repoUrl = githubRepoUrl(settings.githubUrl);

  // "owner/repo" from the repo URL, for the OpenSSF Scorecard viewer.
  const repoPath = repoUrl ? repoUrl.replace(/^https:\/\/github\.com\//, '') : null;

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

                      {/* Secondo livello: niente prosa tecnica (ripeteva le note
                          utente), solo gli ARTEFATTI di quella release. `<details>`
                          nativo, comprimibile e accessibile. Reso quando il repo è
                          pubblico: ogni versione ha un tag, quindi Release/Sorgenti
                          sono sempre validi; l'SBOM solo dove esiste (`rel.sbom`),
                          e apre un visore interno invece di uno scarico grezzo. */}
                      {repoUrl && (
                        <details className="mt-3">
                          <summary
                            className="text-muted"
                            style={{ fontSize: '0.85rem', cursor: 'pointer' }}
                          >
                            {t('technicalDetail')}
                          </summary>
                          <div className="mt-2 d-flex flex-wrap gap-2 align-items-center">
                            {rel.sbom && (
                              <SbomViewer
                                version={rel.version}
                                rawUrl={`${repoUrl}/releases/download/v${rel.version}/sbom.spdx.json`}
                              />
                            )}
                            <a
                              className="btn btn-outline-secondary btn-sm"
                              style={{ fontSize: '0.8rem' }}
                              href={`${repoUrl}/releases/tag/v${rel.version}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              🔖 {t('releaseLink')} ↗
                            </a>
                            <a
                              className="btn btn-outline-secondary btn-sm"
                              style={{ fontSize: '0.8rem' }}
                              href={`${repoUrl}/tree/v${rel.version}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {'</>'} {t('sourcesLink')} ↗
                            </a>
                            <a
                              className="btn btn-outline-secondary btn-sm"
                              style={{ fontSize: '0.8rem' }}
                              href={`${repoUrl}/actions/workflows/release.yml`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              ⚙ {t('pipelineLink')} ↗
                            </a>
                          </div>
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

          {/* Link a livello di sito (non per-versione), visibili solo con un
              repository pubblico impostato: sorgenti/changelog e le scansioni di
              sicurezza di progetto — Scorecard OpenSSF e l'analisi del codice
              (CodeQL) — che non hanno un senso per-release. */}
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
              {' · '}
              <a
                href={`https://scorecard.dev/viewer/?uri=github.com/${repoPath}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('scorecardLink')}
              </a>
              {' · '}
              <a
                href={`${repoUrl}/security/code-scanning`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('codeScanningLink')}
              </a>
              .
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
