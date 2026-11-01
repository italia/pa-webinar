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
  recordingAvailable?: boolean;
  defaultTargetLocales?: string | null;
  /** La post-produzione AI e' accesa sull'installazione. */
  aiPipelineEnabled?: boolean;
  /** La traduzione automatica di titolo e descrizione c'e' (vedi il wizard). */
  textTranslationAvailable?: boolean;
  /** Chi crea l'evento amministra l'istanza (vedi il wizard). */
  isSiteAdmin?: boolean;
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
  recordingAvailable = true,
  defaultTargetLocales = null,
  aiPipelineEnabled = true,
  textTranslationAvailable = false,
  isSiteAdmin = false,
  defaultModerator = null,
  publicRegistrationEnabled = true,
  initialInstant = false,
  formatoParam = null,
  scegliParam = null,
}: Props) {
  const tg = useTranslations('admin.guided');
  const router = useRouter();
  const [showInstant, setShowInstant] = useState(initialInstant);
  const [modelliAperti, setModelliAperti] = useState(false);
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
          ← {tg('instantBack')}
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
      recordingAvailable={recordingAvailable}
      defaultTargetLocales={defaultTargetLocales}
      aiPipelineEnabled={aiPipelineEnabled}
      textTranslationAvailable={textTranslationAvailable}
      isSiteAdmin={isSiteAdmin}
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
          // Il modello si sceglie prima di rispondere, non dopo: un'azione
          // accanto al titolo. La videochiamata istantanea non sta qui: ha il
          // suo pulsante nell'elenco degli eventi.
          azioneTitolo={
            templates.length > 0 ? (
              <button
                type="button"
                className="btn btn-outline-primary btn-sm"
                aria-expanded={modelliAperti}
                aria-controls="formato-modelli"
                onClick={() => setModelliAperti((v) => !v)}
              >
                {tg('useTemplate')}
              </button>
            ) : undefined
          }
        >
          {templates.length > 0 && (
            <div id="formato-modelli" className="formato-modelli" hidden={!modelliAperti}>
              <p className="text-secondary small mb-3">{tg('templateReplaces')}</p>
              <TemplatePicker
                showSubtitle={false}
                templates={templates}
                onSelect={(tpl) => {
                  router.push(percorso(`/admin/events/new?template=${tpl.id}`));
                }}
              />
            </div>
          )}
        </GuidedFormat>
    </div>
  );
}
