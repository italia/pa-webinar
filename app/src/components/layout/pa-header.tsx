'use client';

import { useTranslations } from 'next-intl';
import {
  Headers,
  Header,
  HeaderContent,
  HeaderBrand,
  HeaderRightZone,
} from 'design-react-kit';

import { Link } from '@/i18n/navigation';

import LanguageSwitcher from './language-switcher';

export default function PAHeader() {
  const t = useTranslations();

  return (
    <Headers>
      <SlimHeader
        slimTitle={t('header.slimTitle')}
        slimSubtitle={t('header.slimSubtitle')}
      />
      <CenterHeader appName={t('common.appName')} />
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

function CenterHeader({ appName }: { appName: string }) {
  return (
    <Header type="center" theme="dark" small>
      <HeaderContent>
        <HeaderBrand iconName="it-pa" iconAlt={appName} tag={Link} href="/">
          <h2>{appName}</h2>
        </HeaderBrand>
      </HeaderContent>
    </Header>
  );
}
