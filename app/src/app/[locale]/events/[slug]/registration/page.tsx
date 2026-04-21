import { notFound } from 'next/navigation';
import { getTranslations, getLocale } from 'next-intl/server';

import { prisma } from '@/lib/db';
import { Link } from '@/i18n/navigation';
import RegistrationFormClient from '@/components/registration/registration-form-client';
import EventTitle from '@/components/events/event-title';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import { getSettings } from '@/lib/settings';

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
    include: {
      _count: { select: { registrations: true } },
      gdprTemplate: { select: { body: true } },
    },
  });

  if (!event || !['PUBLISHED', 'LIVE'].includes(event.status)) {
    notFound();
  }

  const title = getLocalized(event.title as LocalizedField, locale);
  const settings = await getSettings();

  const privacyUrl =
    event.privacyPolicyUrl ??
    process.env.DEFAULT_PRIVACY_POLICY_URL ??
    '/privacy';

  // Privacy text resolution order: ad-hoc text wins (an event can always
  // override with bespoke wording), then the linked GDPR template's body
  // for the current locale (falling back to IT), and finally nothing — in
  // which case the registration form falls back to the privacyUrl link.
  const templateBody = event.gdprTemplate?.body as Record<string, string> | undefined;
  const privacyText =
    event.privacyPolicyText
    ?? templateBody?.[locale]
    ?? templateBody?.it
    ?? undefined;

  return (
    <div className="container py-5">
      <div className="row justify-content-center">
        <div className="col-lg-7">
          <div className="mb-3">
            <Link
              href={`/events/${slug}`}
              className="text-decoration-none d-inline-flex align-items-center text-primary"
              style={{ fontSize: '0.9rem' }}
            >
              <span aria-hidden="true" className="me-1">←</span>
              {t('backToEvent')}
            </Link>
          </div>
          <h1 className="mb-2">{t('title')}</h1>
          <EventTitle
            title={title}
            kickerEnabled={settings.parseTitleKicker}
            as="p"
            className="lead text-muted mb-4"
          />

          <RegistrationFormClient
            eventSlug={slug}
            privacyPolicyUrl={privacyUrl}
            privacyPolicyText={privacyText}
            recordingEnabled={event.recordingEnabled}
            profiling={{
              requireOrganization: event.requireOrganization,
              requireOrganizationRole: event.requireOrganizationRole,
              requireOrganizationType: event.requireOrganizationType,
            }}
          />
        </div>
      </div>
    </div>
  );
}
