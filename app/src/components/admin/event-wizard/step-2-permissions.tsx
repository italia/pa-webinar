'use client';

/**
 * Step 2 — Permissions matrix.
 *
 * A role×feature grid. Each cell is a checkbox: "can this role do this?".
 * The MODERATOR column is always disabled-checked (invariant: moderators can
 * do everything). Recording control is treated as a feature in the matrix
 * but also gated by the top-level `recordingEnabled` toggle — when recording
 * is off, the row is hidden.
 */

import { useTranslations } from 'next-intl';

import ToggleSwitch from '@/components/ui/toggle-switch';
import {
  EVENT_ROLES,
  EVENT_FEATURES,
  withModeratorInvariant,
  type EventRole,
  type EventFeature,
  type PermissionMatrix,
} from '@/lib/utils/permission-matrix';

export interface Step2Value {
  permissionMatrix: PermissionMatrix;
  recordingEnabled: boolean;
  autoStartRecording: boolean;
  /** Agenda/note live (checklist opt-in). */
  agendaEnabled: boolean;
  /** Lavagna condivisa (whiteboard Excalidraw nativa) opt-in. */
  whiteboardEnabled: boolean;
  // ── Post-produzione AI (subordinata a recordingEnabled) ──
  aiTranscriptEnabled: boolean;
  aiSummaryEnabled: boolean;
  aiTranslationEnabled: boolean;
  aiDubbingEnabled: boolean;
  multitrackRecordingEnabled: boolean;
  /** Conserva le tracce per-partecipante (archivio/riascolto). PII. */
  retainParticipantTracks: boolean;
  /** Comma-separated ISO-639-1 (es. "en,fr"). Null/empty = usa il
   *  default impostato a livello sito. */
  aiTargetLocales: string | null;
  /** Numero di parlanti attesi (forza k nella diarization). */
  expectedSpeakers: number | null;
}

interface Props {
  value: Step2Value;
  onChange: (patch: Partial<Step2Value>) => void;
  fieldErrors?: Record<string, string>;
}

