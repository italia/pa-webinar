'use client';

import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { useSettings } from '@/lib/settings-context';

interface FooterLink {
  title: string;
  url: string;
  section: 'main' | 'legal';
}

export default function PAFooter() {
  const t = useTranslations();
  const settings = useSettings();

  const orgName =
    settings.organizationName || t('footer.departmentName');
  const parentOrg =
    settings.parentOrganization || t('footer.presidencyName');
  const orgUrl = settings.organizationUrl || 'https://innovazione.gov.it';
  const githubUrl = settings.githubUrl || 'https://github.com/italia/eventi-dtd';

  let footerLinks: FooterLink[] = [];
  try {
    const raw =
      typeof settings.footerLinks === 'string'
        ? JSON.parse(settings.footerLinks)
        : settings.footerLinks;
    if (Array.isArray(raw)) footerLinks = raw;
  } catch {
    // fallback to empty
  }

  const legalLinks = footerLinks.filter((l) => l.section === 'legal');

  return (
    <footer className="it-footer" id="footer">
      <div className="it-footer-main">
        <div className="container">
          <section>
            <div className="row clearfix">
              <div className="col-sm-12">
                <div className="it-brand-wrapper">
                  <Link href="/" className="d-inline-block">
                    <div className="it-brand-text">
                      <h2 className="mb-0">{orgName}</h2>
                      <h3 className="d-none d-md-block mb-0">{parentOrg}</h3>
                    </div>
                  </Link>
                </div>
              </div>
            </div>
          </section>
          <section className="py-4">
            <div className="row">
              <div className="col-lg-4 col-md-4 pb-2">
                <h4>
                  <Link
                    href="/eventi"
                    className="text-white text-decoration-none"
                  >
                    {t('nav.events')}
                  </Link>
                </h4>
              </div>
              <div className="col-lg-4 col-md-4 pb-2">
                <h4>{t('footer.contacts')}</h4>
                <ul className="footer-list link-list clearfix">
                  <li>
                    <a
                      href={orgUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="list-item"
                    >
                      {new URL(orgUrl).hostname.replace(/^www\./, '')}
                    </a>
                  </li>
                  {settings.supportEmail && (
                    <li>
                      <a
                        href={`mailto:${settings.supportEmail}`}
                        className="list-item"
                      >
                        {settings.supportEmail}
                      </a>
                    </li>
                  )}
                </ul>
              </div>
              <div className="col-lg-4 col-md-4 pb-2">
                <h4>{t('footer.openSource')}</h4>
                <ul className="footer-list link-list clearfix">
                  {githubUrl && (
                    <li>
                      <a
                        href={githubUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="list-item"
                      >
                        GitHub
                      </a>
                    </li>
                  )}
                </ul>
              </div>
            </div>
          </section>
        </div>
      </div>

      <div className="it-footer-small-prints clearfix">
        <div className="container">
          <h3 className="visually-hidden">{t('footer.legalNotes')}</h3>
          <ul className="it-footer-small-prints-list list-inline mb-0 d-flex flex-column flex-md-row">
            {legalLinks.length > 0 ? (
              legalLinks.map((link) => (
                <li key={link.url} className="list-inline-item">
                  {link.url.startsWith('/') ? (
                    <Link href={link.url}>{link.title}</Link>
                  ) : (
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {link.title}
                    </a>
                  )}
                </li>
              ))
            ) : (
              <>
                <li className="list-inline-item">
                  <Link href="/privacy">{t('footer.privacy')}</Link>
                </li>
                <li className="list-inline-item">
                  <Link href="/accessibilita">
                    {t('footer.accessibility')}
                  </Link>
                </li>
                <li className="list-inline-item">
                  <Link href="/note-legali">{t('footer.legalNotes')}</Link>
                </li>
              </>
            )}
          </ul>
        </div>
      </div>
    </footer>
  );
}
