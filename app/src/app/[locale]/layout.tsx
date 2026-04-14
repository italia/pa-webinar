import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { locales, type Locale } from '@/i18n/config';
import { Skiplink } from '@/components/layout/skiplinks';
import PAHeader from '@/components/layout/pa-header';
import PAFooter from '@/components/layout/pa-footer';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { getSettings } from '@/lib/settings';
import { SettingsProvider } from '@/lib/settings-context';

function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

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

  return {
    title: settings.seoTitle || t('appName'),
    description: settings.seoDescription || t('appDescription'),
    openGraph: settings.seoImage ? { images: [settings.seoImage] } : undefined,
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
  const isAdmin = await isAdminAuthenticated(await cookies());
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
