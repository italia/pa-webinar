'use client';

/**
 * Il riepilogo: in cima cio' che manca ancora per pubblicare (ogni voce porta
 * al suo campo), poi l'evento in un'anteprima sola, come lo vedranno gli
 * altri: quando, chi lo conduce, chi parla, le funzioni della sala, la
 * registrazione (con le lingue di traduzione, che si cambiano nel passo
 * «Evento») e l'informativa. Sotto, «Personalizza le impostazioni» apre le impostazioni
 * avanzate. I pulsanti per salvare li ha il wizard.
 */

import { useTranslations } from 'next-intl';

import { RigaCapacita, type RiepilogoCapacita } from '@/components/admin/capacity-panel';
import { IconaMicrofono, IconaPersone, IconaRec } from '@/components/admin/guided-format';
import { Icon } from '@/components/ui/icon';
import { useDurataTesto } from '@/hooks/use-durata-testo';
import { durataProgramma } from '@/lib/agenda/programme';
import { parseLocaleList } from '@/lib/ai/target-locales';
import { registraChiConduce } from '@/lib/live/entry-consents';
import { consensiRichiesti } from '@/lib/registration/consents';
import { togglesFromMatrix } from '@/lib/utils/permission-matrix';
import { splitTitleKicker } from '@/lib/utils/title-kicker';
import { describeRRule } from '@/lib/utils/recurrence';

import { vociCompilate } from './programme-plan';
import { nomeLingua } from './text-translation';
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
  /** L'installazione puo' registrare: senza, non si chiede il consenso. */
  recordingAvailable?: boolean;
  /** Chiamata rapida: nessuna iscrizione, e chi conduce non e' interpellato. */
  istantanea?: boolean;
  aiPipelineEnabled?: boolean;
  /** I sottotitoli live ci sono nell'installazione. */
  liveCaptionsAvailable?: boolean;
  /** La capacita' in una riga: il carico del ponte e quanto riceve chi guarda;
   *  da «attenzione» in su e' un avviso. Porta ai dettagli tecnici. */
  capacita?: RiepilogoCapacita;
  /** La parte del titolo prima di «|» si mostra come sopratitolo. */
  sopratitolo?: boolean;
  /** Si iscrive chiunque (scelta dell'evento, o del sito). Assente per una
   *  chiamata istantanea, che non ha iscrizione. */
  iscrizioneAperta?: boolean;
  /** Porta al passo «Persone», dove si sceglie chi si iscrive. */
  onVaiPersone?: () => void;
  /** Porta al passo «Programma». Assente per una chiamata istantanea, che
   *  non ha il passo: la riga del programma compare solo se ce n'e' uno. */
  onVaiProgramma?: () => void;
  /** Si sta creando l'evento: ad agenda spenta il programma non si salva. */
  programmaInCreazione?: boolean;
  /** Quante domande si fanno prima e dopo l'evento, sotto cio' che si chiede
   *  all'iscrizione. */
  questionari?: React.ReactNode;
}

/** I nomi di un elenco di persone. */
function nomi(persone: Array<{ name: string }>): string {
  return persone.map((p) => p.name).join(', ');
}

