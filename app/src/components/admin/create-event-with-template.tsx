'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { useRouter } from '@/i18n/navigation';
import TemplatePicker from '@/components/admin/template-picker';
import EventWizard from '@/components/admin/event-wizard/wizard-shell';
import CreateInstantCall from '@/components/admin/create-instant-call';
import type { JvbSizingConfig } from '@/lib/jvb-sizing';

interface TemplateSummary {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  qaEnabled: boolean;
  chatEnabled: boolean;
  recordingEnabled: boolean;
  autoStartRecording: boolean;
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
  autoStartRecording: boolean;
  participantsCanUnmute: boolean;
  participantsCanStartVideo: boolean;
  participantsCanShareScreen: boolean;
  maxParticipants: number;
}

interface Props {
  templates: TemplateSummary[];
  selectedTemplate: TemplatePreset | null;
  siteTimezone: string;
  enabledLocales: string[];
  defaultLocale: string;
  defaultSenderRatioPct: number;
  defaultRetentionDays: number;
  jvbSizingConfig: JvbSizingConfig;
  availableTags: Array<{ slug: string; name: Record<string, string>; color: string | null }>;
  gdprTemplates: Array<{ id: string; name: string; isDefault: boolean }>;
  siteDefaultParseTitleKicker: boolean;
}

export default function CreateEventWithTemplate({
  templates,
  selectedTemplate,
  siteTimezone,
  enabledLocales,
  defaultLocale,
  defaultSenderRatioPct,
  defaultRetentionDays,
  jvbSizingConfig,
  availableTags,
  gdprTemplates,
  siteDefaultParseTitleKicker,
}: Props) {
  const t = useTranslations('admin.templates');
  const ti = useTranslations('admin.instantCall');
  const router = useRouter();
  const [skipped, setSkipped] = useState(false);
  const [showInstant, setShowInstant] = useState(false);

  if (showInstant) {
    return (
      <div>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm mb-4"
          onClick={() => setShowInstant(false)}
        >
          ← {t('pickerTitle')}
        </button>
        <CreateInstantCall />
      </div>
    );
  }

  const showPicker =
    !selectedTemplate && !skipped && templates.length > 0;

  if (showPicker) {
    return (
      <div>
        <h4 className="fw-semibold mb-3" style={{ color: '#17324D' }}>
          {t('pickerTitle')}
        </h4>

        <div className="mb-4">
          <button
            type="button"
            className="border-0 bg-transparent p-0 w-100 text-start"
            onClick={() => setShowInstant(true)}
          >
            <div
              className="d-flex align-items-center gap-3 p-3 rounded-3"
              style={{
                border: '2px dashed #008758',
                backgroundColor: 'rgba(0,135,88,0.04)',
                cursor: 'pointer',
                transition: 'background-color 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(0,135,88,0.08)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(0,135,88,0.04)';
              }}
            >
              <div
                className="d-flex align-items-center justify-content-center rounded-2"
                style={{
                  width: 48,
                  height: 48,
                  backgroundColor: 'rgba(0,135,88,0.12)',
                  flexShrink: 0,
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#008758" strokeWidth="2" aria-hidden="true"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
              </div>
              <div>
                <h6 className="fw-semibold mb-0" style={{ color: '#008758' }}>
                  {ti('title')}
                </h6>
                <p className="text-muted mb-0" style={{ fontSize: '0.82rem' }}>
                  {ti('subtitle')}
                </p>
              </div>
            </div>
          </button>
        </div>

        <TemplatePicker
          templates={templates}
          onSelect={(tpl) => {
            router.push(`/admin/events/new?template=${tpl.id}`);
          }}
          onSkip={() => setSkipped(true)}
        />
      </div>
    );
  }

  return (
    <EventWizard
      template={selectedTemplate ?? undefined}
      siteTimezone={siteTimezone}
      enabledLocales={enabledLocales}
      defaultLocale={defaultLocale}
      defaultSenderRatioPct={defaultSenderRatioPct}
      defaultRetentionDays={defaultRetentionDays}
      jvbSizingConfig={jvbSizingConfig}
      availableTags={availableTags}
      gdprTemplates={gdprTemplates}
      siteDefaultParseTitleKicker={siteDefaultParseTitleKicker}
    />
  );
}
