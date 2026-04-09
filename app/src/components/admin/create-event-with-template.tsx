'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { useRouter } from '@/i18n/navigation';
import TemplatePicker from '@/components/admin/template-picker';
import CreateEventForm from '@/components/admin/create-event-form';

interface TemplateSummary {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  qaEnabled: boolean;
  chatEnabled: boolean;
  recordingEnabled: boolean;
  participantsCanUnmute: boolean;
  participantsCanStartVideo: boolean;
  participantsCanShareScreen: boolean;
  maxParticipants: number;
}

interface TemplatePreset {
  id: string;
  name: string;
  qaEnabled: boolean;
  chatEnabled: boolean;
  recordingEnabled: boolean;
  participantsCanUnmute: boolean;
  participantsCanStartVideo: boolean;
  participantsCanShareScreen: boolean;
  maxParticipants: number;
}

interface Props {
  templates: TemplateSummary[];
  selectedTemplate: TemplatePreset | null;
  siteTimezone: string;
}

export default function CreateEventWithTemplate({
  templates,
  selectedTemplate,
  siteTimezone,
}: Props) {
  const t = useTranslations('admin.templates');
  const router = useRouter();
  const [skipped, setSkipped] = useState(false);

  const showPicker =
    !selectedTemplate && !skipped && templates.length > 0;

  if (showPicker) {
    return (
      <div>
        <h4 className="fw-semibold mb-3" style={{ color: '#17324D' }}>
          {t('pickerTitle')}
        </h4>
        <TemplatePicker
          templates={templates}
          onSelect={(tpl) => {
            router.push(`/admin/eventi/nuovo?template=${tpl.id}`);
          }}
          onSkip={() => setSkipped(true)}
        />
      </div>
    );
  }

  return <CreateEventForm template={selectedTemplate ?? undefined} siteTimezone={siteTimezone} />;
}
