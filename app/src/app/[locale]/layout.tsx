import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { locales, type Locale } from '@/i18n/config';
import { Skiplink } from '@/components/layout/skiplinks';
import PAHeader from '@/components/layout/pa-header';
import PAFooter from '@/components/layout/pa-footer';

interface LocaleLayoutProps {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: LocaleLayoutProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'common' });

  return {
    title: t('appName'),
    description: t('appDescription'),
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

  return (
    <html lang={locale}>
      <body className="d-flex flex-column min-vh-100">
        <NextIntlClientProvider messages={messages}>
          <Skiplink />
          <PAHeader />
          <main id="main-content" className="flex-grow-1">
            {children}
          </main>
          <PAFooter />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