export default function Step2Permissions({ value, onChange, fieldErrors = {} }: Props) {
  const t = useTranslations('admin.wizard.step2');
  const tAdmin = useTranslations('admin');

  const setCell = (feature: EventFeature, role: EventRole, allowed: boolean) => {
    const current = new Set(value.permissionMatrix[feature] ?? []);
    if (allowed) current.add(role);
    else current.delete(role);
    const next: PermissionMatrix = {
      ...value.permissionMatrix,
      [feature]: Array.from(current) as EventRole[],
    };
    onChange({ permissionMatrix: withModeratorInvariant(next) });
  };

  const visibleFeatures = EVENT_FEATURES.filter(
    (f) => f !== 'recording_control' || value.recordingEnabled,
  );

  return (
    <div>
      <h2 className="h4 fw-bold mb-3" style={{ color: 'var(--app-text)' }}>
        {t('heading')}
      </h2>
      <p className="text-secondary mb-4" style={{ fontSize: '0.9rem' }}>
        {t('intro')}
      </p>

      <div className="table-responsive mb-4">
        <table
          className="table table-bordered align-middle mb-0 bg-white"
          style={{ borderRadius: 8, overflow: 'hidden' }}
        >
          <thead>
            <tr>
              <th scope="col" style={{ width: '30%' }}>
                {t('featureCol')}
              </th>
              {EVENT_ROLES.map((role) => (
                <th scope="col" key={role} className="text-center">
                  {t(`role.${role}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleFeatures.map((feature) => (
              <tr key={feature}>
                <th scope="row">
                  <div className="fw-semibold" style={{ color: 'var(--app-text)' }}>
                    {t(`feature.${feature}.label`)}
                  </div>
                  <div className="text-secondary" style={{ fontSize: '0.8rem' }}>
                    {t(`feature.${feature}.desc`)}
                  </div>
                </th>
                {EVENT_ROLES.map((role) => {
                  const isModerator = role === 'MODERATOR';
                  const checked = value.permissionMatrix[feature]?.includes(role) ?? false;
                  return (
                    <td key={role} className="text-center">
                      <input
                        type="checkbox"
                        className="form-check-input"
                        checked={isModerator ? true : checked}
                        disabled={isModerator}
                        onChange={(e) => setCell(feature, role, e.target.checked)}
                        aria-label={`${t(`feature.${feature}.label`)} — ${t(`role.${role}`)}`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Recording toggles (global) */}
      <section className="mb-3">
        <h3 className="h6 fw-semibold mb-3" style={{ color: 'var(--app-text)' }}>
          {t('recordingHeading')}
        </h3>

        <div className="py-2 d-flex justify-content-between align-items-start">
          <div className="me-3">
            <div className="fw-semibold" style={{ color: 'var(--app-text)' }}>
              {tAdmin('form.recordingEnabled')}
            </div>
            <div className="text-secondary" style={{ fontSize: '0.85rem' }}>
              {tAdmin('toggleRecordingDesc')}
            </div>
          </div>
          <ToggleSwitch
            label=""
            checked={value.recordingEnabled}
            onChange={() =>
              onChange({
                recordingEnabled: !value.recordingEnabled,
                autoStartRecording: !value.recordingEnabled ? value.autoStartRecording : false,
              })
            }
          />
        </div>

        {value.recordingEnabled && (
          <div
            className="py-2 d-flex justify-content-between align-items-start"
            style={{ borderTop: '1px solid #e8e8e8' }}
          >
            <div className="me-3">
              <div className="fw-semibold" style={{ color: 'var(--app-text)' }}>
                {tAdmin('form.autoStartRecording')}
              </div>
              <div className="text-secondary" style={{ fontSize: '0.85rem' }}>
                {tAdmin('form.autoStartRecordingDesc')}
              </div>
            </div>
            <ToggleSwitch
              label=""
              checked={value.autoStartRecording}
              onChange={() =>
                onChange({ autoStartRecording: !value.autoStartRecording })
              }
            />
          </div>
        )}
      </section>

      {/* Interazione live — feature opzionali della stanza */}
      <section className="mb-3">
        <div className="py-2 d-flex justify-content-between align-items-start">
          <div className="me-3">
            <div className="fw-semibold" style={{ color: 'var(--app-text)' }}>
              {tAdmin('form.agendaEnabled')}
            </div>
            <div className="text-secondary" style={{ fontSize: '0.85rem' }}>
              {tAdmin('form.agendaEnabledDesc')}
            </div>
          </div>
          <ToggleSwitch
            label=""
            checked={value.agendaEnabled}
            onChange={() => onChange({ agendaEnabled: !value.agendaEnabled })}
          />
        </div>
        <div className="py-2 d-flex justify-content-between align-items-start">
          <div className="me-3">
            <div className="fw-semibold" style={{ color: 'var(--app-text)' }}>
              {tAdmin('form.whiteboardEnabled')}
            </div>
            <div className="text-secondary" style={{ fontSize: '0.85rem' }}>
              {tAdmin('form.whiteboardEnabledDesc')}
            </div>
          </div>
          <ToggleSwitch
            label=""
            checked={value.whiteboardEnabled}
            onChange={() => onChange({ whiteboardEnabled: !value.whiteboardEnabled })}
          />
        </div>
      </section>

      {/* Post-produzione AI — solo se recording attiva. Renderizzata
          come sezione separata sotto la registrazione (la AI lavora
          sulla registrazione, ne è subordinata). */}
      {value.recordingEnabled && (
        <section className="mb-3">
          <h3 className="h6 fw-semibold mb-1" style={{ color: 'var(--app-text)' }}>
            {tAdmin('form.aiSectionHeading')}
          </h3>
          <p className="text-secondary mb-3" style={{ fontSize: '0.85rem' }}>
            {tAdmin('form.aiSectionDesc')}
          </p>

          <AiToggle
            label={tAdmin('form.aiTranscriptEnabled')}
            desc={tAdmin('form.aiTranscriptEnabledDesc')}
            checked={value.aiTranscriptEnabled}
            onToggle={() => {
              const next = !value.aiTranscriptEnabled;
              // Disattivare la trascrizione disattiva anche sintesi,
              // traduzione e doppiaggio (dipendenze): non avrebbero
              // input.
              onChange(
                next
                  ? { aiTranscriptEnabled: true }
                  : {
                      aiTranscriptEnabled: false,
                      aiSummaryEnabled: false,
                      aiTranslationEnabled: false,
                      aiDubbingEnabled: false,
                      multitrackRecordingEnabled: false,
                    },
              );
            }}
          />

          {value.aiTranscriptEnabled && (
            <>
              <AiToggle
                label={tAdmin('form.multitrackRecordingEnabled')}
                desc={tAdmin('form.multitrackRecordingEnabledDesc')}
                checked={value.multitrackRecordingEnabled}
                onToggle={() =>
                  onChange({
                    multitrackRecordingEnabled: !value.multitrackRecordingEnabled,
                    // Disattivare il multitrack disattiva anche la conservazione.
                    retainParticipantTracks: !value.multitrackRecordingEnabled
                      ? value.retainParticipantTracks
                      : false,
                  })
                }
              />

              {value.multitrackRecordingEnabled && (
                <AiToggle
                  label={tAdmin('form.retainParticipantTracks')}
                  desc={tAdmin('form.retainParticipantTracksDesc')}
                  checked={value.retainParticipantTracks}
                  onToggle={() =>
                    onChange({
                      retainParticipantTracks: !value.retainParticipantTracks,
                    })
                  }
                />
              )}

              <AiToggle
                label={tAdmin('form.aiSummaryEnabled')}
                desc={tAdmin('form.aiSummaryEnabledDesc')}
                checked={value.aiSummaryEnabled}
                onToggle={() =>
                  onChange({ aiSummaryEnabled: !value.aiSummaryEnabled })
                }
              />

              <AiToggle
                label={tAdmin('form.aiTranslationEnabled')}
                desc={tAdmin('form.aiTranslationEnabledDesc')}
                checked={value.aiTranslationEnabled}
                onToggle={() => {
                  const next = !value.aiTranslationEnabled;
                  onChange(
                    next
                      ? { aiTranslationEnabled: true }
                      : {
                          aiTranslationEnabled: false,
                          aiDubbingEnabled: false,
                        },
                  );
                }}
              />

              {value.aiTranslationEnabled && (
                <div
                  className="py-2"
                  style={{ borderTop: '1px solid #e8e8e8' }}
                >
                  <label
                    className="fw-semibold mb-1 d-block"
                    style={{ color: 'var(--app-text)', fontSize: '0.9rem' }}
                    htmlFor="aiTargetLocales"
                  >
                    {tAdmin('form.aiTargetLocales')}
                  </label>
                  <p
                    className="text-secondary mb-2"
                    style={{ fontSize: '0.82rem' }}
                  >
                    {tAdmin('form.aiTargetLocalesDesc')}
                  </p>
                  <input
                    id="aiTargetLocales"
                    type="text"
                    className={`form-control form-control-sm${fieldErrors.aiTargetLocales ? ' is-invalid' : ''}`}
                    style={{ maxWidth: 260 }}
                    placeholder="en,fr,de"
                    value={value.aiTargetLocales ?? ''}
                    onChange={(e) =>
                      onChange({
                        aiTargetLocales:
                          e.target.value.trim() === '' ? null : e.target.value,
                      })
                    }
                  />
                  {fieldErrors.aiTargetLocales && (
                    <div className="invalid-feedback d-block">
                      {tAdmin('form.aiTargetLocalesRequired')}
                    </div>
                  )}
                </div>
              )}

              {value.aiTranslationEnabled && (
                <AiToggle
                  label={tAdmin('form.aiDubbingEnabled')}
                  desc={tAdmin('form.aiDubbingEnabledDesc')}
                  checked={value.aiDubbingEnabled}
                  onToggle={() =>
                    onChange({ aiDubbingEnabled: !value.aiDubbingEnabled })
                  }
                />
              )}

              <div
                className="py-2"
                style={{ borderTop: '1px solid #e8e8e8' }}
              >
                <label
                  className="fw-semibold mb-1 d-block"
                  style={{ color: 'var(--app-text)', fontSize: '0.9rem' }}
                  htmlFor="expectedSpeakers"
                >
                  {tAdmin('form.expectedSpeakers')}
                </label>
                <p
                  className="text-secondary mb-2"
                  style={{ fontSize: '0.82rem' }}
                >
                  {tAdmin('form.expectedSpeakersDesc')}
                </p>
                <input
                  id="expectedSpeakers"
                  type="number"
                  min={1}
                  max={30}
                  className="form-control form-control-sm"
                  style={{ maxWidth: 120 }}
                  value={value.expectedSpeakers ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '') {
                      onChange({ expectedSpeakers: null });
                    } else {
                      const n = Number(v);
                      if (!Number.isNaN(n)) onChange({ expectedSpeakers: n });
                    }
                  }}
                />
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

function AiToggle({
  label,
  desc,
  checked,
  onToggle,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className="py-2 d-flex justify-content-between align-items-start"
      style={{ borderTop: '1px solid #e8e8e8' }}
    >
      <div className="me-3">
        <div className="fw-semibold" style={{ color: 'var(--app-text)' }}>
          {label}
        </div>
        <div className="text-secondary" style={{ fontSize: '0.85rem' }}>
          {desc}
        </div>
      </div>
      <ToggleSwitch label="" checked={checked} onChange={onToggle} />
    </div>
  );
}
