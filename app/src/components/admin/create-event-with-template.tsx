'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { useRouter, percorso } from '@/i18n/navigation';
import GuidedFormat from '@/components/admin/guided-format';
import TemplatePicker from '@/components/admin/template-picker';
import {
  FORMATO_PREDEFINITO,
  codificaFormato,
  decodificaFormato,
  presetDaFormato,
  type FormatoGuidato,
} from '@/lib/events/guided-format';
import EventWizard from '@/components/admin/event-wizard/wizard-shell';
import type { PermissionMatrix } from '@/lib/utils/permission-matrix';
import CreateInstantCall from '@/components/admin/create-instant-call';
import type { CapacitaIstanza } from '@/lib/capacity/model';
import type { VideoQualityPreset } from '@/lib/jitsi/config';

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
  agendaEnabled?: boolean;
  wordCloudEnabled?: boolean;
  whiteboardEnabled?: boolean;
  liveCaptionsEnabled?: boolean;
  waitingRoomEngine?: 'GARDEN' | 'GAME' | 'CLASSIC' | null;
  participantsCanUnmute: boolean;
  participantsCanStartVideo: boolean;
  participantsCanShareScreen: boolean;
  maxParticipants: number;
  permissionMatrix?: PermissionMatrix | null;
  defaultDurationMinutes?: number | null;
  aiTranscriptEnabled?: boolean;
  aiSummaryEnabled?: boolean;
  aiTranslationEnabled?: boolean;
  aiDubbingEnabled?: boolean;
  multitrackRecordingEnabled?: boolean;
  retainParticipantTracks?: boolean;
  aiTargetLocales?: string | null;
  descriptionTemplate?: Record<string, string> | null;
  defaultRetentionDays?: number | null;
  defaultExpectedSpeakers?: number | null;
}

interface Props {
  templates: TemplateSummary[];
  selectedTemplate: TemplatePreset | null;
  siteTimezone: string;
  enabledLocales: string[];
  defaultLocale: string;
  defaultRetentionDays: number;
  canUseRubrica: boolean;
  /** Si creano categorie nuove dal wizard: solo l'amministrazione. */
  canManageTags?: boolean;
  /** L'istanza per la stima della capacita'. */
  capacita: CapacitaIstanza;
  availableTags: Array<{ slug: string; name: Record<string, string>; color: string | null }>;
  gdprTemplates: Array<{ id: string; name: string; isDefault: boolean }>;
  siteDefaultParseTitleKicker: boolean;
  siteDefaultVideoQuality: VideoQualityPreset;
  whiteboardInfraReady: boolean;
  /** I sottotitoli live ci sono nell'installazione (lib/captions/availability). */
  liveCaptionsAvailable?: boolean;
  defaultTargetLocales?: string | null;
  /** La post-produzione AI e' accesa sull'installazione. */
  aiPipelineEnabled?: boolean;
  /** La traduzione automatica di titolo e descrizione c'e' (vedi il wizard). */
  textTranslationAvailable?: boolean;
  defaultModerator?: { name: string; email: string } | null;
  /** L'iscrizione pubblica dell'installazione: vedi il passo «Persone». */
  publicRegistrationEnabled?: boolean;
  /** Apre direttamente il modulo della chiamata rapida (dal pulsante della
   *  lista eventi), senza passare dalla scelta del modello. */
  initialInstant?: boolean;
  /** `?formato=`: le quattro risposte, che aprono il wizard con i loro valori. */
  formatoParam?: string | null;
  /** `?scegli=`: si torna alle quattro domande con queste risposte gia' date. */
  scegliParam?: string | null;
}

