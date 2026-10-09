'use client';

/**
 * Le impostazioni avanzate dell'evento: tutto cio' che il modello ha gia'
 * scelto e che di solito non si tocca. Una sezione richiudibile per area
 * (partecipazione, registrazione e AI, contenuti, sala d'attesa e video, dati
 * e pagina dopo l'evento, dettagli tecnici); si apre quella da cui si arriva
 * (il «Modifica» di una scheda del riepilogo, o `?section=` dalla pagina
 * dell'evento): il wizard porta su di lei il fuoco e la vista.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import EventConfigDiagram from '@/components/admin/event-config-diagram';
import JvbCapacityPreview, { capacityWarnings } from '@/components/admin/jvb-capacity-preview';
import FileOrUrlInput from '@/components/ui/file-or-url-input';
import ToggleSwitch from '@/components/ui/toggle-switch';
import { togglesFromMatrix } from '@/lib/utils/permission-matrix';
import { MAX_RETENTION_DAYS } from '@/lib/validation/retention';
import {
  WIZARD_ADVANCED_SECTIONS,
  type WizardAdvancedSection,
} from '@/lib/events/wizard-steps';
import type { JvbSizingConfig } from '@/lib/jvb-sizing';

import type { WizardForm } from './wizard-shell';

export default function AdvancedSettings({
  sections,
  open,
  richiesta = 0,
  templateName,
}: {
  /** Il contenuto di ciascuna sezione; una sezione senza contenuto non c'e'. */
  sections: Partial<Record<WizardAdvancedSection, React.ReactNode>>;
  /** La sezione da aprire (e portare in vista) all'arrivo. */
  open?: WizardAdvancedSection | null;
  /** Cambia a ogni richiesta di aprire una sezione: la si riapre anche se la
   *  si era chiusa. */
  richiesta?: number;
  /** Il modello da cui vengono i valori, se c'e'. */
  templateName?: string | null;
}) {
  const tf = useTranslations('admin.wizard.flow');
  // Le sezioni aperte: quelle chieste da fuori e quelle aperte a mano. Le
  // sezioni restano montate (chiuse si nascondono soltanto): cio' che si sta
  // scrivendo in una non si perde aprendone un'altra.
  const [aperte, setAperte] = useState<ReadonlySet<WizardAdvancedSection>>(
    () => new Set(open ? [open] : []),
  );
  // Una richiesta nuova apre la sua sezione subito, nello stesso giro: chi
  // porta il fuoco su un campo di quella sezione la trova gia' aperta.
  const [ultimaRichiesta, setUltimaRichiesta] = useState(richiesta);
  if (ultimaRichiesta !== richiesta) {
    setUltimaRichiesta(richiesta);
    if (open && !aperte.has(open)) setAperte(new Set([...aperte, open]));
  }

  return (
    <div>
      <h2 className="h4 fw-bold mb-3" style={{ color: 'var(--app-text)' }}>
        {tf('steps.advanced')}
      </h2>
      <p className="text-secondary mb-4" style={{ fontSize: '0.9rem' }}>
        {templateName ? tf('advancedIntroTemplate', { name: templateName }) : tf('advancedIntro')}
      </p>
      {WIZARD_ADVANCED_SECTIONS.filter((k) => sections[k] != null).map((k) => (
        <details
          key={k}
          id={`wiz-avanzate-${k}`}
          className="wizard-avanzate mb-3"
          open={aperte.has(k)}
          onToggle={(e) => {
            const aperta = e.currentTarget.open;
            setAperte((prima) => {
              if (prima.has(k) === aperta) return prima;
              const dopo = new Set(prima);
              if (aperta) dopo.add(k);
              else dopo.delete(k);
              return dopo;
            });
          }}
        >
          <summary>
            <h3 className="wizard-avanzate__titolo">{tf(`sections.${k}`)}</h3>
          </summary>
          <div className="wizard-avanzate__corpo">{sections[k]}</div>
        </details>
      ))}
    </div>
  );
}

