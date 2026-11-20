// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

'use client';

/**
 * Step 1 — Base event info.
 *
 * Owns: title & description (multilingual), cover image, schedule (start/end +
 * timezone), expected max participants, tags, recurrence, and optional
 * waiting-room audio. No submit logic lives here — the parent wizard shell
 * collects the full form and POSTs on review.
 */

import { useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

import LocaleTabBar, { type StatoScheda as AspettoScheda } from '@/components/ui/locale-tab-bar';
import { MarkdownEditor } from '@/components/ui/markdown';
import FileOrUrlInput from '@/components/ui/file-or-url-input';
import RecurrencePicker from '@/components/admin/recurrence-picker';
import {
  rebuildForNewStart,
  type RecurrencePreset,
  type RecurrenceValue,
} from '@/lib/utils/recurrence';
import { fromDatetimeLocalInTz, toDatetimeLocalInTz } from '@/lib/utils/date-format';
import { timezoneLabel, timezoneOptions } from '@/lib/time/timezones';
import { componiTitolo, dividiTitolo, splitTitleKicker } from '@/lib/utils/title-kicker';
import { EVENT_DESCRIPTION_MIN_LENGTH } from '@/lib/validation/event-description';
import type { VideoQualityPreset } from '@/lib/jitsi/config';
import { fondoEtichettaPiena } from '@/lib/utils/tag-color';

import NuovaEtichetta, { type EtichettaCreata } from './nuova-etichetta';
import { nomeLingua } from './text-translation';
import { useFasciaCopertina } from './use-fascia-copertina';

export interface Step1Value {
  title: Record<string, string>;
  description: Record<string, string>;
  startsAt: string; // datetime-local
  endsAt: string;
  timezone: string;
  maxParticipants: number;
  coverImageUrl: string | null;
  imageUrl: string | null;
  waitingRoomAudioUrl: string | null;
  tagSlugs: string[];
  recurrenceRule: string | null;
  recurrencePreset: RecurrencePreset;
  recurrenceUntil: string | null;
  recurrenceCount: number | null;
  /** Per-event override: true/false forces the behaviour, null inherits
   *  the site default. */
  parseTitleKicker: boolean | null;
  /** Per-event waiting-room engine override. Null inherits the site default. */
  waitingRoomEngine: 'GARDEN' | 'GAME' | 'CLASSIC' | null;
  /** Per-event video/audio quality override. Null inherits the site default. */
  videoQuality?: VideoQualityPreset | null;
  /** Per-event estimate of how many participants will send audio/video.
   *  Null inherits the site default. */
  expectedSenderRatioPct: number | null;
}

interface Props {
  value: Step1Value;
  onChange: (patch: Partial<Step1Value>) => void;
  enabledLocales: string[];
  defaultLocale: string;
  availableTags: Array<{
    slug: string;
    name: Record<string, string>;
    color: string | null;
  }>;
  fieldErrors: Record<string, string>;
  /** Site-wide default for parseTitleKicker. Used as the visible default
   *  when the per-event override is null. */
  siteDefaultParseTitleKicker: boolean;
  /** Site-wide default video/audio quality. Shown as the resolved value
   *  when the per-event override is null (inherit). */
  siteDefaultVideoQuality: VideoQualityPreset;
  /** Sotto la descrizione, dove la pagina pubblica mostra il programma: la
   *  scheda che porta al passo «Programma» (programme-card.tsx). */
  dopoDescrizione?: ReactNode;
  /** La lingua del testo che l'anteprima della pagina, accanto, mostra reso
   *  (null se non c'e'): per quella lingua l'editor non ripete l'anteprima. */
  linguaAnteprimaPagina?: string | null;
  /**
   * Quale parte mostrare: «Evento» (titolo, descrizione, copertina,
   * categorie), «Quando» (date, fuso, partecipanti attesi, ricorrenza) o le
   * scelte sulla sala d'attesa e sul video, fra le impostazioni avanzate.
   */
  parte?: 'evento' | 'quando' | 'avanzate';
  /** L'amministrazione crea una categoria nuova da qui, gia' scelta per
   *  l'evento: la riceve chi tiene l'elenco delle categorie. */
  onEtichettaCreata?: (etichetta: EtichettaCreata) => void;
  /**
   * Le lingue dell'evento (text-translation.tsx): la riga «Lingue
   * dell'evento» sopra le schede, le schede con il loro stato scritto e
   * l'avviso dentro la scheda. Senza, le schede sono le lingue del sito.
   */
  lingue?: {
    riga: ReactNode;
    schede: string[];
    aspetto: Record<string, AspettoScheda>;
    pannello: (lingua: string) => ReactNode;
  };
  /** Ogni file che parte per il server (true) e che ha finito (false): il
   *  wizard non salva e non cambia passo finche' ce n'e' uno in viaggio. */
  onUploadBusy?: (inCaricamento: boolean) => void;
  /** Sopratitolo e titolo come li si sta scrivendo, per lingua: li tiene il
   *  wizard, cosi' un sopratitolo scritto prima del titolo (che non si salva
   *  da solo) resta cambiando passo. Senza, li tiene il passo. */
  bozzeTitolo?: BozzeTitolo;
  onBozzeTitolo?: (aggiorna: (prima: BozzeTitolo) => BozzeTitolo) => void;
}

/** Sopratitolo e titolo in scrittura, per lingua, con il titolo che ne e'
 *  uscito: finche' il modulo ha quel titolo, i campi mostrano questi. */
export type BozzeTitolo = Record<string, { sopra: string; titolo: string; composto: string }>;

export default function Step1Base({
  value,
  onChange,
  enabledLocales,
  defaultLocale,
  availableTags,
  fieldErrors,
  siteDefaultParseTitleKicker,
  siteDefaultVideoQuality,
  parte = 'evento',
  dopoDescrizione,
  linguaAnteprimaPagina = null,
  onEtichettaCreata,
  lingue,
  onUploadBusy,
  bozzeTitolo,
  onBozzeTitolo,
}: Props) {
  const t = useTranslations('admin.wizard.step1');
  const tf = useTranslations('admin.wizard.flow');
  const fasciaCopertina = useFasciaCopertina();
  const tAdmin = useTranslations('admin');
  const tTrad = useTranslations('admin.textTranslation');
  const schede = lingue?.schede ?? enabledLocales;
  const [linguaScelta, setContentLocale] = useState(defaultLocale);
  // Una lingua tolta dalle schede (tolta dall'evento) lascia il posto alla principale.
  const contentLocale = schede.includes(linguaScelta) ? linguaScelta : defaultLocale;
  // Titolo e descrizione sono obbligatori solo nella lingua predefinita:
  // l'asterisco compare sulla sua scheda, come quello della barra delle lingue.
  const onDefaultTab = contentLocale === defaultLocale;
  const requiredMark = onDefaultTab ? ' *' : '';
  const descriptionError = fieldErrors[`description.${defaultLocale}`];

  const setLocalized = (
    field: 'title' | 'description',
    locale: string,
    v: string,
  ) => {
    onChange({ [field]: { ...value[field], [locale]: v } } as Partial<Step1Value>);
  };

  const toggleTag = (slug: string) => {
    const has = value.tagSlugs.includes(slug);
    onChange({
      tagSlugs: has
        ? value.tagSlugs.filter((s) => s !== slug)
        : [...value.tagSlugs, slug],
    });
  };

  // Recurrence plumbing: the picker works in its own RecurrenceValue shape.
  const recurrenceValue: RecurrenceValue = {
    preset: value.recurrencePreset,
    rrule: value.recurrenceRule,
    until: value.recurrenceUntil,
    count: value.recurrenceCount,
  };

  const onRecurrenceChange = (v: RecurrenceValue) => {
    onChange({
      recurrencePreset: v.preset,
      recurrenceRule: v.rrule,
      recurrenceUntil: v.until ?? null,
      recurrenceCount: v.count ?? null,
    });
  };

  // Derive the dtstart for the recurrence picker from the current startsAt.
  let dtstart: Date;
  try {
    dtstart = value.startsAt
      ? fromDatetimeLocalInTz(value.startsAt, value.timezone)
      : new Date();
  } catch {
    dtstart = new Date();
  }

  // La fine segue l'inizio, con la durata che l'evento aveva prima della
  // modifica. Mentre si scrive nel campo si calcola all'uscita, non a ogni
  // tasto: una data scritta a mano passa per valori intermedi (il giorno «1»
  // prima del «15», l'anno «0202» prima del «2026») che falserebbero la
  // durata. Un valore che arriva a campo non attivo (il selettore di data di
  // alcuni browser toglie il fuoco al campo) si applica subito.
  const allIngresso = useRef<{ startsAt: string; endsAt: string } | null>(null);
  const fineDa = (prima: { startsAt: string; endsAt: string }, inizioNuovo: string) => {
    if (prima.startsAt === inizioNuovo) return null;
    try {
      const durata =
        fromDatetimeLocalInTz(prima.endsAt, value.timezone).getTime() -
        fromDatetimeLocalInTz(prima.startsAt, value.timezone).getTime();
      const inizio = fromDatetimeLocalInTz(inizioNuovo, value.timezone).getTime();
      if (Number.isFinite(durata) && durata > 0 && Number.isFinite(inizio)) {
        return toDatetimeLocalInTz(new Date(inizio + durata), value.timezone);
      }
    } catch {
      /* data incompleta: la fine resta com'e' */
    }
    return null;
  };
  const fineCheSegue = () => {
    const prima = allIngresso.current;
    allIngresso.current = null;
    const fine = prima ? fineDa(prima, value.startsAt) : null;
    if (fine) onChange({ endsAt: fine });
  };

  // Quando cambiano l'inizio o il fuso, la regola si ricostruisce sul nuovo
  // inizio, tenendo giorni, fine e ripetizioni gia' scelti.
  const regolaPerInizio = (startsAt: string, timezone: string): Partial<Step1Value> => {
    if (value.recurrencePreset === 'none' || value.recurrencePreset === 'custom' || !startsAt) return {};
    try {
      return { recurrenceRule: rebuildForNewStart(recurrenceValue, fromDatetimeLocalInTz(startsAt, timezone)) };
    } catch {
      return {};
    }
  };
  const handleStartsAt = (next: string) => {
    onChange({ startsAt: next, ...regolaPerInizio(next, value.timezone) });
  };
  const handleTimezone = (tz: string) => {
    onChange({ timezone: tz, ...regolaPerInizio(value.startsAt, tz) });
  };

  // I campi obbligatori li segna l'asterisco; l'errore, rosso e accanto al
  // campo, compare quando si prova ad andare avanti (o a salvare).
  // Sopratitolo e titolo: due campi, salvati come un titolo solo,
  // «Sopratitolo | Titolo» (la forma che la pagina divide). I campi tengono
  // cio' che si sta scrivendo (spazi compresi) finche' il titolo salvato e'
  // quello composto da loro; cambiato da fuori (un modello, una traduzione),
  // si rileggono dal titolo.
  const titoloScritto = value.title[contentLocale] ?? '';
  const sopratitoloAcceso = value.parseTitleKicker ?? siteDefaultParseTitleKicker;
  const [bozzeProprie, setBozzeProprie] = useState<BozzeTitolo>({});
  const inScrittura = bozzeTitolo ?? bozzeProprie;
  const setInScrittura = onBozzeTitolo ?? setBozzeProprie;
  const bozza = inScrittura[contentLocale];
  const campiTitolo =
    bozza && bozza.composto === titoloScritto
      ? bozza
      : dividiTitolo(titoloScritto, sopratitoloAcceso);
  const scriviTitolo = (sopra: string, titolo: string) => {
    // «|» separa le due parti: nel sopratitolo non ci puo' stare.
    const sopraPulito = sopra.replace(/\|/g, '');
    const composto = componiTitolo(sopraPulito, titolo);
    const titoli = { ...value.title, [contentLocale]: composto };
    // Il sopratitolo dell'evento si ricava dai campi, non da una scelta a
    // parte: acceso se una lingua ne ha uno; spento se un titolo ha un «|»
    // che e' solo testo (la pagina non lo deve dividere); altrimenti segue
    // il sito. Le altre lingue si leggono come le legge la pagina adesso.
    const altre = Object.entries(titoli)
      .filter(([l]) => l !== contentLocale)
      .map(([, tt]) => tt ?? '');
    // Un sopratitolo senza titolo non si salva ancora: non conta.
    const conSopra =
      (!!sopraPulito.trim() && !!composto) ||
      (sopratitoloAcceso && altre.some((tt) => !!dividiTitolo(tt, true).sopra));
    const conBarra =
      (!sopraPulito.trim() && titolo.includes('|')) ||
      (!sopratitoloAcceso && altre.some((tt) => tt.includes('|')));
    const voluto = conSopra ? true : conBarra ? false : null;
    // Uguale al sito: segue il sito (se il sito cambia idea, l'evento con lui).
    const scelta = voluto === null || voluto === siteDefaultParseTitleKicker ? null : voluto;
    // La scelta vale per tutte le lingue: se l'evento divide i titoli (perche'
    // un'altra lingua ha il sopratitolo), un «|» in questo titolo lo divide
    // anche la pagina. I campi lo mostrano come lo mostrera' lei.
    const diviso = splitTitleKicker(titolo, true);
    const parti =
      (scelta ?? siteDefaultParseTitleKicker) && !sopraPulito.trim() && diviso.kicker
        ? { sopra: diviso.kicker, titolo: diviso.main }
        : { sopra: sopraPulito, titolo };
    const salvato = componiTitolo(parti.sopra, parti.titolo);
    setInScrittura((prima) => ({
      ...prima,
      [contentLocale]: { ...parti, composto: salvato },
    }));
    onChange({
      title: { ...titoli, [contentLocale]: salvato },
      ...(scelta !== value.parseTitleKicker ? { parseTitleKicker: scelta } : {}),
    });
  };

  if (parte === 'avanzate') {
    // Le scelte sulla sala d'attesa e sul video: le eredita dal sito, e si
    // cambiano solo se serve.
    return (
      <div>
        {/* Per-event waiting-room engine override (inherits the site default
            when "Predefinita del sito" is selected). */}
        <div>
          <label className="form-label mb-1" htmlFor="ev-waiting-room-engine">
            {t('waitingRoomEngineLabel')}
          </label>
          <select
            id="ev-waiting-room-engine"
            className="form-select form-select-sm"
            style={{ maxWidth: 340 }}
            value={value.waitingRoomEngine === 'GARDEN' ? 'GAME' : value.waitingRoomEngine ?? ''}
            onChange={(e) =>
              onChange({
                waitingRoomEngine:
                  e.target.value === ''
                    ? null
                    : (e.target.value as 'GARDEN' | 'GAME' | 'CLASSIC'),
              })
            }
          >
            <option value="">{t('waitingRoomEngineSiteDefault')}</option>
                <option value="GAME">{t('waitingRoomEngineGame')}</option>
            <option value="CLASSIC">{t('waitingRoomEngineClassic')}</option>
          </select>
          <small className="form-text text-muted d-block">
            {t('waitingRoomEngineHelp')}
          </small>
        </div>

        {/* Per-event video/audio quality override (inherits the site
            default when "Site default" is selected). */}
        <div className="mt-3">
          <label className="form-label mb-1" htmlFor="ev-video-quality">
            {t('videoQuality')}
          </label>
          <select
            id="ev-video-quality"
            className="form-select form-select-sm"
            style={{ maxWidth: 340 }}
            value={value.videoQuality ?? ''}
            onChange={(e) =>
              onChange({
                videoQuality:
                  e.target.value === ''
                    ? null
                    : (e.target.value as VideoQualityPreset),
              })
            }
          >
            <option value="">
              {t('videoQualitySiteDefault')}
              {' — '}
              {t(`videoQualityOptions.${siteDefaultVideoQuality}`)}
            </option>
            <option value="MAX">{t('videoQualityOptions.MAX')}</option>
            <option value="HIGH">{t('videoQualityOptions.HIGH')}</option>
            <option value="BALANCED">
              {t('videoQualityOptions.BALANCED')}
            </option>
            <option value="SAVE_DATA">
              {t('videoQualityOptions.SAVE_DATA')}
            </option>
          </select>
          <small className="form-text text-muted d-block">
            {t('videoQualityHelp')}
          </small>
        </div>
        {/* La musica della sala d'attesa: facoltativa, sta con le altre
            scelte sulla sala. */}
        <div className="mt-3">
          <FileOrUrlInput
            id="ev-wr-audio"
            label={t('waitingRoomAudio')}
            assetType="audio"
            value={value.waitingRoomAudioUrl}
            onChange={(next) => onChange({ waitingRoomAudioUrl: next })}
            helpText={t('waitingRoomAudioHelp')}
            onBusy={onUploadBusy}
          />
        </div>
      </div>
    );
  }

  if (parte === 'quando') {
    return (
      <div>
        <h2 className="h4 fw-bold mb-3" style={{ color: 'var(--app-text)' }}>
          {tf('scheduleHeading')}
        </h2>
        <p className="text-secondary mb-4" style={{ fontSize: '0.9rem' }}>
          {tf('scheduleIntro')}
        </p>

        <section className="mb-4">
          <div className="row g-3">
            <div className={`col-md-6 wizard-campo${fieldErrors.startsAt ? ' wizard-campo--insisti' : ''}`}>
              <label className="form-label" htmlFor="ev-starts">
                {tAdmin('form.startsAt')} *
              </label>
              <input
                id="ev-starts"
                type="datetime-local"
                className={`form-control ${fieldErrors.startsAt ? 'is-invalid' : ''}`}
                value={value.startsAt}
                onFocus={() => {
                  allIngresso.current = { startsAt: value.startsAt, endsAt: value.endsAt };
                }}
                onChange={(e) => {
                  const aCampoAttivo = document.activeElement === e.target;
                  const prima = allIngresso.current ?? { startsAt: value.startsAt, endsAt: value.endsAt };
                  handleStartsAt(e.target.value);
                  if (aCampoAttivo) {
                    allIngresso.current = prima;
                  } else {
                    allIngresso.current = null;
                    const fine = fineDa(prima, e.target.value);
                    if (fine) onChange({ endsAt: fine });
                  }
                }}
                onBlur={fineCheSegue}
                required
              />
              {fieldErrors.startsAt && (
                <div className="invalid-feedback">{t('validation.startsAt')}</div>
              )}
            </div>
            <div className={`col-md-6 wizard-campo${fieldErrors.endsAt ? ' wizard-campo--insisti' : ''}`}>
              <label className="form-label" htmlFor="ev-ends">
                {tAdmin('form.endsAt')} *
              </label>
              <input
                id="ev-ends"
                type="datetime-local"
                className={`form-control ${fieldErrors.endsAt ? 'is-invalid' : ''}`}
                value={value.endsAt}
                onChange={(e) => onChange({ endsAt: e.target.value })}
                required
              />
              {fieldErrors.endsAt && (
                <div className="invalid-feedback">{t('validation.endsAt')}</div>
              )}
            </div>
            <div className="col-md-6">
              <label className="form-label" htmlFor="ev-tz">
                {t('timezone')}
              </label>
              <select
                id="ev-tz"
                className="form-select"
                value={value.timezone}
                onChange={(e) => handleTimezone(e.target.value)}
              >
                {timezoneOptions(value.timezone).map((tz) => (
                  <option key={tz} value={tz}>{timezoneLabel(tz)}</option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* Ricorrenza: un menu col valore in vista («Non si ripete»), non
            una sezione da aprire per scoprire che cosa c'è sotto. */}
        <div className="mb-4">
          <RecurrencePicker
            value={recurrenceValue}
            onChange={onRecurrenceChange}
            dtstart={dtstart}
            timezone={value.timezone}
          />
        </div>

      </div>
    );
  }

  return (
    <div>
      <h2 className="h4 fw-bold mb-3" style={{ color: 'var(--app-text)' }}>
        {t('heading')}
      </h2>
      <p className="text-secondary mb-1" style={{ fontSize: '0.9rem' }}>
        {t('intro')}
      </p>
      {/* Che cosa vuol dire l'asterisco, una volta sola (WCAG 3.3.2). */}
      <p className="text-secondary mb-4" style={{ fontSize: '0.85rem' }}>
        {t('requiredNote')}
      </p>

      {/* Title / description */}
      <section className="mb-4">
        {lingue?.riga}
        <LocaleTabBar
          enabledLocales={schede}
          defaultLocale={defaultLocale}
          activeLocale={contentLocale}
          onSelectLocale={setContentLocale}
          // Compilata se ha il titolo o la descrizione.
          filledLocales={schede.filter(
            (l) => !!value.title[l]?.trim() || !!value.description[l]?.trim()
          )}
          ariaLabel={tTrad('tabsLabel')}
          panelId="ev-testi-pannello"
          idPrefix="ev-scheda"
          stati={lingue?.aspetto}
        />

        {/* La scheda: titolo e descrizione nella lingua scelta, che i campi
            dicono (anche alle tecnologie assistive, con `lang`). */}
        <div role="tabpanel" id="ev-testi-pannello" aria-labelledby={`ev-scheda-${contentLocale}`}>
        {lingue?.pannello(contentLocale)}

        {/* Il sopratitolo, facoltativo: sopra il titolo, come nella pagina. */}
        <div className="mb-3">
          <label className="form-label fw-semibold" htmlFor="ev-kicker">
            {t('kickerLabel', { language: nomeLingua(contentLocale) })}
          </label>
          <input
            id="ev-kicker"
            lang={contentLocale}
            type="text"
            className="form-control"
            value={campiTitolo.sopra}
            onChange={(e) => scriviTitolo(e.target.value, campiTitolo.titolo)}
            aria-describedby="ev-kicker-aiuto"
          />
          <small id="ev-kicker-aiuto" className="form-text text-muted d-block mt-1">
            {t('kickerHint')}
          </small>
        </div>

        <div
          className={`mb-3 wizard-campo${
            fieldErrors[`title.${defaultLocale}`] ? ' wizard-campo--insisti' : ''
          }`}
        >
          <label className="form-label fw-semibold" htmlFor="ev-title">
            {tTrad('titleLabel', { language: nomeLingua(contentLocale) })}
            {requiredMark}
          </label>
          <input
            id="ev-title"
            lang={contentLocale}
            type="text"
            className={`form-control ${
              contentLocale === defaultLocale && fieldErrors[`title.${defaultLocale}`]
                ? 'is-invalid'
                : ''
            }`}
            value={campiTitolo.titolo}
            onChange={(e) => scriviTitolo(campiTitolo.sopra, e.target.value)}
            onPaste={(e) => {
              // Chi incolla un titolo gia' composto, «Ciclo | Titolo», nel
              // campo vuoto (o tutto selezionato) e senza sopratitolo: le due
              // parti vanno ai due campi. Un «|» scritto a mano resta testo.
              const campo = e.currentTarget;
              const tutto =
                campo.selectionStart === 0 && campo.selectionEnd === campo.value.length;
              if (campiTitolo.sopra.trim() || !tutto) return;
              const diviso = splitTitleKicker(e.clipboardData.getData('text'), true);
              if (!diviso.kicker) return;
              e.preventDefault();
              scriviTitolo(diviso.kicker, diviso.main);
            }}
            required={contentLocale === defaultLocale}
          />
          {fieldErrors[`title.${defaultLocale}`] &&
            (contentLocale === defaultLocale ? (
              <div className="invalid-feedback">{t('validation.titleRequired')}</div>
            ) : (
              <div className="small text-danger mt-1">
                {t('validation.titleRequiredOtherLocale', {
                  locale: defaultLocale.toUpperCase(),
                })}
              </div>
            ))}
        </div>

        <div
          className={`mb-3 wizard-campo${
            descriptionError ? ' wizard-campo--insisti' : ''
          }`}
        >
          <MarkdownEditor
            id={`ev-description-${contentLocale}`}
            label={`${tTrad('descriptionLabel', { language: nomeLingua(contentLocale) })}${requiredMark}`}
            lang={contentLocale}
            value={value.description[contentLocale] ?? ''}
            onChange={(v) => setLocalized('description', contentLocale, v)}
            rows={6}
            anteprima={linguaAnteprimaPagina !== contentLocale}
            invalid={onDefaultTab && Boolean(descriptionError)}
            errorText={t('validation.descriptionRequired', {
              min: EVENT_DESCRIPTION_MIN_LENGTH,
            })}
          />
          {/* Come per il titolo: su un'altra scheda l'errore non avrebbe un
              campo visibile, quindi indica la scheda in cui correggere. */}
          {descriptionError && !onDefaultTab && (
            <div className="small text-danger mt-1">
              {t('validation.descriptionRequiredOtherLocale', {
                locale: defaultLocale.toUpperCase(),
              })}
            </div>
          )}
        </div>
        </div>
      </section>

      {dopoDescrizione}

      {/* Cover image */}
      <section className="mb-4">
        <FileOrUrlInput
          id="ev-cover"
          label={t('coverImage')}
          assetType="image"
          value={value.coverImageUrl ?? value.imageUrl ?? null}
          onChange={(next) =>
            onChange({ coverImageUrl: next, imageUrl: next ?? null })
          }
          helpText={`${t('coverImageSize')} ${t('coverImageHelp')}`}
          ritaglio={{
            rapporto: 16 / 9,
            larghezza: 1600,
            // La fascia della pagina dell'evento su uno schermo largo.
            fascia: fasciaCopertina,
          }}
          onBusy={onUploadBusy}
        />
      </section>

      {/* Tags */}
      {(availableTags.length > 0 || onEtichettaCreata) && (
        <section className="mb-4">
          <h3 className="h6 fw-semibold mb-2" style={{ color: 'var(--app-text)' }}>
            {t('tagsHeading')}
          </h3>
          <div className="d-flex flex-wrap gap-2">
            {availableTags.map((tag) => {
              const active = value.tagSlugs.includes(tag.slug);
              const displayName =
                tag.name[defaultLocale] ?? tag.name.it ?? tag.name.en ?? tag.slug;
              return (
                <button
                  key={tag.slug}
                  type="button"
                  aria-pressed={active}
                  className={`btn btn-sm ${active ? 'btn-primary' : 'btn-outline-secondary'}`}
                  style={{
                    borderRadius: 20,
                    ...(active && tag.color
                      ? { backgroundColor: fondoEtichettaPiena(tag.color), borderColor: fondoEtichettaPiena(tag.color) }
                      : {}),
                  }}
                  onClick={() => toggleTag(tag.slug)}
                >
                  {displayName}
                </button>
              );
            })}
          </div>
          {onEtichettaCreata && (
            <NuovaEtichetta
              defaultLocale={defaultLocale}
              esistenti={availableTags}
              onCreata={(nuova) => {
                onEtichettaCreata(nuova);
                if (!value.tagSlugs.includes(nuova.slug)) {
                  onChange({ tagSlugs: [...value.tagSlugs, nuova.slug] });
                }
              }}
              onScegliEsistente={(slug) => {
                if (!value.tagSlugs.includes(slug)) {
                  onChange({ tagSlugs: [...value.tagSlugs, slug] });
                }
              }}
            />
          )}
        </section>
      )}
    </div>
  );
}
