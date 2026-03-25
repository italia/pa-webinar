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

import LanguageSwitcher from './language-switcher';

interface PAHeaderProps {
  isAdmin?: boolean;
}

export default function PAHeader({ isAdmin }: PAHeaderProps) {
  const t = useTranslations();

  return (
    <Headers>
      <SlimHeader
        slimTitle={t('header.slimTitle')}
        slimSubtitle={t('header.slimSubtitle')}
      />
      <CenterHeader appName={t('common.appName')} isAdmin={isAdmin} />
    </Headers>
  );
}

function SlimHeader({
  slimTitle,
  slimSubtitle,
}: {
  slimTitle: string;
  slimSubtitle: string;
}) {
  return (
    <Header type="slim" theme="dark">
      <HeaderContent>
        <HeaderBrand
          tag="a"
          href="https://www.governo.it"
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
}: {
  appName: string;
  isAdmin?: boolean;
}) {
  const t = useTranslations('nav');

  return (
    <Header type="center" theme="dark" small>
      <HeaderContent>
        <HeaderBrand iconName="it-pa" iconAlt={appName} tag={Link} href="/">
          <h2>{appName}</h2>
        </HeaderBrand>
        <HeaderRightZone>
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
