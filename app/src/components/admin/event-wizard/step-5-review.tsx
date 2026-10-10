'use client';

/**
 * Il riepilogo: in cima cio' che manca ancora per pubblicare (ogni voce porta
 * al suo campo), poi l'evento in un'anteprima sola, come lo vedranno gli
 * altri: quando, chi lo conduce, chi parla, le funzioni della sala, la
 * registrazione (con le lingue di traduzione, che si cambiano qui) e
 * l'informativa. Sotto, «Personalizza le impostazioni» apre le impostazioni
 * avanzate. I pulsanti per salvare li ha il wizard.
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import LanguageChecklist from '@/components/admin/language-checklist';
import { IconaMicrofono, IconaPersone, IconaRec } from '@/components/admin/guided-format';
import { Icon } from '@/components/ui/icon';
import { parseLocaleList } from '@/lib/ai/target-locales';
import { localeNames } from '@/i18n/config';
import { togglesFromMatrix } from '@/lib/utils/permission-matrix';
import { splitTitleKicker } from '@/lib/utils/title-kicker';
import { describeRRule } from '@/lib/utils/recurrence';

import type { CampoMancante } from './validation';
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
  defaultLocale: string;
  gdprTemplates: Array<{ id: string; name: string; isDefault: boolean }>;
  fieldErrors?: Record<string, string>;
  /** Apre le impostazioni avanzate (una sezione, se detta). */
  onCustomize?: (sezione?: 'technical') => void;
  /** Porta al campo che manca. */
  onVaiAlCampo?: (campo: CampoMancante) => void;
  /** Cio' che manca ancora, nell'ordine del wizard. */
  mancanti?: CampoMancante[];
  /** La post-produzione AI e' accesa sull'installazione. */
  aiPipelineEnabled?: boolean;
  /** I sottotitoli live ci sono nell'installazione. */
  liveCaptionsAvailable?: boolean;
  /** La lingua dell'evento: non si offre come lingua di traduzione. */
  eventLocale?: string;
  /** C'e' un avviso di capacita': lo si dice, e porta alle impostazioni. */
  capacityWarning?: boolean;
  /** La parte del titolo prima di «|» si mostra come sopratitolo. */
  sopratitolo?: boolean;
  /** Si iscrive chiunque (scelta dell'evento, o del sito). Assente per una
   *  chiamata istantanea, che non ha iscrizione. */
  iscrizioneAperta?: boolean;
  /** Porta al passo «Persone», dove si sceglie chi si iscrive. */
  onVaiPersone?: () => void;
}

/** I nomi di un elenco di persone. */
function nomi(persone: Array<{ name: string }>): string {
  return persone.map((p) => p.name).join(', ');
}

