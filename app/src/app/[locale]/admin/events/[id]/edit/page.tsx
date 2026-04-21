import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { prisma } from '@/lib/db';
import { jvbMaxReplicasFromEnv } from '@/lib/jvb-sizing';
import { getSettings } from '@/lib/settings';
import { Link } from '@/i18n/navigation';
import EditEventForm from '@/components/admin/edit-event-form';

interface PageProps {
  params: Promise<{ id: string; locale: string }>;
  searchParams: Promise<{ token?: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditEventPage({ params, searchParams }: PageProps) {
  const { id, locale } = await params;
  const { token } = await searchParams;
  const t = await getTranslations({ locale, namespace: 'admin' });

  if (!token) {
    notFound();
  }
  if (!UUID_RE.test(id)) {
    notFound();
  }

  const [event, siteSettings] = await Promise.all([
    prisma.event.findUnique({ where: { id } }),
    getSettings(),
  ]);

  if (!event || event.moderatorToken !== token) {
    notFound();
  }

  return (
    <div className="container py-4">
      <div className="mb-2">
        <Link
          href={`/admin/events/${id}?token=${token}`}
          className="text-decoration-none d-inline-flex align-items-center text-primary"
          style={{ fontSize: '0.9rem' }}
        >
          ← {t('title')}
        </Link>
      </div>

      <h1 className="fw-bold mb-4" style={{ color: '#17324D' }}>
        {t('editEvent')}
      </h1>

      <EditEventForm
        eventTimezone={event.timezone}
        defaultSenderRatioPct={siteSettings.defaultSenderRatioPct ?? 30}
        jvbSizingConfig={{
          cpuCoresPerPod: siteSettings.jvbCpuCoresPerPod ?? 16,
          receiversPerCore: siteSettings.jvbReceiversPerCore ?? 18.75,
          sendersPerCore: siteSettings.jvbSendersPerCore ?? 3.125,
          maxReplicas: siteSettings.jvbMaxReplicas ?? jvbMaxReplicasFromEnv(),
        }}
        event={{
          id: event.id,
          title: event.title as Record<string, string>,
          description: event.description as Record<string, string>,
          startsAt: event.startsAt.toISOString(),
          endsAt: event.endsAt.toISOString(),
          maxParticipants: event.maxParticipants,
          qaEnabled: event.qaEnabled,
          chatEnabled: event.chatEnabled,
          recordingEnabled: event.recordingEnabled,
          autoStartRecording: event.autoStartRecording,
          participantsCanUnmute: event.participantsCanUnmute,
          participantsCanStartVideo: event.participantsCanStartVideo,
          participantsCanShareScreen: event.participantsCanShareScreen,
          dataRetentionDays: event.dataRetentionDays,
          privacyPolicyUrl: event.privacyPolicyUrl,
          gdprTemplateId: event.gdprTemplateId,
          moderatorName: event.moderatorName,
          moderatorEmail: event.moderatorEmail,
          moderatorToken: event.moderatorToken,
          speakersInfo: event.speakersInfo as Record<string, string> | null,
          organizerName: event.organizerName,
          imageUrl: event.imageUrl,
          waitingRoomAudioUrl: event.waitingRoomAudioUrl,
          expectedSenderRatioPct: event.expectedSenderRatioPct,
          gracePeriodMinutes: event.gracePeriodMinutes,
        }}
      />
    </div>
  );
}
