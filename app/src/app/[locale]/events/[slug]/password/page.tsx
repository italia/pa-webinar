import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';

import { prisma } from '@/lib/db';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import PasswordGateClient from '@/components/events/password-gate-client';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function PasswordGatePage({ params }: PageProps) {
  const { slug } = await params;
  const locale = await getLocale();
  const t = await getTranslations('live');

  const event = await prisma.event.findUnique({
    where: { slug },
    select: { title: true, joinPasswordHash: true, status: true },
  });

  if (!event || !event.joinPasswordHash) {
    // Only show the password gate for events that actually require one.
    notFound();
  }

  const title = getLocalized(event.title as LocalizedField, locale);

  return (
    <div className="container py-5">
      <div className="row justify-content-center">
        <div className="col-lg-5 col-md-7">
          <h1 className="h3 mb-1">{t('password.title')}</h1>
          <p className="text-muted mb-4">{title}</p>
          <PasswordGateClient slug={slug} />
        </div>
      </div>
    </div>
  );
}
