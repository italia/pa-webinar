import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, getLocale, getFormatter } from 'next-intl/server';

import { prisma } from '@/lib/db';
import { Link, percorso } from '@/i18n/navigation';
import RegistrationFormClient from '@/components/registration/registration-form-client';
import EventTitle from '@/components/events/event-title';
import { Icon } from '@/components/ui/icon';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import { resolveKickerEnabled } from '@/lib/utils/title-kicker';
import { getSettings } from '@/lib/settings';
import { isEventOpenForRegistration } from '@/lib/events/visibility';
import { registrationAccessFor } from '@/lib/events/registration-access';
import { informativaEvento } from '@/lib/events/privacy-notice';
import { titoloEventoPubblico } from '@/lib/events/meta-title';

interface RegistrationPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: RegistrationPageProps): Promise<Metadata> {
  const { slug } = await params;
  const t = await getTranslations('registration');
  const titolo = await titoloEventoPubblico(slug, isEventOpenForRegistration);
  return {
    title: titolo ? `${t('title')}: ${titolo}` : t('title'),
    robots: { index: false },
  };
}

export default async function RegistrationPage({
  params,
}: RegistrationPageProps) {
  const { slug } = await params;
  const locale = await getLocale();
  const t = await getTranslations('registration');
  const format = await getFormatter();

  const event = await prisma.event.findUnique({
    where: { slug },
    include: {
      _count: { select: { registrations: true } },
      gdprTemplate: { select: { body: true } },
    },
  });

  if (!event || !isEventOpenForRegistration(event)) {
    notFound();
  }

  // A PRE_REGISTRATION questionnaire must be filled in on the success
  // screen before the participant proceeds — so we only auto-redirect
  // straight into the waiting room when there is none. Resolved here
  // (server) so the client doesn't have to wait for the questionnaire
  // fetch to decide whether to redirect.
  const preRegistrationQuestionnaire = await prisma.eventQuestionnaire.findFirst({
    where: { eventId: event.id, placement: 'PRE_REGISTRATION' },
    select: { id: true },
  });

  const title = getLocalized(event.title as LocalizedField, locale);
  const settings = await getSettings();
  // Con l'iscrizione non aperta (solo su invito, per l'evento o per il sito)
  // la pagina resta raggiungibile — ci arriva anche chi viene rimandato dalla
  // sala — ma spiega chi può iscriversi.
  const registrationAccess = await registrationAccessFor(
    event,
    settings.publicRegistrationEnabled,
  );

  // La stessa informativa che legge in sala d'attesa chi entra senza
  // iscriversi (lib/events/privacy-notice).
  const { url: privacyUrl, testo: privacyText } = informativaEvento(event, locale);

  return (
    <div className="container py-5">
      <div className="row justify-content-center">
        <div className="col-lg-7">
          <div className="mb-4">
            <Link
              href={percorso(`/events/${slug}`)}
              className="text-decoration-none d-inline-flex align-items-center gap-1 text-primary"
              style={{ fontSize: '0.9rem' }}
            >
              <Icon icon="it-arrow-left" size="sm" color="primary" />
              {t('backToEvent')}
            </Link>
          </div>
          <h1 className="mb-2">{t('title')}</h1>
          <EventTitle
            title={title}
            kickerEnabled={resolveKickerEnabled(event, settings.parseTitleKicker)}
            as="p"
            className="lead text-muted mb-3"
          />
          {/* Quando, prima di chiedere i dati: chi si iscrive da un link
              inoltrato non e' passato dalla pagina dell'evento. */}
          <p className="registration-when mb-5">
            <Icon icon="it-calendar" size="sm" color="primary" />
            <span>
              {format.dateTime(event.startsAt, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
                timeZone: event.timezone,
              })}
              {' · '}
              {format.dateTime(event.startsAt, { hour: '2-digit', minute: '2-digit', timeZone: event.timezone })}
              {' – '}
              {format.dateTime(event.endsAt, { hour: '2-digit', minute: '2-digit', timeZone: event.timezone })}
            </span>
          </p>

          <RegistrationFormClient
            eventSlug={slug}
            privacyPolicyUrl={privacyUrl}
            privacyPolicyText={privacyText}
            recordingEnabled={event.recordingEnabled}
            multitrackRecordingEnabled={event.multitrackRecordingEnabled}
            participantsCanUnmute={event.participantsCanUnmute}
            participantsCanStartVideo={event.participantsCanStartVideo}
            participantsCanShareScreen={event.participantsCanShareScreen}
            hasPreRegistrationQuestionnaire={!!preRegistrationQuestionnaire}
            startsAt={event.startsAt.toISOString()}
            waitingRoomLeadMinutes={settings.waitingRoomLeadMinutes}
            profiling={{
              requireOrganization: event.requireOrganization,
              requireOrganizationRole: event.requireOrganizationRole,
              requireOrganizationType: event.requireOrganizationType,
            }}
            registrationAccess={registrationAccess}
          />
        </div>
      </div>
    </div>
  );
}
