'use client';

import { useTranslations } from 'next-intl';

import { localeDisplayName as locName } from '@/lib/utils/locale-display';

/**
 * Le lingue in cui si puo' guardare la registrazione, sotto il video: per
 * ognuna cosa c'e' (sottotitoli, audio doppiato, sintesi), cosi' chi guarda
 * le vede senza aprire i menu del lettore. Scegliere una lingua accende i
 * sottotitoli in quella lingua e porta la sintesi con se'; l'audio doppiato
 * si sceglie a parte, perche' e' una voce sintetica.
 */
export interface LanguageBarProps {
  /** La lingua in cui si e' parlato. */
  sourceLanguage: string;
  subtitleLanguages: string[];
  /** Le lingue con l'audio doppiato. */
  audioLanguages: string[];
  summaryLanguages: string[];
  /** La lingua della pagina, per i nomi delle lingue. */
  locale: string;
  language: string;
  onLanguageChange: (lang: string) => void;
  subtitlesOn: boolean;
  onSubtitlesChange: (on: boolean) => void;
  /** 'original' o la lingua del doppiaggio in ascolto. */
  audio: string;
  onAudioChange: (lang: string) => void;
}

export default function LanguageBar({
  sourceLanguage,
  subtitleLanguages,
  audioLanguages,
  summaryLanguages,
  locale,
  language,
  onLanguageChange,
  subtitlesOn,
  onSubtitlesChange,
  audio,
  onAudioChange,
}: LanguageBarProps) {
  const t = useTranslations('postEvent.languages');
  // Il nome della lingua come si scrive a inizio di voce («Italiano»).
  const nome = (l: string) => {
    const n = locName(l, locale);
    return n.charAt(0).toLocaleUpperCase(locale) + n.slice(1);
  };
  const lingue = [
    sourceLanguage,
    ...[...new Set([...subtitleLanguages, ...audioLanguages, ...summaryLanguages])]
      .filter((l) => l !== sourceLanguage)
      .sort((a, b) => nome(a).localeCompare(nome(b), locale)),
  ];
  if (lingue.length < 2 && subtitleLanguages.length === 0) return null;

  const cosaC_e = (l: string) =>
    [
      l === sourceLanguage ? t('original') : null,
      subtitleLanguages.includes(l) ? t('subtitles') : null,
      audioLanguages.includes(l) && l !== sourceLanguage ? t('dubbedAudio') : null,
      summaryLanguages.includes(l) ? t('summary') : null,
    ].filter((x): x is string => !!x);

  return (
    <section className="language-bar mt-2 mb-3" aria-labelledby="language-bar-title">
      <h2 id="language-bar-title" className="language-bar__title">
        {t('title')}
      </h2>
      <div
        className="language-bar__lingue"
        role="group"
        aria-labelledby="language-bar-title"
      >
        {lingue.map((l) => (
          <button
            key={l}
            type="button"
            className={`language-bar__lingua${l === language ? ' is-active' : ''}`}
            aria-pressed={l === language}
            onClick={() => onLanguageChange(l)}
          >
            <span className="language-bar__nome">{nome(l)}</span>
            <span className="language-bar__cosa">{cosaC_e(l).join(' · ')}</span>
          </button>
        ))}
      </div>
      <div className="language-bar__opzioni">
        {subtitleLanguages.includes(language) && (
          <label className="language-bar__interruttore">
            <input
              type="checkbox"
              checked={subtitlesOn}
              onChange={(e) => onSubtitlesChange(e.target.checked)}
            />
            <span>{t('showSubtitles', { language: nome(language) })}</span>
          </label>
        )}
        {language !== sourceLanguage && audioLanguages.includes(language) && (
          <div className="language-bar__audio" role="group" aria-label={t('audioLabel')}>
            <span>{t('audioLabel')}</span>
            <button
              type="button"
              className={`language-bar__scelta${audio === 'original' ? ' is-active' : ''}`}
              aria-pressed={audio === 'original'}
              onClick={() => onAudioChange('original')}
            >
              {t('audioOriginal', { language: nome(sourceLanguage) })}
            </button>
            <button
              type="button"
              className={`language-bar__scelta${audio === language ? ' is-active' : ''}`}
              aria-pressed={audio === language}
              onClick={() => onAudioChange(language)}
            >
              {t('audioDubbed', { language: nome(language) })}
            </button>
          </div>
        )}
        {!summaryLanguages.includes(language) && summaryLanguages.length > 0 && (
          <span className="text-secondary">
            {t('summaryNotAvailable', { language: nome(language) })}
          </span>
        )}
      </div>
    </section>
  );
}
