import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';

// La pagina e' un Client Component: il titolo della scheda lo da' il segmento.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('gdpr.erasure');
  return { title: t('title') };
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
