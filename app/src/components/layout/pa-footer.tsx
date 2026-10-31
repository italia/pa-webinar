'use client';

import { useFormatter, useLocale, useTranslations } from 'next-intl';

import { Icon } from '@/components/ui/icon';
import { Link, percorsoSeNoto } from '@/i18n/navigation';
import { useSettings } from '@/lib/settings-context';
import { mottoDelSito } from '@/lib/utils/locale';

import { LINK_PIEDE_EVENTI, linkVisibile } from './public-links';

interface FooterLink {
  title: string;
  url: string;
  section: 'main' | 'legal';
}

// Build identity is baked in by webpack DefinePlugin from build args set in
// dev.yml / release.yml. Dot notation is required for the inlining — bracket
// notation reads runtime env, which is empty for NEXT_PUBLIC_* in a
// standalone Next server.
const BUILD_VERSION = process.env.NEXT_PUBLIC_BUILD_VERSION ?? '';
const BUILD_SHA = process.env.NEXT_PUBLIC_BUILD_SHA ?? '';
const BUILD_CHANNEL = process.env.NEXT_PUBLIC_BUILD_CHANNEL ?? 'dev';
const BUILD_DATE = process.env.NEXT_PUBLIC_BUILD_DATE ?? '';

// Inline mono-stroke SVGs so the footer bar doesn't depend on the async
// Bootstrap Italia sprite.
const FOOTER_ICON_SIZE = 14;
function FooterIconShield() {
  return (
    <svg width={FOOTER_ICON_SIZE} height={FOOTER_ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z" />
    </svg>
  );
}
function FooterIconAccessibility() {
  return (
    <svg width={FOOTER_ICON_SIZE} height={FOOTER_ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="4.5" r="1.8" />
      <path d="M5 8l4 1.5v4l-1.5 6" />
      <path d="M19 8l-4 1.5v4l1.5 6" />
      <path d="M9 12h6" />
    </svg>
  );
}
function FooterIconDocument() {
  return (
    <svg width={FOOTER_ICON_SIZE} height={FOOTER_ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 3h8l4 4v14H7z" />
      <path d="M15 3v4h4" />
      <path d="M10 12h6M10 16h6" />
    </svg>
  );
}
function FooterIconLink() {
  return (
    <svg width={FOOTER_ICON_SIZE} height={FOOTER_ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
    </svg>
  );
}
function FooterIconTag() {
  return (
    <svg width={FOOTER_ICON_SIZE} height={FOOTER_ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12V4h8l10 10-8 8L3 12z" />
      <circle cx="7.5" cy="7.5" r="1.2" />
    </svg>
  );
}

// Pick a matching icon for custom (admin-defined) legal links based on the
// URL/title — best-effort, falls back to the generic link glyph.
function pickLegalIcon(link: FooterLink): React.ReactNode {
  const hay = `${link.url} ${link.title}`.toLowerCase();
  if (/privac/.test(hay)) return <FooterIconShield />;
  if (/access/.test(hay)) return <FooterIconAccessibility />;
  if (/(legal|notice|term|cookie)/.test(hay)) return <FooterIconDocument />;
  return <FooterIconLink />;
}

// Render an icon + label pair with consistent spacing and the icon kept
// visually subdued so it reads as decoration, not a second affordance.
function IconLabel({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="d-inline-flex align-items-center" style={{ gap: '0.375rem' }}>
      <span style={{ opacity: 0.75, display: 'inline-flex' }}>{icon}</span>
      <span>{children}</span>
    </span>
  );
}


/** Il segno di un link che si apre in una nuova finestra: icona e testo per
 *  chi usa un lettore di schermo. */
function NuovaFinestra({ testo }: { testo: string }) {
  return (
    <>
      <Icon icon="it-external-link" size="xs" color="white" className="ms-1" />
      <span className="visually-hidden"> ({testo})</span>
    </>
  );
}

export default function PAFooter({
  inventarioPubblicato = true,
}: {
  /** L'inventario dei servizi ha un indirizzo: senza, la pagina dice solo
   *  «non pubblicato» e il link non si mostra. */
  inventarioPubblicato?: boolean;
}) {
  const t = useTranslations();
  const settings = useSettings();
  const locale = useLocale();

  // Come nella fascia alta: i nomi vengono dalla configurazione, mai da un
  // ente scritto nel codice. Senza ente si firma col nome del sito.
  const orgName =
    settings.organizationName?.trim() || settings.siteName?.trim() || t('common.appName');
  const parentOrg =
    settings.parentOrganization?.trim() || mottoDelSito(settings.siteTagline, locale);
  const orgUrl = settings.organizationUrl || '#';
  const githubUrl = settings.githubUrl || '';

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
  // I link della sezione «Principale»: una colonna loro, «Link utili».
  const mainLinks = footerLinks.filter((l) => l.section === 'main');
  // Fuori dal sito, in una nuova finestra: gli indirizzi web completi (anche
  // senza schema, «//host»). mailto: e tel: non aprono finestre.
  const esterno = (url: string) => /^(https?:)?\/\//i.test(url);
  // Senza sito dell'ente né email di supporto la colonna «Contatti»
  // resterebbe un titolo sopra il vuoto: non si disegna.
  const conContatti = orgUrl !== '#' || Boolean(settings.supportEmail);
  // Le colonne in una riga sola: tre o quattro, secondo quelle che ci sono.
  const colonne = 2 + (conContatti ? 1 : 0) + (mainLinks.length > 0 ? 1 : 0);
  const colonna = colonne === 4 ? 'col-lg-3 col-md-6 pb-2' : 'col-lg-4 col-md-4 pb-2';

  return (
    <footer className="it-footer" id="footer" tabIndex={-1}>
      <div className="it-footer-main">
        <div className="container">
          <section>
            <div className="row clearfix">
              <div className="col-sm-12">
                <div className="it-brand-wrapper">
                  <Link href="/" className="d-inline-flex align-items-center">
                    {/* PA Webinar mark (white knockout) on the dark footer —
                        decorative next to the org name text. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/images/logo/pa-webinar-mark-white.svg"
                      alt=""
                      aria-hidden="true"
                      style={{ height: 44, marginRight: 12 }}
                    />
                    <div className="it-brand-text">
                      <h2 className="mb-0">{orgName}</h2>
                      {parentOrg && <h3 className="d-none d-md-block mb-0">{parentOrg}</h3>}
                    </div>
                  </Link>
                </div>
              </div>
            </div>
          </section>
          <section className="py-4">
            <div className="row">
              <div className={colonna}>
                <h4>
                  <Link
                    href="/events"
                    className="text-white text-decoration-none"
                  >
                    {t('nav.events')}
                  </Link>
                </h4>
                <ul className="footer-list link-list clearfix">
                  {LINK_PIEDE_EVENTI.filter((l) => linkVisibile(l, settings)).map((l) => (
                    <li key={l.href}>
                      <Link href={l.href} className="list-item text-white">
                        {t(l.labelKey)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
              {conContatti && (
                <div className={colonna}>
                  <h4>{t('footer.contacts')}</h4>
                  <ul className="footer-list link-list clearfix">
                    {orgUrl !== '#' && (
                      <li>
                        <a
                          href={orgUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="list-item"
                        >
                          {new URL(orgUrl).hostname.replace(/^www\./, '')}
                          <NuovaFinestra testo={t('footer.newWindow')} />
                        </a>
                      </li>
                    )}
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
              )}
              <div className={colonna}>
                <h4>{t('footer.openSource')}</h4>
                <ul className="footer-list link-list clearfix">
                  {githubUrl && (
                    <>
                      <li>
                        <a
                          href={githubUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="list-item"
                        >
                          {t('footer.sourceCode')}
                          <NuovaFinestra testo={t('footer.newWindow')} />
                        </a>
                      </li>
                      <li>
                        <a
                          href={`${githubUrl}/releases/latest`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="list-item"
                        >
                          {t('footer.sbomLatest')}
                          <NuovaFinestra testo={t('footer.newWindow')} />
                        </a>
                      </li>
                    </>
                  )}
                  <li>
                    <Link href="/security" className="list-item text-white">
                      {t('footer.transparency')}
                    </Link>
                  </li>
                  {/* Inventario e stato: trasparenza del servizio, accanto al
                      codice e alla sicurezza (non fra le note legali). */}
                  {inventarioPubblicato && (
                    <li>
                      <Link href="/service-inventory" className="list-item text-white">
                        {t('footer.serviceInventory')}
                      </Link>
                    </li>
                  )}
                  {settings.statusPageEnabled && (
                    <li>
                      <Link href="/status" className="list-item text-white">
                        {t('footer.systemStatus')}
                      </Link>
                    </li>
                  )}
                </ul>
              </div>
              {mainLinks.length > 0 && (
                <div className={colonna}>
                  <h4>{t('footer.usefulLinks')}</h4>
                  <ul className="footer-list link-list clearfix">
                    {mainLinks.map((link) => {
                      const interno = link.url.startsWith('/') && !esterno(link.url) ? percorsoSeNoto(link.url) : null;
                      return (
                        <li key={link.url}>
                          {interno ? (
                            <Link href={interno} className="list-item text-white">
                              {link.title}
                            </Link>
                          ) : esterno(link.url) ? (
                            <a href={link.url} target="_blank" rel="noopener noreferrer" className="list-item">
                              {link.title}
                              <NuovaFinestra testo={t('footer.newWindow')} />
                            </a>
                          ) : (
                            <a href={link.url} className="list-item">
                              {link.title}
                            </a>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      <div className="it-footer-small-prints clearfix">
        <div className="container">
          <h3 className="visually-hidden">{t('footer.legalNotes')}</h3>
          <ul className="it-footer-small-prints-list list-inline mb-0 d-flex flex-column flex-md-row">
            {legalLinks.length > 0 ? (
              legalLinks.map((link) => {
                const interno = link.url.startsWith('/') ? percorsoSeNoto(link.url) : null;
                // La dichiarazione di accessibilita' si apre in una nuova
                // finestra anche quando e' una pagina del sito.
                const accessibilita = interno === '/accessibility';
                return (
                <li key={link.url} className="list-inline-item">
                  {interno ? (
                    <Link
                      href={interno}
                      {...(accessibilita ? { target: '_blank', rel: 'noopener' } : {})}
                    >
                      <IconLabel icon={pickLegalIcon(link)}>{link.title}</IconLabel>
                      {accessibilita && <NuovaFinestra testo={t('footer.newWindow')} />}
                    </Link>
                  ) : !esterno(link.url) ? (
                    // Un indirizzo interno che la mappa non conosce resta
                    // nella stessa scheda, com'e' stato scritto.
                    <a href={link.url}>
                      <IconLabel icon={pickLegalIcon(link)}>{link.title}</IconLabel>
                    </a>
                  ) : (
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <IconLabel icon={pickLegalIcon(link)}>{link.title}</IconLabel>
                      <NuovaFinestra testo={t('footer.newWindow')} />
                    </a>
                  )}
                </li>
                );
              })
            ) : (
              <>
                <li className="list-inline-item">
                  <Link href="/privacy">
                    <IconLabel icon={<FooterIconShield />}>{t('footer.privacy')}</IconLabel>
                  </Link>
                </li>
                <li className="list-inline-item">
                  {/* Si apre in una nuova finestra, e lo dice. */}
                  <Link href="/accessibility" target="_blank" rel="noopener">
                    <IconLabel icon={<FooterIconAccessibility />}>{t('footer.accessibility')}</IconLabel>
                    <NuovaFinestra testo={t('footer.newWindow')} />
                  </Link>
                </li>
                <li className="list-inline-item">
                  <Link href="/legal-notice">
                    <IconLabel icon={<FooterIconDocument />}>{t('footer.legalNotes')}</IconLabel>
                  </Link>
                </li>
              </>
            )}
            {(BUILD_VERSION || BUILD_SHA) && (
              <li className="list-inline-item ms-md-auto text-white">
                <BuildInfo t={t} />
              </li>
            )}
          </ul>
        </div>
      </div>
    </footer>
  );
}

function BuildInfo({ t }: { t: ReturnType<typeof useTranslations> }) {
  const format = useFormatter();
  // Come nei siti della PA: la versione e la data dell'ultimo aggiornamento
  // del servizio, nella lingua della pagina. Il commit resta nel titolo del
  // link, per chi gestisce l'installazione.
  const versione =
    BUILD_CHANNEL === 'release' && BUILD_VERSION
      ? t('footer.version', { version: BUILD_VERSION })
      : t('footer.versionDev');
  const data = BUILD_DATE ? new Date(BUILD_DATE) : null;
  const dataValida = data && !Number.isNaN(data.getTime()) ? data : null;
  const commit = BUILD_SHA ? ` · ${BUILD_SHA}` : '';

  return (
    <span
      className="d-inline-flex align-items-center flex-wrap"
      style={{ fontSize: '0.8rem', lineHeight: 1.25, gap: '0.375rem' }}
    >
      <span style={{ opacity: 0.75, display: 'inline-flex' }}>
        <FooterIconTag />
      </span>
      <Link
        href="/changelog"
        title={`${t('footer.viewChangelog')}${commit}`}
        style={{ color: 'inherit', textDecoration: 'underline' }}
      >
        {versione}
      </Link>
      {dataValida ? (
        <span>
          · {t('footer.updatedOn', {
            date: format.dateTime(dataValida, { day: 'numeric', month: 'long', year: 'numeric' }),
          })}
        </span>
      ) : null}
    </span>
  );
}
