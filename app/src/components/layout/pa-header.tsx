'use client';

import { useTranslations } from 'next-intl';
import {
  Headers,
  Header,
  HeaderContent,
  HeaderBrand,
  HeaderRightZone,
  Icon,
} from 'design-react-kit';

import { Link } from '@/i18n/navigation';
import { useSettings } from '@/lib/settings-context';

import LanguageSwitcher from './language-switcher';

interface PAHeaderProps {
  isAdmin?: boolean;
}

export default function PAHeader({ isAdmin }: PAHeaderProps) {
  const t = useTranslations();
  const settings = useSettings();

  const slimTitle =
    settings.parentOrganization || t('header.slimTitle');
  const slimSubtitle =
    settings.organizationNameShort || settings.organizationName || t('header.slimSubtitle');
  const parentUrl = settings.parentOrganizationUrl || 'https://www.governo.it';
  const appName = settings.siteName || t('common.appName');

  return (
    <Headers>
      <SlimHeader
        slimTitle={slimTitle}
        slimSubtitle={slimSubtitle}
        parentUrl={parentUrl}
      />
      <CenterHeader
        appName={appName}
        isAdmin={isAdmin}
        logoUrl={settings.logoUrl}
      />
    </Headers>
  );
}

function SlimHeader({
  slimTitle,
  slimSubtitle,
  parentUrl,
}: {
  slimTitle: string;
  slimSubtitle: string;
  parentUrl: string;
}) {
  return (
    <Header type="slim" theme="dark">
      <HeaderContent>
        <HeaderBrand
          tag="a"
          href={parentUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span className="d-none d-lg-inline">{slimTitle}</span>
          <span className="d-lg-none">{slimSubtitle}</span>
        </HeaderBrand>
        <HeaderRightZone>
          <LanguageSwitcher />
        </HeaderRightZone>
      </HeaderContent>
    </Header>
  );
}

function CenterHeader({
  appName,
  isAdmin,
  logoUrl,
}: {
  appName: string;
  isAdmin?: boolean;
  logoUrl?: string | null;
}) {
  const t = useTranslations('nav');

  return (
    <Header type="center" theme="dark" small>
      <HeaderContent>
        {logoUrl ? (
          <HeaderBrand tag={Link} href="/">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoUrl} alt={appName} style={{ height: 40, marginRight: 8 }} />
            <h2>{appName}</h2>
          </HeaderBrand>
        ) : (
          <HeaderBrand iconName="it-pa" iconAlt={appName} tag={Link} href="/">
            <h2>{appName}</h2>
          </HeaderBrand>
        )}
        <HeaderRightZone>
          {/* Archivio registrazioni pubblico: prima era raggiungibile solo
              dal footer → poco scopribile. Esposto in header su ogni pagina. */}
          <Link
            href="/video-library"
            className="text-white text-decoration-none d-inline-flex align-items-center gap-1 me-3"
            style={{ fontSize: '0.9rem' }}
          >
            <Icon icon="it-video" size="sm" color="white" />
            <span className="d-none d-md-inline">{t('videoLibrary')}</span>
          </Link>
          {isAdmin && (
            <Link
              href="/admin"
              className="text-white text-decoration-none d-inline-flex align-items-center gap-1 me-3"
              style={{ fontSize: '0.9rem' }}
            >
              <Icon icon="it-settings" size="sm" color="white" />
              <span className="d-none d-md-inline">{t('admin')}</span>
            </Link>
          )}
        </HeaderRightZone>
      </HeaderContent>
    </Header>
  );
}
