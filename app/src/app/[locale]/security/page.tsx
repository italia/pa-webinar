import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { getSettings } from '@/lib/settings';

interface SecurityPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: SecurityPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'legal.security' });
  return { title: t('metaTitle') };
}

export default async function SecurityPage() {
  const t = await getTranslations('legal.security');
  const settings = await getSettings();
  const repoUrl = settings.githubUrl || 'https://github.com/italia/pa-webinar';
  const repoPath = repoUrl.replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
  const scorecardBadge = `https://api.scorecard.dev/projects/github.com/${repoPath}/badge`;
  const scorecardViewer = `https://scorecard.dev/viewer/?uri=github.com/${repoPath}`;

  const sections = [
    { key: 'openSource', title: t('sections.openSource.title'), body: t('sections.openSource.body') },
    { key: 'sbom', title: t('sections.sbom.title'), body: t('sections.sbom.body') },
    { key: 'scorecard', title: t('sections.scorecard.title'), body: t('sections.scorecard.body') },
    { key: 'scanning', title: t('sections.scanning.title'), body: t('sections.scanning.body') },
    { key: 'disclosure', title: t('sections.disclosure.title'), body: t('sections.disclosure.body') },
  ];

  return (
    <div className="container py-5">
      <div className="row justify-content-center">
        <div className="col-lg-9">
          <header className="mb-4">
            <h1 className="mb-3">{t('title')}</h1>
            <p className="lead text-muted mb-3">{t('intro')}</p>
            <a
              href={scorecardViewer}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t('links.scorecard')}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={scorecardBadge} alt={t('links.scorecard')} />
            </a>
          </header>

          <div className="d-flex flex-column gap-3">
            {sections.map((s) => (
              <div
                key={s.key}
                className="card shadow-sm border-0"
                style={{ borderRadius: 8 }}
              >
                <div className="card-body p-4">
                  <h2 className="h4 mb-3">{s.title}</h2>
                  <p className="mb-0">{s.body}</p>
                </div>
              </div>
            ))}

            <div className="card shadow-sm border-0" style={{ borderRadius: 8 }}>
              <div className="card-body p-4">
                <ul className="list-unstyled mb-0 d-flex flex-column gap-2">
                  <li>
                    <a href={repoUrl} target="_blank" rel="noopener noreferrer">
                      {t('links.sourceCode')}
                    </a>
                  </li>
                  <li>
                    <a
                      href={`${repoUrl}/releases/latest`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t('links.latestRelease')}
                    </a>
                  </li>
                  <li>
                    <a
                      href={scorecardViewer}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t('links.scorecard')}
                    </a>
                  </li>
                  <li>
                    <a
                      href={`${repoUrl}/blob/main/SECURITY.md`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t('links.securityPolicy')}
                    </a>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