export default function Step5Review({
  form,
  defaultLocale,
  gdprTemplates,
  onCustomize,
  onVaiAlCampo,
  mancanti = [],
  aiPipelineEnabled = true,
  recordingAvailable = true,
  istantanea = false,
  liveCaptionsAvailable = false,
  capacita,
  sopratitolo = false,
  iscrizioneAperta,
  onVaiPersone,
  onVaiProgramma,
  programmaInCreazione = false,
  questionari,
}: Props) {
  const t = useTranslations('admin.wizard.step5');
  const tf = useTranslations('admin.wizard.flow');
  const tp = useTranslations('admin.wizard.step2');
  const tForm = useTranslations('admin.form');
  const tProgramma = useTranslations('admin.wizard.programme');
  const tTrad = useTranslations('admin.textTranslation');
  const durata = useDurataTesto();
  const toggles = togglesFromMatrix(form.permissionMatrix);
  // Il programma, ad agenda accesa: quanti argomenti e quanto dura. Spenta,
  // quelli preparati non compaiono (e in creazione non si salvano).
  const preparati = vociCompilate(form.agenda ?? []);
  const programma = form.agendaEnabled ? preparati : [];
  const durataDelProgramma = durataProgramma(programma);
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
    liveCaptionsAvailable &&
      form.liveCaptionsEnabled &&
      form.captionsTranscriptEnabled &&
      tForm('captionsTranscriptEnabled'),
  ].filter((x): x is string => !!x);
  // I consensi che modulo d'iscrizione e sala d'attesa chiederanno a chi
  // partecipa, con la stessa regola (lib/registration/consents): chi crea
  // l'evento vede prima cosa si chiedera', e se la scelta e' quella voluta.
  const registra = form.recordingEnabled && recordingAvailable;
  const consensi = consensiRichiesti({
    recordingEnabled: registra,
    multitrackRecordingEnabled: form.recordingEnabled && !!form.multitrackRecordingEnabled,
    captionsTranscript:
      liveCaptionsAvailable && form.liveCaptionsEnabled && !!form.captionsTranscriptEnabled,
    participantsCanUnmute: toggles.participantsCanUnmute,
    participantsCanStartVideo: toggles.participantsCanStartVideo,
    participantsCanShareScreen: toggles.participantsCanShareScreen,
    listenOnlyWithoutConsent: form.listenOnlyWithoutConsent,
  });
  const vociConsenso = [
    consensi.registrazione &&
      (consensi.registrazioneFacoltativa
        ? tf('consentRecordingFree')
        : tf('consentRecordingRequired')),
    consensi.avvisoRegistrazione && tf('consentRecordingNotice'),
    consensi.tracce && tf('consentTranscription'),
  ].filter((x): x is string => !!x);
  const traduce =
    form.recordingEnabled && form.aiTranscriptEnabled && form.aiTranslationEnabled;
  const funzioniAi = [
    tForm('aiTranscriptEnabled'),
    form.aiSummaryEnabled && tForm('aiSummaryEnabled'),
    traduce && tForm('aiTranslationEnabled'),
    traduce && form.aiDubbingEnabled && tForm('aiDubbingEnabled'),
  ].filter((x): x is string => !!x);
  const lingue = parseLocaleList(form.aiTargetLocales).map(nomeLingua);
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
        return tTrad('eventLanguages');
      case 'dataRetentionDays':
        return t('retentionDays');
      case 'gdprTemplateId':
        return t('gdprTemplate');
      case 'agenda':
        return tf('fieldProgrammeMinutes', { n: Number(key.split('.')[1] ?? 0) + 1 });
      default:
        return campo ?? key;
    }
  };

  const organizzatore = form.moderatorName?.trim();
  // Chi conduce col segno di organizzatore sta fra chi organizza, non fra i
  // moderatori: lo stesso ruolo che il passo «Persone» gli ha dato.
  const altriOrganizzatori = form.moderators.filter((m) => m.organizer);
  const moderatori = form.moderators.filter((m) => !m.organizer);

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
              {altriOrganizzatori.length > 0 && (
                <span className="d-block">
                  {t('summary.organizersPeople')}: {nomi(altriOrganizzatori)}
                </span>
              )}
              {moderatori.length > 0 && (
                <span className="d-block">
                  {t('summary.moderators')}: {nomi(moderatori)}
                </span>
              )}
              {form.speakers.length > 0 && (
                <span className="d-block">
                  {t('summary.speakers')}: {nomi(form.speakers)}
                </span>
              )}
              {form.organizers.length > 0 && (
                <span className="d-block">
                  {t('summary.organizingEntities')}: {nomi(form.organizers)}
                </span>
              )}
            </span>
          </li>
          {(onVaiProgramma || programma.length > 0) && (
            <li>
              <span className="anteprima-righe__icona">
                <Icon icon="it-list" size="sm" />
              </span>
              <span>
                {programma.length > 0
                  ? durataDelProgramma !== null
                    ? t('summary.programmeWithDuration', {
                        count: programma.length,
                        duration: durata(0, durataDelProgramma * 60_000),
                      })
                    : t('summary.programme', { count: programma.length })
                  : preparati.length > 0
                    ? tProgramma(programmaInCreazione ? 'reviewOffCreate' : 'reviewOff', {
                        count: preparati.length,
                      })
                    : tProgramma('reviewEmpty')}{' '}
                {onVaiProgramma && (
                  <button
                    type="button"
                    className="btn btn-link p-0 align-baseline anteprima-link"
                    onClick={onVaiProgramma}
                  >
                    {preparati.length > 0 ? tf('change') : tProgramma('reviewPrepare')}
                  </button>
                )}
              </span>
            </li>
          )}
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
                {questionari}
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
              {/* Le lingue sono quelle dell'evento: si cambiano nel passo
                  «Evento», dove fanno anche le schede di titolo e descrizione. */}
              {traduce && (
                <span className="d-block">
                  {tf('translationLine', { list: lingue.join(', ') || tf('none') })}
                  {onVaiAlCampo && (
                    <>
                      {' · '}
                      <button
                        type="button"
                        className="btn btn-link p-0 align-baseline anteprima-link"
                        onClick={() =>
                          onVaiAlCampo({ key: 'aiTargetLocales', step: 'base', perPubblicare: false })
                        }
                      >
                        {tTrad('changeInEventStep', { step: tf('steps.base') })}
                      </button>
                    </>
                  )}
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
          <li>
            <span className="anteprima-righe__icona">
              <Icon icon="it-check-circle" size="sm" />
            </span>
            <span>
              {vociConsenso.length > 0
                ? tf('consentsLine', { list: vociConsenso.join(' · ') })
                : tf('consentsNone')}
              {registraChiConduce({ recordingEnabled: form.recordingEnabled, eventType: istantanea ? 'INSTANT' : null }, recordingAvailable) && (
                <span className="d-block text-secondary small mt-1">{tf('consentsHosts')}</span>
              )}
              {(consensi.registrazione || consensi.tracce) && (
                <span className="d-block text-secondary small">{tf('consentsWithdraw')}</span>
              )}
            </span>
          </li>
        </ul>
        {capacita && (
          <RigaCapacita
            capacita={capacita}
            onDettagli={onCustomize && (() => onCustomize('technical'))}
          />
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
