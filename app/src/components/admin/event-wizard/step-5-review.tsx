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

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';

import EventConfigDiagram from '@/components/admin/event-config-diagram';
import JvbCapacityPreview, { capacityWarnings } from '@/components/admin/jvb-capacity-preview';
import FileOrUrlInput from '@/components/ui/file-or-url-input';
import { togglesFromMatrix } from '@/lib/utils/permission-matrix';
import { MAX_RETENTION_DAYS } from '@/lib/validation/retention';
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
  /** L'email con cui il wizard ha precompilato il moderatore principale (chi
   *  crea l'evento): finche' resta quella, la pagina lo dice. */
  prefilledModeratorEmail?: string | null;
  /** Il massimo per la conservazione: piu' alto del normale solo in modifica,
   *  per un evento gia' salvato cosi'. */
  retentionMax?: number;
}

export default function Step5Review({
  form,
  onChange,
  jvbSizingConfig,
  defaultSenderRatioPct,
  defaultLocale,
  gdprTemplates,
  fieldErrors = {},
  prefilledModeratorEmail = null,
  retentionMax = MAX_RETENTION_DAYS,
}: Props) {
  const t = useTranslations('admin.wizard.step5');
  const toggles = togglesFromMatrix(form.permissionMatrix);
  // I dettagli tecnici sono ripiegati, ma un avviso di capacita' (bridge al
  // tetto, quota di partecipanti attivi ereditata su un evento grande) non
  // deve restare dentro: con un avviso la sezione si apre da sola.
  const avvisi = capacityWarnings({
    maxParticipants: form.maxParticipants,
    senderRatioPct: form.expectedSenderRatioPct,
    videoEnabled: toggles.participantsCanStartVideo,
    defaultSenderRatioPct,
    sizingConfig: jvbSizingConfig,
  });
  const conAvviso = avvisi.atCeiling || avvisi.shouldWarnInherited;
  const tecnicaRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (conAvviso && tecnicaRef.current) tecnicaRef.current.open = true;
  }, [conAvviso]);
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

      {/* Primary moderator: name+email are required to publish. This person
          receives the moderator magic link (ADR-003) — distinct from the
          additional co-moderators added in the People step. */}
      <section className="mb-4">
        <h3 className="h6 fw-semibold mb-2" style={{ color: 'var(--app-text)' }}>
          {t('moderatorHeading')}
        </h3>
        <p className="text-secondary mb-2" style={{ fontSize: '0.82rem' }}>
          {t('moderatorPublishHint')}
        </p>
        {/* Precompilato con chi crea l'evento: se lo modera un'altra persona,
            il link deve arrivare a lei, non a chi lo ha preparato. */}
        {prefilledModeratorEmail &&
          (form.moderatorEmail ?? '').trim().toLowerCase() === prefilledModeratorEmail.trim().toLowerCase() && (
            <div className="alert alert-warning py-2 mb-3" role="note" style={{ fontSize: '0.85rem' }}>
              {t('moderatorPrefilled')}
            </div>
          )}
        <div
          className="p-2 mb-3 rounded"
          style={{
            background: 'rgba(0,102,204,0.08)',
            border: '1px solid rgba(0,102,204,0.25)',
            color: 'var(--app-text)',
            fontSize: '0.82rem',
          }}
        >
          {t('moderatorLinkNote')}
        </div>
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
              max={retentionMax}
              className={`form-control${fieldErrors.dataRetentionDays ? ' is-invalid' : ''}`}
              value={form.dataRetentionDays}
              onChange={(e) =>
                onChange({
                  dataRetentionDays:
                    Number(e.target.value) || form.dataRetentionDays,
                })
              }
              aria-describedby="rev-retention-help"
            />
            {fieldErrors.dataRetentionDays && (
              <div className="invalid-feedback d-block">
                {t('retentionRange', { max: MAX_RETENTION_DAYS })}
              </div>
            )}
            <small id="rev-retention-help" className="form-text text-muted">
              {t('retentionHelp')}
            </small>
          </div>
          <div className="col-md-6">
            <label className="form-label" htmlFor="rev-gdpr-template">
              {t('gdprTemplate')}
            </label>
            <select
              id="rev-gdpr-template"
              className={`form-select${fieldErrors.gdprTemplateId ? ' is-invalid' : ''}`}
              value={form.gdprTemplateId ?? ''}
              onChange={(e) => {
                const id = e.target.value || null;
                // Scegliere un modello azzera il testo scritto a mano: la
                // pagina di registrazione dà la precedenza al testo, e la
                // casella che lo contiene sparisce appena un modello è
                // scelto. Senza questo, il testo continuerebbe a vincere su
                // una scelta che si vede fatta e non si può più disfare.
                onChange({ gdprTemplateId: id, ...(id ? { privacyPolicyText: '' } : {}) });
              }}
            >
              <option value="">{t('gdprTemplateNone')}</option>
              {gdprTemplates.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                  {g.isDefault ? ' ★' : ''}
                </option>
              ))}
            </select>
            {fieldErrors.gdprTemplateId && (
              <div className="invalid-feedback d-block">
                {t('gdprTemplateUnknown')}
              </div>
            )}
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

      {/* Capacita' e risorse: utili a chi dimensiona l'installazione, non a
          chi prepara l'evento. Chiuse: il modello le ha gia' impostate. */}
      <details className="wizard-tech mb-3" ref={tecnicaRef}>
        <summary>{t('technicalDetails')}</summary>
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
      </details>
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
