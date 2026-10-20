'use client';

/**
 * Passo «Permessi»: i ruoli dell'evento e la tabella ruolo × funzione.
 *
 * Si sceglie solo per i partecipanti: la colonna dei moderatori è sempre
 * accesa, quella dei relatori mostra ciò che hanno in sala, e la matrice si
 * salva normalizzata allo stesso modo (withRoleInvariants). Il comando della
 * registrazione è una riga della tabella, nascosta quando la registrazione è
 * spenta.
 */

import { useTranslations } from 'next-intl';

import { parseLocaleList } from '@/components/admin/language-checklist';
import ToggleSwitch from '@/components/ui/toggle-switch';
import {
  EVENT_ROLES,
  EVENT_FEATURES,
  withRoleInvariants,
  type EventRole,
  type EventFeature,
  type PermissionMatrix,
} from '@/lib/utils/permission-matrix';

import { nomeLingua } from './text-translation';

export interface StepPermissionsValue {
  permissionMatrix: PermissionMatrix;
  recordingEnabled: boolean;
  autoStartRecording: boolean;
  /** Agenda/note live (checklist opt-in). */
  agendaEnabled: boolean;
  /** Nuvola di parole live (opt-in). */
  wordCloudEnabled: boolean;
  /** Lavagna condivisa (whiteboard Excalidraw nativa) opt-in. */
  whiteboardEnabled: boolean;
  /** Sottotitoli live: accesi di default, si spengono qui o dalla Regia. */
  liveCaptionsEnabled: boolean;
  /** La trascrizione dell'evento costruita dai sottotitoli (chi acconsente). */
  captionsTranscriptEnabled: boolean;
  // ── Post-produzione AI (subordinata a recordingEnabled) ──
  aiTranscriptEnabled: boolean;
  aiSummaryEnabled: boolean;
  aiTranslationEnabled: boolean;
  aiDubbingEnabled: boolean;
  multitrackRecordingEnabled: boolean;
  /** Conserva le tracce per-partecipante (archivio/riascolto). PII. */
  retainParticipantTracks: boolean;
  /** Le lingue dell'evento, codici separati da virgola (es. "en,fr"): si
   *  scelgono nel passo «Evento»; qui valgono per sottotitoli e sintesi. */
  aiTargetLocales: string | null;
  /** Numero di parlanti attesi (forza k nella diarization). */
  expectedSpeakers: number | null;
}

interface Props {
  value: StepPermissionsValue;
  onChange: (patch: Partial<StepPermissionsValue>) => void;
  fieldErrors?: Record<string, string>;
  /**
   * Se l'installazione ha il servizio della lavagna di Jitsi. Senza, la sala
   * non mostra la lavagna qualunque cosa dica l'evento: l'interruttore non si
   * accende e dice perche'. Resta spegnibile, per togliere un valore rimasto
   * da un modello o da un evento precedente.
   */
  whiteboardInfraReady: boolean;
  /** I sottotitoli live ci sono nell'installazione: senza, l'interruttore
   *  non si mostra (non c'e' niente da accendere). */
  liveCaptionsAvailable?: boolean;
  /** Porta alle lingue dell'evento, nel passo «Evento». */
  onCambiaLingue?: () => void;
  /** La post-produzione AI e' accesa sull'installazione? Spenta, le sue
   *  funzioni non si propongono: si mostrano solo se l'evento le ha gia'
   *  (per poterle togliere). */
  aiPipelineEnabled?: boolean;
  /** In modifica le scelte gia' fatte non si cambiano da sole: accendere la
   *  registrazione o la trascrizione non accende le tracce per partecipante,
   *  che chiederebbero il consenso a chi e' gia' iscritto. */
  editing?: boolean;
  /** La registrazione non parte mai da sola: l'interruttore dell'avvio
   *  automatico si mostra solo su un evento che ce l'ha gia' acceso, per
   *  poterlo spegnere. */
  showAutoStart?: boolean;
  /** Quale parte mostrare, fra le impostazioni avanzate: chi puo' fare cosa e
   *  le funzioni della sala, oppure registrazione e post-produzione AI. */
  parte: 'partecipazione' | 'registrazione';
}

