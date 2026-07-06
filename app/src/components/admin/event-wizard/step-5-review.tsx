'use client';

/**
 * Step 5 — Review & publish.
 *
 * Read-mostly summary of everything chosen in steps 1–4, plus the GDPR /
 * retention fields (which, historically, lived lower in the form) and a
 * load-capacity preview. The shell owns the submit buttons — this component
 * only surfaces the data and lets the admin edit GDPR/moderator-contact
 * fields that are review-specific.
 */

import { useTranslations } from 'next-intl';

import EventConfigDiagram from '@/components/admin/event-config-diagram';
import JvbCapacityPreview from '@/components/admin/jvb-capacity-preview';
import FileOrUrlInput from '@/components/ui/file-or-url-input';
import { togglesFromMatrix } from '@/lib/utils/permission-matrix';
import { describeRRule } from '@/lib/utils/recurrence';
import type { JvbSizingConfig } from '@/lib/jvb-sizing';

import type { WizardForm } from './wizard-shell';

/** Format a timezone-naive "YYYY-MM-DDTHH:MM" wall-clock value (entered in the
 *  event's own timezone) into a human string, without re-interpreting the zone
 *  through the browser. Falls back to the raw string if unparseable. */
function formatWallClock(dtLocal: string, locale: string): string {
  if (!dtLocal) return '—';
  const [datePart, timePart] = dtLocal.split('T');
  const [y, m, d] = (datePart ?? '').split('-').map(Number);
  if (!y || !m || !d) return dtLocal;
  const dateStr = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
  return timePart ? `${dateStr}, ${timePart}` : dateStr;
}

interface Props {
  form: WizardForm;
  onChange: (patch: Partial<WizardForm>) => void;
  jvbSizingConfig: JvbSizingConfig;
  defaultSenderRatioPct: number;
  defaultLocale: string;
  gdprTemplates: Array<{ id: string; name: string; isDefault: boolean }>;
  fieldErrors?: Record<string, string>;
}

