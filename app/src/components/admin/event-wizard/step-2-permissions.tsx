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
}

interface Props {
  value: Step2Value;
  onChange: (patch: Partial<Step2Value>) => void;
}

export default function Step2Permissions({ value, onChange }: Props) {
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
      <h2 className="h4 fw-bold mb-3" style={{ color: '#17324D' }}>
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
                  <div className="fw-semibold" style={{ color: '#17324D' }}>
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
        <h3 className="h6 fw-semibold mb-3" style={{ color: '#17324D' }}>
          {t('recordingHeading')}
        </h3>

        <div className="py-2 d-flex justify-content-between align-items-start">
          <div className="me-3">
            <div className="fw-semibold" style={{ color: '#17324D' }}>
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
              <div className="fw-semibold" style={{ color: '#17324D' }}>
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
    </div>
  );
}
