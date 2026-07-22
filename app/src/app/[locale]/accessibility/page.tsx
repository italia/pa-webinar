import type { Metadata } from 'next';
import { getTranslations, getLocale } from 'next-intl/server';

import { getSettings } from '@/lib/settings';
import LegalDocumentPage from '@/components/layout/legal-document-page';
import { getLocalizedExact, type LocalizedField } from '@/lib/utils/locale';

// Official AgID references for the accessibility statement model. External,
// so rendered as plain anchors (not the locale-prefixed <Link>).
const AGID_FORM_URL = 'https://form.agid.gov.it/';
const AGID_ACCESSIBILITY_URL =
  'https://www.agid.gov.it/it/design-servizi/accessibilita';

interface AccessibilityPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: AccessibilityPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'legal.accessibility' });

  return {
    title: t('metaTitle'),
  };
}

export default async function AccessibilityPage() {
  const t = await getTranslations('legal.accessibility');
  const locale = await getLocale();
  const settings = await getSettings();

  // Each adopting PA can publish its own statement via SiteSetting; that
  // overrides the built-in AgID-model template below.
  // Esatto, non con fallback: un documento legale non authored in questa
  // lingua deve mostrare il testo integrato e tradotto, non quello
  // italiano dell'ente spacciato per la versione inglese.
  const dbContent = getLocalizedExact(settings.accessibility as LocalizedField, locale);

  if (dbContent) {
    return <LegalDocumentPage title={t('title')} htmlContent={dbContent} />;
  }

  const sections = [
    'conformance',
    'nonAccessible',
    'preparation',
    'feedback',
    'enforcement',
  ] as const;

  return (
    <div className="container py-5">
      <div className="row justify-content-center">
        <div className="col-lg-9">
          <header className="mb-4">
            <h1 className="mb-3">{t('title')}</h1>
            <p className="lead text-muted mb-0">{t('intro')}</p>
          </header>

          <div className="d-flex flex-column gap-3">
            {sections.map((key) => (
              <div key={key} className="card shadow-sm border-0" style={{ borderRadius: 8 }}>
                <div className="card-body p-4">
                  <h2 className="h4 mb-3">{t(`sections.${key}.title`)}</h2>
                  <p className="mb-0" style={{ whiteSpace: 'pre-line' }}>
                    {t(`sections.${key}.body`)}
                  </p>
                </div>
              </div>
            ))}

            <div className="card shadow-sm border-0" style={{ borderRadius: 8 }}>
              <div className="card-body p-4">
                <h2 className="h4 mb-3">{t('note.title')}</h2>
                <p className="mb-3">{t('note.body')}</p>
                <ul className="list-unstyled mb-0 d-flex flex-column gap-2">
                  <li>
                    <a href={AGID_FORM_URL} target="_blank" rel="noopener noreferrer">
                      {t('links.agidForm')}
                    </a>
                  </li>
                  <li>
                    <a
                      href={AGID_ACCESSIBILITY_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t('links.difensore')}
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
