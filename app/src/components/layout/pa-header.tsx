'use client';

import { useLocale, useTranslations } from 'next-intl';
import {
  Headers,
  Header,
  HeaderContent,
  HeaderBrand,
  HeaderRightZone,
} from 'design-react-kit';

import { Icon } from '@/components/ui/icon';
import { Link } from '@/i18n/navigation';
import { useSettings } from '@/lib/settings-context';
import { mottoDelSito } from '@/lib/utils/locale';

import LanguageSwitcher from './language-switcher';

interface PAHeaderProps {
  isAdmin?: boolean;
}

export default function PAHeader({ isAdmin }: PAHeaderProps) {
  const t = useTranslations();
  const settings = useSettings();
  const locale = useLocale();

  // La fascia alta nomina l'ente sovraordinato se l'amministrazione lo ha
  // indicato, altrimenti il motto del sito, altrimenti niente. Nessun nome di
  // ente di riserva scritto nel codice: chi installa la piattaforma non deve
  // ritrovarsi quello di un'altra amministrazione, e chi ha svuotato il campo
  // voleva proprio che sparisse.
  const parent = settings.parentOrganization?.trim() ?? '';
  const tagline = mottoDelSito(settings.siteTagline, locale);
  const slimTitle = parent || tagline;
  const slimSubtitle =
    settings.organizationNameShort?.trim() || settings.organizationName?.trim() || slimTitle;
  // Il collegamento vale per l'ente, non per il motto; e mai verso un sito
  // scelto dal codice.
  const parentUrl = parent ? settings.parentOrganizationUrl?.trim() || undefined : undefined;
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
  parentUrl?: string;
}) {
  const brandInner = (
    <>
      <span className="d-none d-lg-inline">{slimTitle}</span>
      <span className="d-lg-none">{slimSubtitle}</span>
    </>
  );

  return (
    <Header type="slim" theme="dark">
      <HeaderContent>
        {parentUrl ? (
          <HeaderBrand
            tag="a"
            href={parentUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {brandInner}
          </HeaderBrand>
        ) : (
          // No parent URL configured → render the parent body as plain text.
          <HeaderBrand tag="span">{brandInner}</HeaderBrand>
        )}
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
          <HeaderBrand tag={Link} href="/">
            {/* Default PA Webinar mark (white knockout) — appName text sits
                next to it, so the image is decorative (aria-hidden). */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/logo/pa-webinar-mark-white.svg"
              alt=""
              aria-hidden="true"
              style={{ height: 34, marginRight: 10 }}
            />
            <h2>{appName}</h2>
          </HeaderBrand>
        )}
        <HeaderRightZone>
          {/* Archivio registrazioni pubblico: prima era raggiungibile solo
              dal footer → poco scopribile. Esposto in header su ogni pagina. */}
          <Link
            href="/video-library"
            // Sotto i 768px resta la sola icona: il nome serve comunque a chi
            // usa un lettore di schermo.
            aria-label={t('videoLibrary')}
            className="text-white text-decoration-none d-inline-flex align-items-center gap-1 me-3"
            style={{ fontSize: '0.9rem' }}
          >
            <Icon icon="it-video" size="sm" color="white" />
            <span className="d-none d-md-inline">{t('videoLibrary')}</span>
          </Link>
          {isAdmin && (
            <Link
              href="/admin"
              aria-label={t('admin')}
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
