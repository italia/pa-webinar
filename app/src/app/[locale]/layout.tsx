import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { locales, type Locale } from '@/i18n/config';
import { metadataBase, openGraphImages, twitterImageCard } from '@/lib/seo';
import { Skiplink } from '@/components/layout/skiplinks';
import PAHeader from '@/components/layout/pa-header';
import PAFooter from '@/components/layout/pa-footer';
import { getStaffSession } from '@/lib/auth/staff-session';
import { getSettings } from '@/lib/settings';
import { SettingsProvider } from '@/lib/settings-context';

function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

// Mobile-friendly viewport. `viewport-fit=cover` lets the app paint under
// notches/safe-area insets; the themeColor tints the browser chrome. Uses the
// .italia primary blue (matches the `--bs-primary` default in layout below).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0066CC',
};

interface LocaleLayoutProps {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: LocaleLayoutProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'common' });
  const settings = await getSettings();

  // Anteprima social: immagine con URL assoluto (risolto da `metadataBase`,
  // guardato contro un NEXT_PUBLIC_APP_URL malformato — vedi lib/seo). Vale per
  // le pagine che NON dichiarano un proprio openGraph (home, pagine statiche);
  // quelle che lo fanno — es. il dettaglio evento — includono l'immagine da sé,
  // perché Next SOSTITUISCE l'openGraph per segmento, non lo fonde.
  const title = settings.seoTitle || t('appName');
  const description = settings.seoDescription || t('appDescription');

  return {
    metadataBase: metadataBase(),
    // Le pagine con un titolo proprio restano riconoscibili fra le schede e
    // nella cronologia: «Iscrizione: <evento> — <sito>».
    title: {
      default: title,
      template: `%s — ${settings.siteName || t('appName')}`,
    },
    description,
    openGraph: {
      title,
      description,
      images: openGraphImages(settings.seoImage),
    },
    twitter: twitterImageCard(title, description, settings.seoImage),
  };
}

export default async function LocaleLayout({
  children,
  params,
}: LocaleLayoutProps) {
  const { locale } = await params;

  if (!locales.includes(locale as Locale)) {
    notFound();
  }

  const messages = await getMessages();
  // Il collegamento all'area di amministrazione nell'intestazione, per chiunque
  // dello staff vi sia entrato: anche l'organizzatore (ADR-014).
  const isAdmin = (await getStaffSession(await cookies())) !== null;
  const settings = await getSettings();

  return (
    <html lang={locale}>
      <body className="d-flex flex-column min-vh-100">
        {settings.primaryColor && settings.primaryColor !== '#0066CC' && (
          <style dangerouslySetInnerHTML={{ __html: `:root { --bs-primary: ${settings.primaryColor}; --bs-primary-rgb: ${hexToRgb(settings.primaryColor)}; }` }} />
        )}
        <NextIntlClientProvider messages={messages}>
          <SettingsProvider settings={settings}>
            <Skiplink />
            <PAHeader isAdmin={isAdmin} />
            <main id="main-content" className="flex-grow-1">
              {children}
            </main>
            <PAFooter />
          </SettingsProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
