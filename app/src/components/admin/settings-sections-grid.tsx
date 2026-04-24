'use client';

import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';

// Hand-inlined SVGs instead of design-react-kit <Icon> to avoid the
// async icons cache triggering hydration mismatches on every settings
// visit (the same pitfall we hit on CollapsibleSection).
function IconLanguages() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15 15 0 0 1 0 20" />
      <path d="M12 2a15 15 0 0 0 0 20" />
    </svg>
  );
}
function IconShield() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}
function IconMail() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  );
}
function IconTag() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.59 13.41L13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  );
}

interface Section {
  href: string;
  titleKey: string;
  descriptionKey: string;
  tone: 'primary' | 'warning';
  icon: React.ReactNode;
}

const SECTIONS: Section[] = [
  {
    href: '/admin/settings/languages',
    titleKey: 'languagesTitle',
    descriptionKey: 'languagesDescription',
    tone: 'primary',
    icon: <IconLanguages />,
  },
  {
    href: '/admin/settings/gdpr-templates',
    titleKey: 'gdprTemplatesTitle',
    descriptionKey: 'gdprTemplatesDescription',
    tone: 'warning',
    icon: <IconShield />,
  },
  {
    href: '/admin/settings/email-templates',
    titleKey: 'emailTemplatesTitle',
    descriptionKey: 'emailTemplatesDescription',
    tone: 'primary',
    icon: <IconMail />,
  },
  {
    href: '/admin/settings/tags',
    titleKey: 'tagsTitle',
    descriptionKey: 'tagsDescription',
    tone: 'primary',
    icon: <IconTag />,
  },
];

export default function SettingsSectionsGrid() {
  const t = useTranslations('admin.settings.sections');

  return (
    <div className="row g-3 mb-5">
      {SECTIONS.map((s) => {
        const accent = s.tone === 'warning' ? '#A66300' : '#0066CC';
        const accentBg =
          s.tone === 'warning' ? 'rgba(166,99,0,0.08)' : 'rgba(0,102,204,0.08)';
        return (
          <div key={s.href} className="col-md-6">
            <Link
              href={s.href}
              className="text-decoration-none d-block h-100"
              style={{ color: 'inherit' }}
            >
              <div
                className="h-100 p-3 p-md-4 rounded-3 d-flex gap-3 align-items-start"
                style={{
                  background: '#fff',
                  border: '1px solid #e8e8e8',
                  transition: 'box-shadow 0.15s ease, transform 0.15s ease',
                }}
              >
                <div
                  className="flex-shrink-0 d-flex align-items-center justify-content-center rounded-2"
                  style={{ width: 44, height: 44, background: accentBg, color: accent }}
                >
                  {s.icon}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="fw-semibold mb-1" style={{ color: '#17324D' }}>
                    {t(s.titleKey)}
                  </div>
                  <div className="text-secondary" style={{ fontSize: '0.85rem', lineHeight: 1.35 }}>
                    {t(s.descriptionKey)}
                  </div>
                </div>
              </div>
            </Link>
          </div>
        );
      })}
    </div>
  );
}
