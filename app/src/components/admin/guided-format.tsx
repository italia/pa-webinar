'use client';

/**
 * La prima pagina di un evento nuovo: quattro domande (quante persone, chi
 * parla e si mostra in video, se registrare, chi puo' partecipare) e, accanto,
 * l'evento che ne viene.
 * «Continua» apre il wizard con quei valori di partenza
 * (lib/events/guided-format). I modelli salvati restano sotto, per
 * chi li usa.
 */

import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';

import { pulisciTraslocoScaduto } from '@/components/admin/event-wizard/drafts';
import { Icon } from '@/components/ui/icon';
import {
  FORMATO_PREDEFINITO,
  PARTECIPANTI_ATTESI,
  type FormatoAccesso,
  type FormatoGuidato,
} from '@/lib/events/guided-format';

/** Una persona, due persone: chi partecipa (SVG: lo sprite non ha l'icona). */
export function IconaPersone() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

/** Il microfono: chi parla (SVG: lo sprite non ha l'icona). */
export function IconaMicrofono() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="17" x2="12" y2="22" />
    </svg>
  );
}

/** Il pallino della registrazione. */
export function IconaRec() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="4.5" fill="currentColor" />
    </svg>
  );
}

/** Una risposta a scelta singola, a riquadro con icona. */
export function Scelta<T extends string>({
  name,
  value,
  current,
  onChange,
  title,
  desc,
  icon,
  disabled = false,
}: {
  name: string;
  value: T;
  current: T;
  onChange: (v: T) => void;
  title: string;
  desc?: string;
  icon: React.ReactNode;
  /** Si vede, ma non si cambia. */
  disabled?: boolean;
}) {
  const id = `${name}-${value}`;
  const scelta = value === current;
  return (
    <label
      htmlFor={id}
      className={`formato-scelta${scelta ? ' formato-scelta--attiva' : ''}${
        disabled ? ' formato-scelta--bloccata' : ''
      }`}
    >
      <input
        id={id}
        type="radio"
        name={name}
        value={value}
        checked={scelta}
        disabled={disabled}
        onChange={() => onChange(value)}
        // Gia' scelta solo in apparenza (una scelta ereditata, che si mostra
        // ma non e' salvata): un clic la conferma.
        onClick={scelta ? () => onChange(value) : undefined}
        className="visually-hidden"
      />
      <span className="formato-scelta__icona">{icon}</span>
      <span className="formato-scelta__testo">
        <span className="formato-scelta__titolo">{title}</span>
        {desc && <span className="formato-scelta__desc">{desc}</span>}
      </span>
      {scelta && (
        <span className="formato-scelta__segno" aria-hidden="true">
          <Icon icon="it-check" size="sm" />
        </span>
      )}
    </label>
  );
}

