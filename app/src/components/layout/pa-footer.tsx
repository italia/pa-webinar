'use client';

import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
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

// Inline mono-stroke SVGs so the footer bar doesn't depend on the async
// Bootstrap Italia sprite — same rationale as settings-sections-grid.
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
function FooterIconPulse() {
  return (
    <svg width={FOOTER_ICON_SIZE} height={FOOTER_ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12h4l2-6 4 12 2-6h6" />
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
function FooterIconInventory() {
  return (
    <svg width={FOOTER_ICON_SIZE} height={FOOTER_ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16v13H4z" />
      <path d="M4 7l2-3h12l2 3" />
      <path d="M9 11h6" />
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

// "YYYY-MM-DD HH:MM UTC" — the ISO string is inlined at build time so
// server/client render the same text and there is no Intl locale drift to
// reconcile. Seconds are dropped; UTC suffix is explicit so readers don't
// assume Europe/Rome.
function formatBuildDate(iso: string): string {
  if (!iso) return '';
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  if (!match) return iso;
  return `${match[1]} ${match[2]} UTC`;
}

export default function PAFooter() {
  const t = useTranslations();
  const settings = useSettings();

  const orgName =
    settings.organizationName || t('footer.departmentName');
  const parentOrg =
    settings.parentOrganization || t('footer.presidencyName');
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

  return (
    <footer className="it-footer" id="footer">
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
                    href="/events"
                    className="text-white text-decoration-none"
                  >
                    {t('nav.events')}
                  </Link>
                </h4>
                <ul className="footer-list link-list clearfix">
                  <li>
                    <Link href="/video-library" className="list-item text-white">
                      {t('nav.videoLibrary')}
                    </Link>
                  </li>
                </ul>
              </div>
              <div className="col-lg-4 col-md-4 pb-2">
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
              <div className="col-lg-4 col-md-4 pb-2">
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
                        </a>
                      </li>
                    </>
                  )}
                  <li>
                    <Link href="/security" className="list-item text-white">
                      {t('footer.transparency')}
                    </Link>
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
            {legalLinks.length > 0 ? (
              legalLinks.map((link) => (
                <li key={link.url} className="list-inline-item">
                  {link.url.startsWith('/') ? (
                    <Link href={link.url}>
                      <IconLabel icon={pickLegalIcon(link)}>{link.title}</IconLabel>
                    </Link>
                  ) : (
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <IconLabel icon={pickLegalIcon(link)}>{link.title}</IconLabel>
                    </a>
                  )}
                </li>
              ))
            ) : (
              <>
                <li className="list-inline-item">
                  <Link href="/privacy">
                    <IconLabel icon={<FooterIconShield />}>{t('footer.privacy')}</IconLabel>
                  </Link>
                </li>
                <li className="list-inline-item">
                  <Link href="/accessibility">
                    <IconLabel icon={<FooterIconAccessibility />}>{t('footer.accessibility')}</IconLabel>
                  </Link>
                </li>
                <li className="list-inline-item">
                  <Link href="/legal-notice">
                    <IconLabel icon={<FooterIconDocument />}>{t('footer.legalNotes')}</IconLabel>
                  </Link>
                </li>
              </>
            )}
            <li className="list-inline-item">
              <Link href="/service-inventory">
                <IconLabel icon={<FooterIconInventory />}>{t('footer.serviceInventory')}</IconLabel>
              </Link>
            </li>
            {settings.statusPageEnabled && (
              <li className="list-inline-item">
                <Link href="/status">
                  <IconLabel icon={<FooterIconPulse />}>{t('footer.systemStatus')}</IconLabel>
                </Link>
              </li>
            )}
            {(BUILD_VERSION || BUILD_SHA) && (
              <li className="list-inline-item ms-md-auto text-white">
                <BuildInfo githubUrl={githubUrl} t={t} />
              </li>
            )}
          </ul>
        </div>
      </div>
    </footer>
  );
}

function BuildInfo({
  githubUrl,
  t,
}: {
  githubUrl: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const hasRepo = githubUrl.startsWith('http');
  const commitUrl = hasRepo && BUILD_SHA ? `${githubUrl}/commit/${BUILD_SHA}` : null;

  const versionLabel =
    BUILD_CHANNEL === 'release' && BUILD_VERSION
      ? `v${BUILD_VERSION}`
      : t('footer.buildInfoDev');

  const linkStyle = { color: 'inherit', textDecoration: 'underline' };
  const codeStyle = {
    color: 'inherit',
    background: 'transparent',
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, "Liberation Mono", monospace',
    fontSize: '0.85em',
  };

  const buildDate = formatBuildDate(BUILD_DATE);

  return (
    <span
      className="d-inline-flex flex-column align-items-start align-items-md-end"
      style={{ fontSize: '0.8rem', lineHeight: 1.25 }}
    >
      <span className="d-inline-flex align-items-center" style={{ gap: '0.375rem' }}>
        <span style={{ opacity: 0.75, display: 'inline-flex' }}>
          <FooterIconTag />
        </span>
        <Link href="/changelog" title={t('footer.viewChangelog')} style={linkStyle}>
          {versionLabel}
        </Link>
        {BUILD_SHA ? (
          <>
            <span aria-hidden="true">·</span>
            {commitUrl ? (
              <a
                href={commitUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={t('footer.viewCommit')}
                style={linkStyle}
              >
                <code style={codeStyle}>{BUILD_SHA}</code>
              </a>
            ) : (
              <code style={codeStyle}>{BUILD_SHA}</code>
            )}
          </>
        ) : null}
      </span>
      {buildDate ? (
        <span style={{ opacity: 0.8, fontSize: '0.72rem' }}>
          {t('footer.buildDatePrefix')} <time dateTime={BUILD_DATE}>{buildDate}</time>
        </span>
      ) : null}
    </span>
  );
}