/** L'informativa privacy (la vede chi si iscrive), quanto restano i dati
 *  delle persone, e se la pagina resta pubblica dopo l'evento. */
export function SezioneDati({
  form,
  onChange,
  gdprTemplates,
  fieldErrors = {},
  retentionMax = MAX_RETENTION_DAYS,
}: {
  form: WizardForm;
  onChange: (patch: Partial<WizardForm>) => void;
  gdprTemplates: Array<{ id: string; name: string; isDefault: boolean }>;
  fieldErrors?: Record<string, string>;
  retentionMax?: number;
}) {
  const t = useTranslations('admin.wizard.step5');
  const tPost = useTranslations('postEvent');
  return (
    <div className="row g-3">
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
            // Scegliere un modello azzera il testo scritto a mano: la pagina di
            // registrazione da' la precedenza al testo, e la casella che lo
            // contiene sparisce appena un modello e' scelto. Senza questo, il
            // testo continuerebbe a vincere su una scelta che si vede fatta e
            // non si puo' piu' disfare.
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
          <div className="invalid-feedback d-block">{t('gdprTemplateUnknown')}</div>
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
          <small className="form-text text-muted">{t('privacyTextHelp')}</small>
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
              dataRetentionDays: Number(e.target.value) || form.dataRetentionDays,
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
      {/* La pagina dell'evento concluso: il modello la decide (una riunione
          di lavoro non e' pubblica), qui si cambia. */}
      <div className="col-12">
        <ToggleSwitch
          label={tPost('pageVisible')}
          checked={form.postEventPublic}
          onChange={() => onChange({ postEventPublic: !form.postEventPublic })}
        />
        <small className="form-text text-muted d-block">{tPost('pageVisibleHelp')}</small>
      </div>
    </div>
  );
}

/** Capacita' e risorse: servono a chi dimensiona l'installazione. */
export function SezioneTecnica({
  form,
  onChange,
  jvbSizingConfig,
  defaultSenderRatioPct,
}: {
  form: WizardForm;
  onChange: (patch: Partial<WizardForm>) => void;
  jvbSizingConfig: JvbSizingConfig;
  defaultSenderRatioPct: number;
}) {
  const t = useTranslations('admin.wizard.step5');
  const toggles = togglesFromMatrix(form.permissionMatrix);
  return (
    <>
      <section className="mb-4">
        <h4 className="h6 fw-semibold mb-2" style={{ color: 'var(--app-text)' }}>
          {t('capacityHeading')}
        </h4>
        <JvbCapacityPreview
          maxParticipants={form.maxParticipants}
          senderRatioPct={form.expectedSenderRatioPct}
          onSenderRatioChange={(next) => onChange({ expectedSenderRatioPct: next })}
          videoEnabled={toggles.participantsCanStartVideo}
          defaultSenderRatioPct={defaultSenderRatioPct}
          sizingConfig={jvbSizingConfig}
        />
      </section>
      <section className="mb-1">
        <h4 className="h6 fw-semibold mb-2" style={{ color: 'var(--app-text)' }}>
          {t('featuresHeading')}
        </h4>
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
    </>
  );
}

/** C'e' un avviso di capacita' (bridge al tetto, quota ereditata su un
 *  evento grande)? Il riepilogo lo dice, e porta ai dettagli tecnici. */
export function avvisoCapacita(
  form: WizardForm,
  jvbSizingConfig: JvbSizingConfig,
  defaultSenderRatioPct: number,
): boolean {
  const avvisi = capacityWarnings({
    maxParticipants: form.maxParticipants,
    senderRatioPct: form.expectedSenderRatioPct,
    videoEnabled: togglesFromMatrix(form.permissionMatrix).participantsCanStartVideo,
    defaultSenderRatioPct,
    sizingConfig: jvbSizingConfig,
  });
  return avvisi.atCeiling || avvisi.shouldWarnInherited;
}