/** Le funzioni AI che si accendono con la registrazione: chi registra ha
 *  trascrizione, sintesi e traduzione (nelle lingue dell'evento) e le tracce
 *  per partecipante, che dicono chi parla. */
function aiConLaRegistrazione(value: StepPermissionsValue): Partial<StepPermissionsValue> {
  // La traduzione si accende solo se l'evento ha almeno un'altra lingua: le
  // lingue dell'evento non si aggiungono da qui (sono anche le schede e le
  // pagine dell'evento).
  return {
    aiTranscriptEnabled: true,
    aiSummaryEnabled: true,
    aiTranslationEnabled: parseLocaleList(value.aiTargetLocales).length > 0,
    multitrackRecordingEnabled: true,
  };
}

/**
 * Il valore di una cella che non si sceglie, o null per quelle dei
 * partecipanti. In sala i moderatori possono tutto; i relatori hanno sempre
 * microfono, video e schermo, vedono chat e domande come i partecipanti e non
 * comandano la registrazione.
 */
function cellaFissa(feature: EventFeature, role: EventRole, matrix: PermissionMatrix): boolean | null {
  if (role === 'MODERATOR') return true;
  if (role !== 'SPEAKER') return null;
  if (feature === 'mic' || feature === 'video' || feature === 'share') return true;
  if (feature === 'recording_control') return false;
  return matrix[feature]?.includes('GUEST') ?? false;
}

