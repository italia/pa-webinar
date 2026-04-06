'use client';

import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';

export default function PAFooter() {
  const t = useTranslations();

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
                      <h2 className="mb-0">{t('footer.departmentName')}</h2>
                      <h3 className="d-none d-md-block mb-0">
                        {t('footer.presidencyName')}
                      </h3>
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
                  <Link href="/eventi" className="text-white text-decoration-none">
                    {t('nav.events')}
                  </Link>
                </h4>
              </div>
              <div className="col-lg-4 col-md-4 pb-2">
                <h4>{t('footer.contacts')}</h4>
                <ul className="footer-list link-list clearfix">
                  <li>
                    <a
                      href="https://innovazione.gov.it"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="list-item"
                    >
                      innovazione.gov.it
                    </a>
                  </li>
                </ul>
              </div>
              <div className="col-lg-4 col-md-4 pb-2">
                <h4>{t('footer.openSource')}</h4>
                <ul className="footer-list link-list clearfix">
                  <li>
                    <a
                      href="https://github.com/italia/eventi-dtd"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="list-item"
                    >
                      GitHub
                    </a>
                  </li>
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
            <li className="list-inline-item">
              <Link href="/privacy">{t('footer.privacy')}</Link>
            </li>
            <li className="list-inline-item">
              <Link href="/accessibilita">{t('footer.accessibility')}</Link>
            </li>
            <li className="list-inline-item">
              <Link href="/note-legali">{t('footer.legalNotes')}</Link>
            </li>
            <li className="list-inline-item">
              <Link href="/status">{t('footer.systemStatus')}</Link>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