export default function CreateEventWithTemplate({
  templates,
  selectedTemplate,
  siteTimezone,
  enabledLocales,
  defaultLocale,
  defaultRetentionDays,
  canUseRubrica,
  canManageTags = false,
  capacita,
  availableTags,
  gdprTemplates,
  siteDefaultParseTitleKicker,
  siteDefaultVideoQuality,
  whiteboardInfraReady,
  liveCaptionsAvailable = false,
  defaultTargetLocales = null,
  aiPipelineEnabled = true,
  textTranslationAvailable = false,
  defaultModerator = null,
  publicRegistrationEnabled = true,
  initialInstant = false,
  formatoParam = null,
  scegliParam = null,
}: Props) {
  const t = useTranslations('admin.templates');
  const tg = useTranslations('admin.guided');
  const ti = useTranslations('admin.instantCall');
  const router = useRouter();
  const [showInstant, setShowInstant] = useState(initialInstant);
  // Le quattro risposte nell'indirizzo: aprono il wizard con i loro valori.
  const formato: FormatoGuidato | null = selectedTemplate ? null : decodificaFormato(formatoParam);

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

  const wizard = (props: {
    template: React.ComponentProps<typeof EventWizard>['template'];
    formatoLabel?: string;
    onChangeTemplate: (stato: { invitati: boolean }) => void;
  }) => (
    <EventWizard
      // Un formato o un modello diverso e' un modulo nuovo: i valori di
      // partenza non restano quelli del precedente.
      key={props.template?.id ?? 'vuoto'}
      template={props.template}
      formatoLabel={props.formatoLabel}
      onChangeTemplate={props.onChangeTemplate}
      siteTimezone={siteTimezone}
      enabledLocales={enabledLocales}
      defaultLocale={defaultLocale}
      defaultRetentionDays={defaultRetentionDays}
      canUseRubrica={canUseRubrica}
      canManageTags={canManageTags}
      capacita={capacita}
      availableTags={availableTags}
      gdprTemplates={gdprTemplates}
      siteDefaultParseTitleKicker={siteDefaultParseTitleKicker}
      siteDefaultVideoQuality={siteDefaultVideoQuality}
      whiteboardInfraReady={whiteboardInfraReady}
      liveCaptionsAvailable={liveCaptionsAvailable}
      defaultTargetLocales={defaultTargetLocales}
      aiPipelineEnabled={aiPipelineEnabled}
      textTranslationAvailable={textTranslationAvailable}
      defaultModerator={defaultModerator}
      publicRegistrationEnabled={publicRegistrationEnabled}
    />
  );

  // Un modello: si torna alle quattro domande per cambiarlo.
  if (selectedTemplate) {
    return wizard({
      template: selectedTemplate,
      // Le domande ripartono dai loro valori, ma con chi partecipa come lo si
      // vede ora: una scelta «solo su invito» non si perde cambiando modello.
      onChangeTemplate: ({ invitati }) =>
        router.push(
          percorso(
            invitati
              ? `/admin/events/new?scegli=${codificaFormato({ ...FORMATO_PREDEFINITO, accesso: 'invitati' })}`
              : '/admin/events/new',
          ),
        ),
    });
  }

  // Le quattro risposte: il wizard parte dai loro valori, e «Cambia formato»
  // riporta alle domande con le risposte gia' date.
  if (formato) {
    const nome = [
      tg(`summary.${formato.persone}`),
      tg(`summary.${formato.voce}`),
      tg(`summary.${formato.registra}`),
      tg(formato.accesso === 'invitati' ? 'summary.inviteOnly' : 'summary.openAccess'),
    ].join(' · ');
    return wizard({
      template: presetDaFormato(formato, nome, publicRegistrationEnabled),
      formatoLabel: nome,
      // Chi partecipa come lo si vede ora: cambiato nel passo «Persone», le
      // domande lo mostrano cosi'.
      onChangeTemplate: ({ invitati }) =>
        router.push(
          percorso(
            `/admin/events/new?scegli=${codificaFormato({ ...formato, accesso: invitati ? 'invitati' : 'tutti' })}`,
          ),
        ),
    });
  }

  return (
    <div>
        <GuidedFormat
          initial={decodificaFormato(scegliParam)}
          accessoPredefinito={publicRegistrationEnabled ? 'tutti' : 'invitati'}
          aiPipelineEnabled={aiPipelineEnabled}
          liveCaptionsAvailable={liveCaptionsAvailable}
          onContinue={(f) => router.push(percorso(`/admin/events/new?formato=${codificaFormato(f)}`))}
        >
          {templates.length > 0 && (
            <details className="formato-modelli">
              <summary>{tg('useTemplate')}</summary>
              <div className="pt-3">
                <TemplatePicker
                  showSubtitle={false}
                  templates={templates}
                  onSelect={(tpl) => {
                    router.push(percorso(`/admin/events/new?template=${tpl.id}`));
                  }}
                />
              </div>
            </details>
          )}
          {/* La videochiamata al volo e' un'alternativa, non lo scopo della
              pagina: sta in fondo, accanto ai modelli, senza colori suoi. */}
          <div className="formato-alternativa">
            <span className="formato-alternativa__testo">
              <span className="formato-alternativa__titolo">{tg('instantAlt')}</span>
              <span className="formato-alternativa__desc">{ti('subtitle')}</span>
            </span>
            <button
              type="button"
              className="btn btn-outline-primary btn-sm"
              onClick={() => setShowInstant(true)}
            >
              {tg('instantAltAction')}
            </button>
          </div>
        </GuidedFormat>
    </div>
  );
}