export default function Step5Review({
  form,
  onChange,
  jvbSizingConfig,
  defaultSenderRatioPct,
  defaultLocale,
  gdprTemplates,
  fieldErrors = {},
}: Props) {
  const t = useTranslations('admin.wizard.step5');
  const toggles = togglesFromMatrix(form.permissionMatrix);
  // Use the site default locale (not a client-side navigator.language guess)
  // so the summary is stable and correct for locale-only events.
  const locale: 'it' | 'en' = defaultLocale === 'it' ? 'it' : 'en';

  const recurrenceText =
    form.recurrenceRule && form.recurrencePreset !== 'none'
      ? describeRRule(form.recurrenceRule, locale as 'it' | 'en')
      : t('noRecurrence');

  return (
    <div>
      <h2 className="h4 fw-bold mb-3" style={{ color: 'var(--app-text)' }}>
        {t('heading')}
      </h2>
      <p className="text-secondary mb-4" style={{ fontSize: '0.9rem' }}>
        {t('intro')}
      </p>

      {/* Summary card */}
      <div
        className="p-3 mb-4 rounded border"
        style={{ backgroundColor: '#F5F7FB', borderColor: '#dee5ec' }}
      >
        <div className="row g-2" style={{ fontSize: '0.9rem' }}>
          <SummaryItem
            label={t('summary.title')}
            value={form.title[defaultLocale] || form.title.it || form.title.en || '—'}
          />
          <SummaryItem
            label={t('summary.schedule')}
            value={`${formatWallClock(form.startsAt, locale)} → ${formatWallClock(
              form.endsAt,
              locale,
            )} (${form.timezone})`}
          />
          <SummaryItem
            label={t('summary.recurrence')}
            value={recurrenceText}
          />
          <SummaryItem
            label={t('summary.maxParticipants')}
            value={String(form.maxParticipants)}
          />
          <SummaryItem
            label={t('summary.organizers')}
            value={
              form.organizers.length > 0
                ? form.organizers.map((o) => o.name).join(', ')
                : '—'
            }
          />
          <SummaryItem
            label={t('summary.speakers')}
            value={
              form.speakers.length > 0
                ? form.speakers.map((s) => s.name).join(', ')
                : '—'
            }
          />
          <SummaryItem
            label={t('summary.invitations')}
            value={String(form.invitations.length)}
          />
          <SummaryItem
            label={t('summary.materials')}
            value={String(form.materials.length)}
          />
          <SummaryItem
            label={t('summary.tags')}
            value={form.tagSlugs.length > 0 ? form.tagSlugs.join(', ') : '—'}
          />
          <SummaryItem
            label={t('summary.recording')}
            value={
              form.recordingEnabled
                ? form.autoStartRecording
                  ? t('summary.recordingAuto')
                  : t('summary.recordingManual')
                : t('summary.recordingOff')
            }
          />
          {form.multitrackRecordingEnabled && (
            <SummaryItem
              label={t('summary.multitrack')}
              value={t('summary.multitrackOn')}
            />
          )}
        </div>
      </div>

      {/* GDPR / retention */}
      <section className="mb-4">
        <h3 className="h6 fw-semibold mb-2" style={{ color: 'var(--app-text)' }}>
          {t('gdprHeading')}
        </h3>
        <div className="row g-3">
          <div className="col-md-6">
            <label className="form-label" htmlFor="rev-retention">
              {t('retentionDays')}
            </label>
            <input
              id="rev-retention"
              type="number"
              min={1}
              max={365}
              className="form-control"
              value={form.dataRetentionDays}
              onChange={(e) =>
                onChange({
                  dataRetentionDays:
                    Number(e.target.value) || form.dataRetentionDays,
                })
              }
            />
            <small className="form-text text-muted">
              {t('retentionHelp')}
            </small>
          </div>
          <div className="col-md-6">
            <label className="form-label" htmlFor="rev-gdpr-template">
              {t('gdprTemplate')}
            </label>
            <select
              id="rev-gdpr-template"
              className="form-select"
              value={form.gdprTemplateId ?? ''}
              onChange={(e) =>
                onChange({ gdprTemplateId: e.target.value || null })
              }
            >
              <option value="">{t('gdprTemplateNone')}</option>
              {gdprTemplates.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                  {g.isDefault ? ' ★' : ''}
                </option>
              ))}
            </select>
          </div>
          {!form.gdprTemplateId && (
            <div className="col-12">
              <label className="form-label" htmlFor="rev-gdpr-text">
                {t('privacyText')}
              </label>
              <textarea
                id="rev-gdpr-text"
                className="form-control"
                rows={4}
                value={form.privacyPolicyText ?? ''}
                onChange={(e) => onChange({ privacyPolicyText: e.target.value })}
              />
              <small className="form-text text-muted">
                {t('privacyTextHelp')}
              </small>
            </div>
          )}
          <div className="col-12">
            <FileOrUrlInput
              id="rev-privacy-doc"
              label={t('privacyDoc')}
              assetType="document"
              value={form.privacyPolicyUrl}
              onChange={(next) => onChange({ privacyPolicyUrl: next })}
              helpText={t('privacyDocHelp')}
            />
          </div>
        </div>
      </section>

      {/* Moderator contact (optional but used for confirmation mail) */}
      <section className="mb-4">
        <h3 className="h6 fw-semibold mb-2" style={{ color: 'var(--app-text)' }}>
          {t('moderatorHeading')}
        </h3>
        <p className="text-secondary mb-2" style={{ fontSize: '0.82rem' }}>
          {t('moderatorPublishHint')}
        </p>
        <div className="row g-3">
          <div className="col-md-6">
            <label className="form-label" htmlFor="rev-mod-name">
              {t('moderatorName')}
            </label>
            <input
              id="rev-mod-name"
              type="text"
              className={`form-control${fieldErrors.moderatorName ? ' is-invalid' : ''}`}
              value={form.moderatorName ?? ''}
              onChange={(e) => onChange({ moderatorName: e.target.value })}
            />
            {fieldErrors.moderatorName && (
              <div className="invalid-feedback d-block">{t('moderatorRequired')}</div>
            )}
          </div>
          <div className="col-md-6">
            <label className="form-label" htmlFor="rev-mod-email">
              {t('moderatorEmail')}
            </label>
            <input
              id="rev-mod-email"
              type="email"
              className={`form-control${fieldErrors.moderatorEmail ? ' is-invalid' : ''}`}
              value={form.moderatorEmail ?? ''}
              onChange={(e) => onChange({ moderatorEmail: e.target.value })}
            />
            {fieldErrors.moderatorEmail && (
              <div className="invalid-feedback d-block">{t('moderatorEmailRequired')}</div>
            )}
          </div>
        </div>
      </section>

      {/* Load capacity */}
      <section className="mb-4">
        <h3 className="h6 fw-semibold mb-2" style={{ color: 'var(--app-text)' }}>
          {t('capacityHeading')}
        </h3>
        <JvbCapacityPreview
          maxParticipants={form.maxParticipants}
          senderRatioPct={form.expectedSenderRatioPct}
          onSenderRatioChange={(next) =>
            onChange({ expectedSenderRatioPct: next })
          }
          videoEnabled={toggles.participantsCanStartVideo}
          defaultSenderRatioPct={defaultSenderRatioPct}
          sizingConfig={jvbSizingConfig}
        />
      </section>

      {/* Feature diagram */}
      <section className="mb-3">
        <h3 className="h6 fw-semibold mb-2" style={{ color: 'var(--app-text)' }}>
          {t('featuresHeading')}
        </h3>
        <EventConfigDiagram
          event={{
            maxParticipants: form.maxParticipants,
            qaEnabled: toggles.qaEnabled,
            chatEnabled: toggles.chatEnabled,
            recordingEnabled: form.recordingEnabled,
            participantsCanUnmute: toggles.participantsCanUnmute,
            participantsCanStartVideo: toggles.participantsCanStartVideo,
            participantsCanShareScreen: toggles.participantsCanShareScreen,
            speakers: form.speakers.map((s) => s.name).join(', ') || undefined,
          }}
          adminMode
        />
      </section>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="col-md-6">
      <div
        className="text-secondary"
        style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.4 }}
      >
        {label}
      </div>
      <div className="fw-semibold" style={{ color: 'var(--app-text)', wordBreak: 'break-word' }}>
        {value}
      </div>
    </div>
  );
}
