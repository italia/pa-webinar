// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

'use client';

import { useFormatter, useTranslations } from 'next-intl';

import { Icon } from '@/components/ui/icon';
import { Link, percorsoSeNoto } from '@/i18n/navigation';
import {
  eNomeDelProdotto,
  larghezzaMarchioIntero,
  MARCHIO_INTERO_NEGATIVO,
} from '@/lib/branding/marchio';
import { useSettings } from '@/lib/settings-context';

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

/**
 * Il pie' di pagina essenziale dei siti della PA: il servizio, l'ente che lo
 * porta («Progetto di», con il suo logo) e, in fondo, le informative e le
 * dichiarazioni. Niente link che ripetono il menu: le pagine del sito si
 * raggiungono dall'intestazione. Codice sorgente, SBOM, inventario e stato del
 * servizio stanno nella pagina «Sicurezza e trasparenza».
 */
export default function PAFooter() {
  const t = useTranslations();
  const settings = useSettings();

  const appName = settings.siteName?.trim() || t('common.appName');
  // L'ente viene dalla configurazione, mai da un nome scritto nel codice:
  // senza, la fascia non c'e'.
  const ente = settings.organizationName?.trim() ?? '';
  const enteSovra = settings.parentOrganization?.trim() ?? '';
  const enteUrl = settings.organizationUrl?.trim() ?? '';
  const enteLogo = settings.organizationLogoUrl?.trim() ?? '';
  const supporto = settings.supportEmail?.trim() ?? '';

  let footerLinks: FooterLink[] = [];
  try {
    const raw =
      typeof settings.footerLinks === 'string'
        ? JSON.parse(settings.footerLinks)
        : settings.footerLinks;
    if (Array.isArray(raw)) footerLinks = raw;
  } catch {
    // footerLinks malformato: si usano le note di default.
  }

  const legalLinks = footerLinks.filter((l) => l.section === 'legal');
  // Le pagine che le note scelte da chi amministra portano gia': la barra non
  // le ripete.
  const scelti = new Set(
    legalLinks.map((l) => (l.url.startsWith('/') ? percorsoSeNoto(l.url) : null)).filter(Boolean),
  );
  // I link della sezione «Principale», scelti da chi amministra: una riga loro.
  const mainLinks = footerLinks.filter((l) => l.section === 'main');
  // Fuori dal sito, in una nuova finestra: gli indirizzi web completi (anche
  // senza schema, «//host»). mailto: e tel: non aprono finestre.
  const esterno = (url: string) => /^(https?:)?\/\//i.test(url);

  const nomeEnte = (
    <span className="footer-progetto__ente">
      {enteLogo && (
        // Il logo accompagna il nome, che resta scritto: e' decorativo.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={enteLogo} alt="" aria-hidden="true" className="footer-progetto__logo" />
      )}
      <span>
        <span className="footer-progetto__nome">{ente}</span>
        {enteSovra && <span className="footer-progetto__sovra">{enteSovra}</span>}
      </span>
    </span>
  );

  return (
    <footer className="it-footer" id="footer" tabIndex={-1}>
      <div className="it-footer-main">
        <div className="container">
          <section>
            <div className="row clearfix">
              <div className="col-sm-12">
                <div className="it-brand-wrapper">
                  <Link href="/" className="d-inline-flex align-items-center">
                    {settings.logoUrl ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={settings.logoUrl}
                          alt=""
                          aria-hidden="true"
                          style={{ height: 44, marginRight: 12 }}
                        />
                        <div className="it-brand-text">
                          <h2 className="mb-0">{appName}</h2>
                        </div>
                      </>
                    ) : eNomeDelProdotto(appName) ? (
                      // Il marchio intero, in negativo sul fondo scuro: il
                      // nome e' nell'immagine.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={MARCHIO_INTERO_NEGATIVO}
                        alt={appName}
                        width={larghezzaMarchioIntero(44)}
                        height={44}
                        style={{ height: 44, width: 'auto' }}
                      />
                    ) : (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src="/images/logo/pa-webinar-mark-white.svg"
                          alt=""
                          aria-hidden="true"
                          style={{ height: 44, marginRight: 12 }}
                        />
                        <div className="it-brand-text">
                          <h2 className="mb-0">{appName}</h2>
                        </div>
                      </>
                    )}
                  </Link>
                </div>
              </div>
            </div>
          </section>

          {(ente || supporto) && (
            // Come nei siti della PA: chi porta il servizio, con il suo logo.
            <section className="footer-progetto">
              {ente && (
                <>
                  <h3 className="footer-progetto__etichetta">{t('footer.projectOf')}</h3>
                  {enteUrl ? (
                    <a
                      href={enteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="footer-progetto__link"
                    >
                      {nomeEnte}
                      <NuovaFinestra testo={t('footer.newWindow')} />
                    </a>
                  ) : (
                    nomeEnte
                  )}
                </>
              )}
              {supporto && (
                <p className="footer-progetto__contatti">
                  {t.rich('footer.contactsLine', {
                    email: supporto,
                    link: (testo) => <a href={`mailto:${supporto}`}>{testo}</a>,
                  })}
                </p>
              )}
            </section>
          )}

          {mainLinks.length > 0 && (
            <section className="footer-utili">
              <h3 className="visually-hidden">{t('footer.usefulLinks')}</h3>
              <ul className="list-inline mb-0">
                {mainLinks.map((link) => {
                  const interno =
                    link.url.startsWith('/') && !esterno(link.url) ? percorsoSeNoto(link.url) : null;
                  return (
                    <li key={link.url} className="list-inline-item">
                      {interno ? (
                        <Link href={interno}>{link.title}</Link>
                      ) : esterno(link.url) ? (
                        <a href={link.url} target="_blank" rel="noopener noreferrer">
                          {link.title}
                          <NuovaFinestra testo={t('footer.newWindow')} />
                        </a>
                      ) : (
                        <a href={link.url}>{link.title}</a>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      </div>

      <div className="it-footer-small-prints clearfix">
        <div className="container">
          <h3 className="visually-hidden">{t('footer.legalNotes')}</h3>
          {/* Le informative e le dichiarazioni, senza icone davanti, come negli
              altri siti della PA; la freccia resta solo dove si apre una nuova
              finestra. Poi i propri dati e la trasparenza del servizio. */}
          <ul className="it-footer-small-prints-list list-inline mb-0 d-flex flex-column flex-md-row flex-wrap">
            {legalLinks.length > 0 ? (
              legalLinks.map((link) => {
                const interno = link.url.startsWith('/') ? percorsoSeNoto(link.url) : null;
                const accessibilita = interno === '/accessibility';
                return (
                  <li key={link.url} className="list-inline-item">
                    {interno ? (
                      <Link
                        href={interno}
                        {...(accessibilita ? { target: '_blank', rel: 'noopener' } : {})}
                      >
                        {link.title}
                        {accessibilita && <NuovaFinestra testo={t('footer.newWindow')} />}
                      </Link>
                    ) : !esterno(link.url) ? (
                      // Un indirizzo interno che la mappa non conosce resta
                      // nella stessa scheda, com'e' stato scritto.
                      <a href={link.url}>{link.title}</a>
                    ) : (
                      <a href={link.url} target="_blank" rel="noopener noreferrer">
                        {link.title}
                        <NuovaFinestra testo={t('footer.newWindow')} />
                      </a>
                    )}
                  </li>
                );
              })
            ) : (
              <>
                <li className="list-inline-item">
                  <Link href="/privacy">{t('footer.privacy')}</Link>
                </li>
                <li className="list-inline-item">
                  {/* Si apre in una nuova finestra, e lo dice. */}
                  <Link href="/accessibility" target="_blank" rel="noopener">
                    {t('footer.accessibility')}
                    <NuovaFinestra testo={t('footer.newWindow')} />
                  </Link>
                </li>
                <li className="list-inline-item">
                  <Link href="/legal-notice">{t('footer.legalNotes')}</Link>
                </li>
              </>
            )}
            {!scelti.has('/privacy/my-data') && (
              <li className="list-inline-item">
                <Link href="/privacy/my-data">{t('gdpr.export.title')}</Link>
              </li>
            )}
            {!scelti.has('/security') && (
              <li className="list-inline-item">
                <Link href="/security">{t('footer.transparency')}</Link>
              </li>
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
