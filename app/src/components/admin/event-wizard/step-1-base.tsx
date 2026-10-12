'use client';

/**
 * Step 1 — Base event info.
 *
 * Owns: title & description (multilingual), cover image, schedule (start/end +
 * timezone), expected max participants, tags, recurrence, and optional
 * waiting-room audio. No submit logic lives here — the parent wizard shell
 * collects the full form and POSTs on review.
 */

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import EventTitle from '@/components/events/event-title';
import LocaleTabBar from '@/components/ui/locale-tab-bar';
import { MarkdownEditor } from '@/components/ui/markdown';
import FileOrUrlInput from '@/components/ui/file-or-url-input';
import RecurrencePicker from '@/components/admin/recurrence-picker';
import {
  buildRRule,
  type RecurrencePreset,
  type RecurrenceValue,
} from '@/lib/utils/recurrence';
import { fromDatetimeLocalInTz, toDatetimeLocalInTz } from '@/lib/utils/date-format';
import { splitTitleKicker } from '@/lib/utils/title-kicker';
import { EVENT_DESCRIPTION_MIN_LENGTH } from '@/lib/validation/event-description';
import type { VideoQualityPreset } from '@/lib/jitsi/config';

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
  /**
   * Quale parte mostrare: «Evento» (titolo, descrizione, copertina,
   * categorie), «Quando» (date, fuso, partecipanti attesi, ricorrenza) o le
   * scelte sulla sala d'attesa e sul video, fra le impostazioni avanzate.
   */
  parte?: 'evento' | 'quando' | 'avanzate';
}

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
}: Props) {
  const t = useTranslations('admin.wizard.step1');
  const tf = useTranslations('admin.wizard.flow');
  // La ricorrenza resta aperta se c'era all'apertura: scegliere «nessuna»
  // non la richiude sotto il cursore.
  const [ricorrenzaAperta] = useState(value.recurrencePreset !== 'none');
  // Il testo del campo partecipanti mentre lo si scrive (null fuori dal campo).
  const [maxText, setMaxText] = useState<string | null>(null);
  const tAdmin = useTranslations('admin');
  const [contentLocale, setContentLocale] = useState(defaultLocale);
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

  // When startsAt or preset changes, refresh the RRULE body so BYDAY etc stay in sync.
  const handleStartsAt = (next: string) => {
    const patch: Partial<Step1Value> = { startsAt: next };
    if (value.recurrencePreset !== 'none' && value.recurrencePreset !== 'custom') {
      try {
        const newDt = fromDatetimeLocalInTz(next, value.timezone);
        const rebuilt = buildRRule({
          preset: value.recurrencePreset,
          dtstart: newDt,
          count: value.recurrenceCount ?? undefined,
        });
        patch.recurrenceRule = rebuilt || null;
      } catch {
        /* ignore */
      }
    }
    onChange(patch);
  };

  // I campi obbligatori si fanno notare finche' sono vuoti (lampeggiano di
  // blu, con la riga che dice a che cosa servono), e insistono in ambra dopo
  // un tentativo: come il nome nella sala d'attesa. Il rosso resta agli
  // errori veri.
  const titoloVuoto = onDefaultTab && (value.title[defaultLocale] ?? '').trim().length < 3;
  const descrizioneVuota =
    onDefaultTab && (value.description[defaultLocale] ?? '').trim().length < EVENT_DESCRIPTION_MIN_LENGTH;
  const titoloScritto = value.title[contentLocale] ?? '';
  const sopratitolo = splitTitleKicker(titoloScritto, true);
  const sopratitoloAcceso = value.parseTitleKicker ?? siteDefaultParseTitleKicker;

  const promemoria = (id: string) => (
    <div id={id} className="wizard-campo__hint">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
           strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
      <span>{tf('requiredToSave')}</span>
    </div>
  );

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
                onChange={(e) => onChange({ timezone: e.target.value })}
              >
                <option value="Europe/Rome">Europe/Rome</option>
                <option value="UTC">UTC</option>
                <option value="Europe/London">Europe/London</option>
                <option value="Europe/Paris">Europe/Paris</option>
                <option value="Europe/Berlin">Europe/Berlin</option>
              </select>
            </div>
              <div className="col-md-6">
              <label className="form-label" htmlFor="ev-max">
                {tAdmin('form.expectedParticipants')}
              </label>
              <div className="d-flex align-items-center gap-3">
                <input
                  id="ev-max-range"
                  type="range"
                  min={2}
                  max={5000}
                  step={1}
                  className="form-range flex-grow-1"
                  value={Math.min(5000, Math.max(2, value.maxParticipants || 150))}
                  onChange={(e) =>
                    onChange({ maxParticipants: Number(e.target.value) || 2 })
                  }
                  aria-label={tAdmin('form.expectedParticipants')}
                />
                <input
                  id="ev-max"
                  type="number"
                  min={2}
                  max={5000}
                  className={`form-control ${fieldErrors.maxParticipants ? 'is-invalid' : ''}`}
                  style={{ maxWidth: 96 }}
                  // Mentre si scrive il campo tiene il testo cosi' com'e' (anche
                  // vuoto); il valore si riporta nei limiti all'uscita, non a ogni
                  // tasto: scrivendo «150» il primo «1» diventerebbe 2.
                  value={maxText ?? value.maxParticipants}
                  onChange={(e) => {
                    setMaxText(e.target.value);
                    const raw = Number(e.target.value);
                    if (e.target.value.trim() === '' || !Number.isFinite(raw)) return;
                    onChange({ maxParticipants: Math.floor(raw) });
                  }}
                  onBlur={() => {
                    setMaxText(null);
                    const clamped = Math.min(5000, Math.max(2, value.maxParticipants || 2));
                    if (clamped !== value.maxParticipants) onChange({ maxParticipants: clamped });
                  }}
                />
              </div>
              <small className="form-text text-muted">
                {t('maxParticipantsHelp')}
              </small>
              {fieldErrors.maxParticipants && (
                <div className="small text-danger mt-1">
                  {t('validation.maxParticipants')}
                </div>
              )}
            </div>
            </div>
        </section>

        {/* Recurrence */}
        {/* Recurrence collapsed by default — most single events won't touch it.
            Kept open when a recurrence is already configured (edit case). */}
        <details className="mb-4" open={ricorrenzaAperta || undefined}>
          <summary
            className="h6 fw-semibold mb-2"
            style={{ cursor: 'pointer', color: 'var(--app-text)' }}
          >
            {t('recurrenceHeading')}
          </summary>
          <div className="mt-2">
            <RecurrencePicker
              value={recurrenceValue}
              onChange={onRecurrenceChange}
              dtstart={dtstart}
              timezone={value.timezone}
            />
          </div>
        </details>

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
      <p className="text-secondary mb-4" style={{ fontSize: '0.85rem' }}>
        {t('requiredLegend')}
      </p>

      {/* Title / description */}
      <section className="mb-4">
        <LocaleTabBar
          enabledLocales={enabledLocales}
          defaultLocale={defaultLocale}
          activeLocale={contentLocale}
          onSelectLocale={setContentLocale}
          filledLocales={Object.keys(value.title).filter((l) => value.title[l])}
        />

        <div
          className={`mb-3 wizard-campo${
            fieldErrors[`title.${defaultLocale}`] ? ' wizard-campo--insisti' : titoloVuoto ? ' wizard-campo--vuoto' : ''
          }`}
        >
          <label className="form-label fw-semibold" htmlFor="ev-title">
            {tAdmin('form.titleLabel')}
            {requiredMark}
          </label>
          <input
            id="ev-title"
            type="text"
            className={`form-control ${
              contentLocale === defaultLocale && fieldErrors[`title.${defaultLocale}`]
                ? 'is-invalid'
                : ''
            }`}
            value={value.title[contentLocale] ?? ''}
            onChange={(e) => setLocalized('title', contentLocale, e.target.value)}
            required={contentLocale === defaultLocale}
            aria-describedby={
              titoloVuoto && !fieldErrors[`title.${defaultLocale}`]
                ? 'ev-title-sopratitolo ev-title-promemoria'
                : 'ev-title-sopratitolo'
            }
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

          {/* Il sopratitolo: la parte prima di «|». Lo si spiega qui, e appena
              il titolo ne ha uno si vede come apparira' e lo si accende o
              spegne (la scelta vale per questo evento; senza, vale quella
              del sito). */}
          {sopratitolo.kicker ? (
            <div id="ev-title-sopratitolo" className="wizard-sopratitolo mt-2">
              <div className="form-check mb-2">
                <input
                  id="ev-parse-title-kicker"
                  type="checkbox"
                  className="form-check-input"
                  checked={sopratitoloAcceso}
                  onChange={(e) => onChange({ parseTitleKicker: e.target.checked })}
                />
                <label className="form-check-label" htmlFor="ev-parse-title-kicker">
                  {t('kickerUse', { kicker: sopratitolo.kicker })}
                </label>
              </div>
              <p className="wizard-sopratitolo__etichetta">{t('kickerPreview')}</p>
              <EventTitle
                title={titoloScritto}
                kickerEnabled={sopratitoloAcceso}
                as="p"
                className="wizard-sopratitolo__titolo"
              />
            </div>
          ) : (
            <small id="ev-title-sopratitolo" className="form-text text-muted d-block mt-1">
              {t('kickerHint')}
            </small>
          )}

          {titoloVuoto && !fieldErrors[`title.${defaultLocale}`] && promemoria('ev-title-promemoria')}
        </div>

        <div
          className={`mb-3 wizard-campo${
            descriptionError ? ' wizard-campo--insisti' : descrizioneVuota ? ' wizard-campo--vuoto' : ''
          }`}
        >
          <MarkdownEditor
            id={`ev-description-${contentLocale}`}
            label={`${tAdmin('form.descriptionLabel')}${requiredMark}`}
            value={value.description[contentLocale] ?? ''}
            onChange={(v) => setLocalized('description', contentLocale, v)}
            rows={6}
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
          {descrizioneVuota && !descriptionError && promemoria('ev-description-promemoria')}
        </div>
      </section>

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
          helpText={t('coverImageHelp')}
        />
      </section>

      {/* Tags */}
      {availableTags.length > 0 && (
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
                    ...(active && tag.color ? { backgroundColor: tag.color, borderColor: tag.color } : {}),
                  }}
                  onClick={() => toggleTag(tag.slug)}
                >
                  {displayName}
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
