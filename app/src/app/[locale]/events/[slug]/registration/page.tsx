import { notFound } from 'next/navigation';
import { getTranslations, getLocale } from 'next-intl/server';

import { prisma } from '@/lib/db';
import RegistrationFormClient from '@/components/registration/registration-form-client';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';

interface RegistrationPageProps {
  params: Promise<{ slug: string }>;
}

export default async function RegistrationPage({
  params,
}: RegistrationPageProps) {
  const { slug } = await params;
  const locale = await getLocale();
  const t = await getTranslations('registration');

  const event = await prisma.event.findUnique({
    where: { slug },
    include: { _count: { select: { registrations: true } } },
  });

  if (!event || !['PUBLISHED', 'LIVE'].includes(event.status)) {
    notFound();
  }

  const spotsLeft = event.maxParticipants - event._count.registrations;
  const title = getLocalized(event.title as LocalizedField, locale);

  const privacyUrl =
    event.privacyPolicyUrl ??
    process.env.DEFAULT_PRIVACY_POLICY_URL ??
    '/privacy';

  return (
    <div className="container py-5">
      <div className="row justify-content-center">
        <div className="col-lg-7">
          <h1 className="mb-2">{t('title')}</h1>
          <p className="lead text-muted mb-4">{title}</p>

          {spotsLeft <= 0 ? (
            <div className="alert alert-warning" role="alert">
              {t('errors.eventFull')}
            </div>
          ) : (
            <RegistrationFormClient
              eventSlug={slug}
              privacyPolicyUrl={privacyUrl}
              privacyPolicyText={event.privacyPolicyText ?? undefined}
              recordingEnabled={event.recordingEnabled}
              profiling={{
                requireOrganization: event.requireOrganization,
                requireOrganizationRole: event.requireOrganizationRole,
                requireOrganizationType: event.requireOrganizationType,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