export default function GuidedFormat({
  initial,
  onContinue,
  aiPipelineEnabled = true,
  accessoPredefinito = 'tutti',
  children,
}: {
  initial?: FormatoGuidato | null;
  /** La risposta proposta a «chi puo' partecipare»: quella del sito. */
  accessoPredefinito?: FormatoAccesso;
  onContinue: (f: FormatoGuidato) => void;
  /** Con la post-produzione AI spenta, la registrazione non promette
   *  trascrizione e sintesi. */
  aiPipelineEnabled?: boolean;
  /** Sotto le domande: i modelli salvati. */
  children?: React.ReactNode;
}) {
  const t = useTranslations('admin.guided');
  const tf = useTranslations('admin.wizard.flow');
  const tForm = useTranslations('admin.form');
  const tp = useTranslations('admin.wizard.step2');
  const base = useId();
  const [f, setF] = useState<FormatoGuidato>(
    initial ?? { ...FORMATO_PREDEFINITO, accesso: accessoPredefinito },
  );
  // I dati di «Cambia formato» rimasti nel browser oltre il loro tempo se ne
  // vanno anche se il wizard non si riapre.
  useEffect(() => pulisciTraslocoScaduto(), []);
  const cambia = (patch: Partial<FormatoGuidato>) =>
    setF((prima) => ({ ...prima, ...patch }));

  const funzioni = [
    tp('feature.chat.label'),
    tp('feature.qa.label'),
    tForm('agendaEnabled'),
    tForm('wordCloudEnabled'),
  ];

  return (
    <div>
      {/* Domande e anteprima in una griglia loro: l'anteprima resta agganciata
        mentre si scorre le domande, non sopra i modelli che seguono. */}
      <div className="formato">
        <div className="formato__domande">
          <h2 className="h4 fw-bold mb-2" style={{ color: 'var(--app-text)' }}>
            {t('title')}
          </h2>
          <p className="text-secondary mb-4" style={{ fontSize: '0.9rem' }}>
            {t('intro')}
          </p>

          <fieldset className="formato__domanda">
            <legend>{t('peopleQ')}</legend>
            <div className="formato__scelte formato__scelte--tre">
              {(['piccolo', 'medio', 'grande'] as const).map((v) => (
                <Scelta
                  key={v}
                  name={`${base}-persone`}
                  value={v}
                  current={f.persone}
                  onChange={(persone) => cambia({ persone })}
                  title={t(`people.${v}`)}
                  icon={<IconaPersone />}
                />
              ))}
            </div>
            <p className="formato__nota">{t('peopleHint')}</p>
          </fieldset>

          <fieldset className="formato__domanda">
            <legend>{t('voiceQ')}</legend>
            <div className="formato__scelte">
              <Scelta
                name={`${base}-voce`}
                value="tutti"
                current={f.voce}
                onChange={(voce) => cambia({ voce })}
                title={t('voice.all')}
                desc={t('voice.allDesc')}
                icon={<Icon icon="it-video" size="sm" />}
              />
              <Scelta
                name={`${base}-voce`}
                value="relatori"
                current={f.voce}
                onChange={(voce) => cambia({ voce })}
                title={t('voice.speakers')}
                desc={t('voice.speakersDesc')}
                icon={<Icon icon="it-presentation" size="sm" />}
              />
            </div>
          </fieldset>

          <fieldset className="formato__domanda">
            <legend>{t('recQ')}</legend>
            <div className="formato__scelte">
              <Scelta
                name={`${base}-registra`}
                value="si"
                current={f.registra}
                onChange={(registra) => cambia({ registra })}
                title={t('rec.yes')}
                desc={aiPipelineEnabled ? t('rec.yesDesc') : undefined}
                icon={<IconaRec />}
              />
              <Scelta
                name={`${base}-registra`}
                value="no"
                current={f.registra}
                onChange={(registra) => cambia({ registra })}
                title={t('rec.no')}
                desc={t('rec.noDesc')}
                icon={<Icon icon="it-close-circle" size="sm" />}
              />
            </div>
          </fieldset>

          <fieldset className="formato__domanda">
            <legend>{t('accessQ')}</legend>
            <div className="formato__scelte">
              <Scelta
                name={`${base}-accesso`}
                value="tutti"
                current={f.accesso}
                onChange={(accesso) => cambia({ accesso })}
                title={t('access.open')}
                desc={t('access.openDesc')}
                icon={<Icon icon="it-unlocked" size="sm" />}
              />
              <Scelta
                name={`${base}-accesso`}
                value="invitati"
                current={f.accesso}
                onChange={(accesso) => cambia({ accesso })}
                title={t('access.invitation')}
                desc={t('access.invitationDesc')}
                icon={<Icon icon="it-mail" size="sm" />}
              />
            </div>
          </fieldset>
        </div>

        {/* L'evento che viene dalle risposte: si aggiorna mentre si sceglie. */}
        <aside
          className="formato__anteprima"
          aria-live="polite"
          aria-labelledby={`${base}-anteprima`}
        >
          <h3 id={`${base}-anteprima`} className="formato__anteprima-titolo">
            {t('preview')}
          </h3>
          <ul className="anteprima-righe">
            <li>
              <span className="anteprima-righe__icona">
                <IconaPersone />
              </span>
              <span>{t('previewPeople', { count: PARTECIPANTI_ATTESI[f.persone] })}</span>
            </li>
            <li>
              <span className="anteprima-righe__icona">
                <IconaMicrofono />
              </span>
              <span>{f.voce === 'tutti' ? tf('voiceAll') : tf('voiceSpeakers')}</span>
            </li>
            <li>
              <span className="anteprima-righe__icona">
                <Icon icon="it-comment" size="sm" />
              </span>
              <span>{tf('features', { list: funzioni.join(', ') })}</span>
            </li>
            <li>
              <span className="anteprima-righe__icona">
                <IconaRec />
              </span>
              <span>
                {f.registra === 'si' ? tf('recordingManual') : t('rec.noDesc')}
                {f.registra === 'si' && aiPipelineEnabled && (
                  <span className="d-block text-secondary">{t('rec.yesDesc')}</span>
                )}
              </span>
            </li>
            <li>
              <span className="anteprima-righe__icona">
                <Icon icon={f.accesso === 'invitati' ? 'it-mail' : 'it-unlocked'} size="sm" />
              </span>
              <span>{f.accesso === 'invitati' ? t('previewInvitation') : tf('accessOpen')}</span>
            </li>
          </ul>
          <p className="formato__nota mb-3">{tf('liveToggleNote')}</p>
          <button
            type="button"
            className="btn btn-primary w-100"
            onClick={() => onContinue(f)}
          >
            {t('continue')} →
          </button>
        </aside>
      </div>

      {children && <div className="formato__modelli mt-4">{children}</div>}
    </div>
  );
}