export default function Step5Review({
  form,
  onChange,
  defaultLocale,
  gdprTemplates,
  fieldErrors = {},
  onCustomize,
  onVaiAlCampo,
  mancanti = [],
  aiPipelineEnabled = true,
  liveCaptionsAvailable = false,
  eventLocale,
  capacityWarning = false,
  sopratitolo = false,
  iscrizioneAperta,
  onVaiPersone,
}: Props) {
  const t = useTranslations('admin.wizard.step5');
  const tf = useTranslations('admin.wizard.flow');
  const tp = useTranslations('admin.wizard.step2');
  const tForm = useTranslations('admin.form');
  const toggles = togglesFromMatrix(form.permissionMatrix);
  const senzaInvitati = iscrizioneAperta === false && form.invitations.length === 0;
  // Cosa si chiede a chi si iscrive: nome ed email sempre, il resto se scelto.
  const chiesti = [
    tf('askName'),
    tf('askEmail'),
    ...(form.requireOrganization ? [tf('askOrganization')] : []),
    ...(form.requireOrganizationRole ? [tf('askRole')] : []),
    ...(form.requireOrganizationType ? [tf('askType')] : []),
  ];
  const titolo = splitTitleKicker(
    form.title[defaultLocale] || form.title.it || form.title.en || '',
    sopratitolo
  );
  const locale: 'it' | 'en' = defaultLocale === 'it' ? 'it' : 'en';
  // Le lingue si cambiano sul posto, a richiesta: l'anteprima resta
  // un'anteprima. Si aprono da sole quando non ce n'e' nessuna (servono per
  // tradurre) o quando un invio le segnala, e restano aperte finche' le si
  // sceglie: chiuderle sotto il cursore alla prima spunta toglierebbe la
  // seconda.
  const [lingueAperte, setLingueAperte] = useState(false);
  useEffect(() => {
    if (fieldErrors.aiTargetLocales) setLingueAperte(true);
  }, [fieldErrors.aiTargetLocales]);

  const ricorrenza =
    form.recurrenceRule && form.recurrencePreset !== 'none'
      ? describeRRule(form.recurrenceRule, locale)
      : null;

  // Chi parla e si mostra: tutti, solo chi conduce e interviene, o un misto.
  const perPartecipanti: Array<[boolean, string]> = [
    [toggles.participantsCanUnmute, tp('feature.mic.label')],
    [toggles.participantsCanStartVideo, tp('feature.video.label')],
    [toggles.participantsCanShareScreen, tp('feature.share.label')],
  ];
  const voce = perPartecipanti.every(([on]) => on)
    ? tf('voiceAll')
    : perPartecipanti.every(([on]) => !on)
      ? tf('voiceSpeakers')
      : tf('participantsCan', {
          list: perPartecipanti
            .filter(([on]) => on)
            .map(([, l]) => l)
            .join(', '),
        });
  const funzioni = [
    toggles.chatEnabled && tp('feature.chat.label'),
    toggles.qaEnabled && tp('feature.qa.label'),
    form.agendaEnabled && tForm('agendaEnabled'),
    form.wordCloudEnabled && tForm('wordCloudEnabled'),
    form.whiteboardEnabled && tForm('whiteboardEnabled'),
    liveCaptionsAvailable && form.liveCaptionsEnabled && tForm('liveCaptionsEnabled'),
  ].filter((x): x is string => !!x);
  const traduce =
    form.recordingEnabled && form.aiTranscriptEnabled && form.aiTranslationEnabled;
  const funzioniAi = [
    tForm('aiTranscriptEnabled'),
    form.aiSummaryEnabled && tForm('aiSummaryEnabled'),
    traduce && tForm('aiTranslationEnabled'),
    traduce && form.aiDubbingEnabled && tForm('aiDubbingEnabled'),
  ].filter((x): x is string => !!x);
  const lingue = parseLocaleList(form.aiTargetLocales).map(
    (c) => (localeNames as Record<string, string>)[c] ?? c
  );
  const mostraLingue = traduce && (lingueAperte || lingue.length === 0);
  const informativa = form.gdprTemplateId
    ? tf('privacyTemplate', {
        name: gdprTemplates.find((g) => g.id === form.gdprTemplateId)?.name ?? '—',
      })
    : form.privacyPolicyText?.trim()
      ? tf('privacyCustom')
      : form.privacyPolicyUrl
        ? tf('privacyDocument')
        : tf('privacySite');

  // L'etichetta di un campo che manca, per l'elenco «manca ancora».
  const etichettaCampo = (key: string): string => {
    const campo = key.split('.')[0];
    switch (campo) {
      case 'title':
        return tForm('titleLabel');
      case 'description':
        return tForm('descriptionLabel');
      case 'startsAt':
        return tForm('startsAt');
      case 'endsAt':
        return tForm('endsAt');
      case 'maxParticipants':
        return tForm('expectedParticipants');
      case 'moderatorName':
        return tf('fieldOrganizerName');
      case 'moderatorEmail':
        return tf('fieldOrganizerEmail');
      case 'aiTargetLocales':
        return tForm('aiTargetLocales');
      case 'dataRetentionDays':
        return t('retentionDays');
      case 'gdprTemplateId':
        return t('gdprTemplate');
      default:
        return campo ?? key;
    }
  };

  const organizzatore = form.moderatorName?.trim();

  return (
    <div>
      <h2 className="h4 fw-bold mb-3" style={{ color: 'var(--app-text)' }}>
        {t('heading')}
      </h2>
      <p className="text-secondary mb-4" style={{ fontSize: '0.9rem' }}>
        {t('intro')}
      </p>

      {/* Che cosa manca, prima di premere «Pubblica»: ogni voce porta al
          campo. */}
      {mancanti.length > 0 && (
        <section className="wizard-mancanti mb-4" aria-labelledby="rev-mancanti-titolo">
          <h3 id="rev-mancanti-titolo" className="wizard-mancanti__titolo">
            <Icon icon="it-warning-circle" size="sm" className="me-1" />
            {tf('missingHeading')}
          </h3>
          <ul className="wizard-mancanti__elenco">
            {mancanti.map((m) => (
              <li key={`${m.step}-${m.key}`}>
                <button
                  type="button"
                  className="btn btn-link p-0 align-baseline"
                  onClick={() => onVaiAlCampo?.(m)}
                >
                  {etichettaCampo(m.key)}
                </button>{' '}
                <span className="text-secondary">— {tf(`steps.${m.step}`)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* L'evento, come lo vedranno gli altri. */}
      <section className="anteprima-evento mb-3" aria-labelledby="rev-anteprima-titolo">
        <h3 id="rev-anteprima-titolo" className="anteprima-evento__titolo">
          {titolo.kicker && <span className="event-title-kicker">{titolo.kicker}</span>}
          {titolo.main || tf('untitled')}
        </h3>
        <ul className="anteprima-righe">
          <li>
            <span className="anteprima-righe__icona">
              <Icon icon="it-calendar" size="sm" />
            </span>
            <span>
              {formatWallClock(form.startsAt, locale)} →{' '}
              {formatWallClock(form.endsAt, locale)} ({form.timezone})
              {ricorrenza && <span className="d-block text-secondary">{ricorrenza}</span>}
            </span>
          </li>
          <li>
            <span className="anteprima-righe__icona">
              <IconaPersone />
            </span>
            <span>
              {t('summary.maxParticipants')}: {form.maxParticipants}
            </span>
          </li>
          <li>
            <span className="anteprima-righe__icona">
              <Icon icon="it-user" size="sm" />
            </span>
            <span>
              {organizzatore ? (
                <>
                  {t('summary.primaryOrganizer')}: {organizzatore}
                </>
              ) : (
                <span className="wizard-scheda__mancante fw-semibold">
                  {t('summary.primaryOrganizer')}: {t('summary.primaryMissing')}
                </span>
              )}
              {form.speakers.length > 0 && (
                <span className="d-block">
                  {t('summary.speakers')}: {nomi(form.speakers)}
                </span>
              )}
              {form.moderators.length > 0 && (
                <span className="d-block">
                  {t('summary.moderators')}: {nomi(form.moderators)}
                </span>
              )}
              {form.organizers.length > 0 && (
                <span className="d-block">
                  {t('summary.organizingEntities')}: {nomi(form.organizers)}
                </span>
              )}
            </span>
          </li>
          {iscrizioneAperta !== undefined && (
            <li>
              <span className="anteprima-righe__icona">
                <Icon icon={iscrizioneAperta ? 'it-unlocked' : 'it-mail'} size="sm" />
              </span>
              <span>
                {iscrizioneAperta ? (
                  tf('accessOpen')
                ) : (
                  <span
                    className={
                      senzaInvitati ? 'wizard-scheda__mancante fw-semibold' : undefined
                    }
                  >
                    {tf('accessInvitation', { count: form.invitations.length })}
                  </span>
                )}{' '}
                {onVaiPersone && (
                  <button
                    type="button"
                    className="btn btn-link p-0 align-baseline anteprima-link"
                    onClick={onVaiPersone}
                  >
                    {senzaInvitati ? tf('addInvitees') : tf('change')}
                  </button>
                )}
                <span className="d-block text-secondary">
                  {tf('askLine', { list: chiesti.join(', ') })}
                </span>
              </span>
            </li>
          )}
          <li>
            <span className="anteprima-righe__icona">
              <IconaMicrofono />
            </span>
            <span>{voce}</span>
          </li>
          <li>
            <span className="anteprima-righe__icona">
              <Icon icon="it-comment" size="sm" />
            </span>
            <span>
              <span className="anteprima-chip-elenco">
                {funzioni.length > 0
                  ? funzioni.map((f) => (
                      <span key={f} className="anteprima-chip">
                        {f}
                      </span>
                    ))
                  : tf('none')}
              </span>
              <span className="d-block text-secondary small mt-1">
                {tf('liveToggleNote')}
              </span>
            </span>
          </li>
          <li>
            <span className="anteprima-righe__icona">
              <IconaRec />
            </span>
            <span>
              {!form.recordingEnabled
                ? t('summary.recordingOff')
                : form.autoStartRecording
                  ? t('summary.recordingAuto')
                  : tf('recordingManual')}
              {form.recordingEnabled && form.aiTranscriptEnabled && (
                <span className="d-block">
                  {tf('aiAfter', { list: funzioniAi.join(', ') })}
                </span>
              )}
              {form.recordingEnabled &&
                !form.aiTranscriptEnabled &&
                !aiPipelineEnabled && (
                  <span className="d-block text-secondary">{tp('aiPipelineOff')}</span>
                )}
              {traduce && (
                <span className="d-block">
                  {tf('translationLine', { list: lingue.join(', ') || tf('none') })}{' '}
                  {/* Senza lingue l'elenco e' gia' aperto: niente da aprire. */}
                  {lingue.length > 0 && (
                    <button
                      type="button"
                      className="btn btn-link p-0 align-baseline anteprima-link"
                      aria-expanded={mostraLingue}
                      aria-controls={mostraLingue ? 'aiTargetLocales' : undefined}
                      onClick={() => setLingueAperte((v) => !v)}
                    >
                      {tf('changeLanguages')}
                    </button>
                  )}
                </span>
              )}
              {mostraLingue && (
                <span id="aiTargetLocales" className="d-block mt-2">
                  <LanguageChecklist
                    legend={tForm('aiTargetLocales')}
                    value={form.aiTargetLocales}
                    onChange={(next) => {
                      setLingueAperte(true);
                      onChange({ aiTargetLocales: next });
                    }}
                    invalid={!!fieldErrors.aiTargetLocales}
                    errorText={tForm('aiTargetLocalesRequired')}
                    exclude={eventLocale ? [eventLocale] : []}
                  />
                </span>
              )}
            </span>
          </li>
          <li>
            <span className="anteprima-righe__icona">
              <Icon icon="it-locked" size="sm" />
            </span>
            <span>{informativa}</span>
          </li>
        </ul>
        {capacityWarning && (
          <button
            type="button"
            className="btn btn-link p-0 anteprima-evento__avviso"
            onClick={() => onCustomize?.('technical')}
          >
            <Icon icon="it-warning-circle" size="sm" className="me-1" />
            {tf('capacityWarning')}
          </button>
        )}
      </section>

      {onCustomize && (
        <button
          type="button"
          className="btn btn-outline-primary d-inline-flex align-items-center gap-2"
          onClick={() => onCustomize()}
        >
          <Icon icon="it-settings" size="sm" color="primary" />
          {tf('customize')}
        </button>
      )}
    </div>
  );
}
