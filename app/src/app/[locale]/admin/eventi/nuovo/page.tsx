import { getTranslations } from 'next-intl/server';

import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { Link } from '@/i18n/navigation';
import CreateEventWithTemplate from '@/components/admin/create-event-with-template';

interface CreateEventPageProps {
  searchParams: Promise<{ template?: string }>;
}

export default async function CreateEventPage({
  searchParams,
}: CreateEventPageProps) {
  const t = await getTranslations('admin');
  const { template: templateId } = await searchParams;

  const [templates, siteSettings] = await Promise.all([
    prisma.eventTemplate.findMany({ orderBy: { sortOrder: 'asc' } }),
    getSettings(),
  ]);

  const selectedTemplate = templateId
    ? templates.find((tpl) => tpl.id === templateId) ?? null
    : null;

  const serializedTemplates = templates.map((tpl) => ({
    id: tpl.id,
    name: tpl.name,
    description: tpl.description,
    icon: tpl.icon,
    qaEnabled: tpl.qaEnabled,
    chatEnabled: tpl.chatEnabled,
    recordingEnabled: tpl.recordingEnabled,
    participantsCanUnmute: tpl.participantsCanUnmute,
    participantsCanStartVideo: tpl.participantsCanStartVideo,
    participantsCanShareScreen: tpl.participantsCanShareScreen,
    maxParticipants: tpl.maxParticipants,
  }));

  const serializedSelected = selectedTemplate
    ? {
        id: selectedTemplate.id,
        name: selectedTemplate.name,
        qaEnabled: selectedTemplate.qaEnabled,
        chatEnabled: selectedTemplate.chatEnabled,
        recordingEnabled: selectedTemplate.recordingEnabled,
        participantsCanUnmute: selectedTemplate.participantsCanUnmute,
        participantsCanStartVideo: selectedTemplate.participantsCanStartVideo,
        participantsCanShareScreen: selectedTemplate.participantsCanShareScreen,
        maxParticipants: selectedTemplate.maxParticipants,
      }
    : null;

  return (
    <div className="container py-5">
      <div className="mb-2">
        <Link
          href="/admin/eventi"
          className="text-decoration-none d-inline-flex align-items-center text-primary"
          style={{ fontSize: '0.9rem' }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="me-1" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
          {t('title')}
        </Link>
      </div>

      <h1 className="fw-bold mb-3" style={{ color: '#17324D' }}>
        {t('createEvent')}
      </h1>

      <div
        className="p-4 rounded mb-4"
        style={{
          backgroundColor: '#F5F7FB',
          borderLeft: '4px solid #0066CC',
          borderRadius: 8,
        }}
      >
        <p className="mb-0 fw-semibold" style={{ color: '#17324D' }}>
          {t('createEventExplanation')}
        </p>
      </div>

      <CreateEventWithTemplate
        templates={serializedTemplates}
        selectedTemplate={serializedSelected}
        siteTimezone={siteSettings.defaultTimezone}
      />
    </div>
  );
}
