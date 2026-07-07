import type { Metadata } from 'next';
import { getTranslations, getLocale } from 'next-intl/server';

import { CHANGELOG } from '@/content/changelog';
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

  const dateFmt = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const repoUrl =
    typeof settings.githubUrl === 'string' && settings.githubUrl.startsWith('http')
      ? settings.githubUrl
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
            {CHANGELOG.map((rel) => {
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
                      <h2 className="h5 mb-3">{rel.title}</h2>
                      <ul className="mb-0 ps-3 d-flex flex-column gap-1">
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

          {repoUrl && (
            <p className="text-muted mt-4 mb-0" style={{ fontSize: '0.88rem' }}>
              {t('sourceNote')}{' '}
              <a
                href={`${repoUrl}/releases`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('sourceLink')}
              </a>
              .
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