export default function StepPermissions({
  value,
  onChange,
  fieldErrors = {},
  whiteboardInfraReady,
  liveCaptionsAvailable = false,
  onCambiaLingue,
  aiPipelineEnabled = true,
  editing = false,
  showAutoStart = false,
  parte,
}: Props) {
  const t = useTranslations('admin.wizard.step2');
  const tAdmin = useTranslations('admin');
  const tTrad = useTranslations('admin.textTranslation');

  const setCell = (feature: EventFeature, role: EventRole, allowed: boolean) => {
    const current = new Set(value.permissionMatrix[feature] ?? []);
    if (allowed) current.add(role);
    else current.delete(role);
    const next: PermissionMatrix = {
      ...value.permissionMatrix,
      [feature]: Array.from(current) as EventRole[],
    };
    onChange({ permissionMatrix: withRoleInvariants(next) });
  };

  const visibleFeatures = EVENT_FEATURES.filter(
    (f) => f !== 'recording_control' || value.recordingEnabled,
  );

  // Le due sezioni delle impostazioni avanzate: hanno il titolo nella
  // sezione che le contiene.
  if (parte === 'partecipazione') {
    return (
      <div>
      {/* I ruoli, dal più ampio: chi li ha lo decide il passo «Persone». */}
      <section className="wizard-roles mb-4" aria-labelledby="wiz-roles-title">
        <h3 id="wiz-roles-title" className="h6 fw-semibold mb-2" style={{ color: 'var(--app-text)' }}>
          {t('rolesHeading')}
        </h3>
        <dl className="wizard-roles__list mb-0">
          {(['organizer', 'moderator', 'speaker', 'guest'] as const).map((r) => (
            <div key={r} className="wizard-roles__item">
              <dt>{t(`roleInfo.${r}.name`)}</dt>
              <dd>{t(`roleInfo.${r}.desc`)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="table-responsive mb-4">
        <table
          className="table table-bordered align-middle mb-0 bg-white permission-matrix"
          style={{ borderRadius: 8, overflow: 'hidden' }}
        >
          <thead>
            <tr>
              <th scope="col" style={{ width: '30%' }}>
                {t('featureCol')}
              </th>
              {EVENT_ROLES.map((role) => (
                <th scope="col" key={role} className="text-center">
                  {role === 'MODERATOR' ? t('roleModeratorColumn') : t(`role.${role}`)}
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
                  // Si sceglie solo per i partecipanti: relatori e moderatori
                  // hanno ciò che il ruolo dà loro in sala (cellaFissa).
                  const fissa = cellaFissa(feature, role, value.permissionMatrix);
                  const checked = fissa ?? value.permissionMatrix[feature]?.includes(role) ?? false;
                  const ruolo = role === 'MODERATOR' ? t('roleModeratorColumn') : t(`role.${role}`);
                  return (
                    <td key={role} className="text-center">
                      <input
                        type="checkbox"
                        className="form-check-input"
                        checked={checked}
                        disabled={fissa !== null}
                        onChange={(e) => setCell(feature, role, e.target.checked)}
                        aria-label={`${t(`feature.${feature}.label`)} — ${ruolo}`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Interazione live — feature opzionali della stanza */}
      <section className="mb-3">
        <h3 className="h6 fw-semibold mb-3" style={{ color: 'var(--app-text)' }}>
          {t('roomFeaturesHeading')}
        </h3>
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
            ariaLabel={tAdmin('form.agendaEnabled')}
            checked={value.agendaEnabled}
            onChange={() => onChange({ agendaEnabled: !value.agendaEnabled })}
          />
        </div>
        <div className="py-2 d-flex justify-content-between align-items-start">
          <div className="me-3">
            <div className="fw-semibold" style={{ color: 'var(--app-text)' }}>
              {tAdmin('form.wordCloudEnabled')}
            </div>
            <div className="text-secondary" style={{ fontSize: '0.85rem' }}>
              {tAdmin('form.wordCloudEnabledDesc')}
            </div>
          </div>
          <ToggleSwitch
            label=""
            ariaLabel={tAdmin('form.wordCloudEnabled')}
            checked={value.wordCloudEnabled}
            onChange={() => onChange({ wordCloudEnabled: !value.wordCloudEnabled })}
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
            {!whiteboardInfraReady && (
              <div
                className="fw-semibold"
                style={{ fontSize: '0.85rem', color: 'var(--app-text)' }}
              >
                {tAdmin('form.whiteboardUnavailable')}
              </div>
            )}
          </div>
          <ToggleSwitch
            label=""
            ariaLabel={tAdmin('form.whiteboardEnabled')}
            checked={value.whiteboardEnabled}
            disabled={!whiteboardInfraReady && !value.whiteboardEnabled}
            onChange={() => onChange({ whiteboardEnabled: !value.whiteboardEnabled })}
          />
        </div>
        {liveCaptionsAvailable && (
          <div className="py-2 d-flex justify-content-between align-items-start">
            <div className="me-3">
              <div className="fw-semibold" style={{ color: 'var(--app-text)' }}>
                {tAdmin('form.liveCaptionsEnabled')}
              </div>
              <div className="text-secondary" style={{ fontSize: '0.85rem' }}>
                {tAdmin('form.liveCaptionsEnabledDesc')}
              </div>
            </div>
            <ToggleSwitch
              label=""
              ariaLabel={tAdmin('form.liveCaptionsEnabled')}
              checked={value.liveCaptionsEnabled}
              onChange={() => onChange({ liveCaptionsEnabled: !value.liveCaptionsEnabled })}
            />
          </div>
        )}
        {liveCaptionsAvailable && value.liveCaptionsEnabled && (
          <div className="py-2 ps-3 d-flex justify-content-between align-items-start">
            <div className="me-3">
              <div className="fw-semibold" style={{ color: 'var(--app-text)' }}>
                {tAdmin('form.captionsTranscriptEnabled')}
              </div>
              <div className="text-secondary" style={{ fontSize: '0.85rem' }}>
                {tAdmin('form.captionsTranscriptEnabledDesc')}
              </div>
            </div>
            <ToggleSwitch
              label=""
              ariaLabel={tAdmin('form.captionsTranscriptEnabled')}
              checked={value.captionsTranscriptEnabled}
              onChange={() =>
                onChange({ captionsTranscriptEnabled: !value.captionsTranscriptEnabled })
              }
            />
          </div>
        )}
      </section>

      </div>
    );
  }

  return (
    <div>
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
            ariaLabel={tAdmin('form.recordingEnabled')}
            checked={value.recordingEnabled}
            onChange={() =>
              onChange({
                recordingEnabled: !value.recordingEnabled,
                autoStartRecording: !value.recordingEnabled ? value.autoStartRecording : false,
                // Chi registra ha per default trascrizione, sintesi,
                // traduzione e tracce per partecipante, se l'elaborazione AI
                // e' attiva sull'istanza; si spengono qui sotto.
                ...(!value.recordingEnabled && aiPipelineEnabled && !editing
                  ? aiConLaRegistrazione(value)
                  : {}),
              })
            }
          />
        </div>

        {value.recordingEnabled && !value.autoStartRecording && (
          <p className="text-secondary mb-0 py-2" style={{ fontSize: '0.85rem', borderTop: '1px solid #e8e8e8' }}>
            {t('recordingManualNote')}
          </p>
        )}

        {value.recordingEnabled && showAutoStart && (
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
              ariaLabel={tAdmin('form.autoStartRecording')}
              checked={value.autoStartRecording}
              onChange={() =>
                onChange({ autoStartRecording: !value.autoStartRecording })
              }
            />
          </div>
        )}
      </section>

      {/* Post-produzione AI — solo se recording attiva. Renderizzata
          come sezione separata sotto la registrazione (la AI lavora
          sulla registrazione, ne è subordinata). */}
      {value.recordingEnabled && !aiPipelineEnabled && !value.aiTranscriptEnabled && (
        <p className="text-secondary mb-3" style={{ fontSize: '0.85rem' }}>
          {t('aiPipelineOff')}
        </p>
      )}
      {value.recordingEnabled && (aiPipelineEnabled || value.aiTranscriptEnabled) && (
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
                  ? editing
                    ? { aiTranscriptEnabled: true }
                    : aiConLaRegistrazione(value)
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
                warning
                badge={tAdmin('form.consentBadge')}
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
                  warning
                  badge={tAdmin('form.retentionBadge')}
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
                onToggle={() =>
                  onChange(
                    value.aiTranslationEnabled
                      ? { aiTranslationEnabled: false, aiDubbingEnabled: false }
                      : { aiTranslationEnabled: true },
                  )
                }
              />

              {/* Le lingue sono quelle dell'evento: si cambiano nel passo
                  «Evento», dove fanno anche le schede di titolo e descrizione. */}
              {value.aiTranslationEnabled && (
                <p className="py-2 mb-0 small" style={{ borderTop: '1px solid #e8e8e8' }}>
                  {tTrad('languagesLine', {
                    list:
                      parseLocaleList(value.aiTargetLocales).map(nomeLingua).join(', ') ||
                      tTrad('noLanguages'),
                  })}
                  {onCambiaLingue && (
                    <>
                      {' · '}
                      <button
                        type="button"
                        className="btn btn-link p-0 align-baseline"
                        onClick={onCambiaLingue}
                      >
                        {tTrad('changeInEventStep', { step: tAdmin('wizard.flow.steps.base') })}
                      </button>
                    </>
                  )}
                  {fieldErrors.aiTargetLocales && (
                    <span className="d-block text-danger">{tTrad('languagesRequired')}</span>
                  )}
                </p>
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
  warning = false,
  badge,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onToggle: () => void;
  /** Render as a consent/PII-sensitive callout (amber accent) with a badge. */
  warning?: boolean;
  badge?: string;
}) {
  return (
    <div
      className="py-2 d-flex justify-content-between align-items-start"
      style={{
        borderTop: '1px solid #e8e8e8',
        ...(warning
          ? {
              background: 'rgba(166, 99, 0, 0.06)',
              borderLeft: '3px solid #A66300',
              paddingLeft: '0.6rem',
              borderTopLeftRadius: '4px',
              borderBottomLeftRadius: '4px',
            }
          : {}),
      }}
    >
      <div className="me-3">
        <div
          className="fw-semibold d-flex align-items-center flex-wrap gap-2"
          style={{ color: 'var(--app-text)' }}
        >
          {label}
          {badge && (
            <span
              style={{
                background: '#A66300',
                color: '#fff',
                fontSize: '0.65rem',
                fontWeight: 700,
                padding: '2px 6px',
                borderRadius: '4px',
                textTransform: 'uppercase',
                letterSpacing: '0.02em',
              }}
            >
              {badge}
            </span>
          )}
        </div>
        <div className="text-secondary" style={{ fontSize: '0.85rem' }}>
          {desc}
        </div>
      </div>
      <ToggleSwitch label="" ariaLabel={label} checked={checked} onChange={onToggle} />
    </div>
  );
}
