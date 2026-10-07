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
  /** Site-wide default sender-ratio %, used as fallback/initial estimate. */
  defaultSenderRatioPct: number;
  /** Site-wide default video/audio quality. Shown as the resolved value
   *  when the per-event override is null (inherit). */
  siteDefaultVideoQuality: VideoQualityPreset;
}

const SENDER_RATIO_PRESETS = [15, 25, 35, 50, 75] as const;

export default function Step1Base({
  value,
  onChange,
  enabledLocales,
  defaultLocale,
  availableTags,
  fieldErrors,
  siteDefaultParseTitleKicker,
  defaultSenderRatioPct,
  siteDefaultVideoQuality,
}: Props) {
  const t = useTranslations('admin.wizard.step1');
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

  return (
    <div>
      <h2 className="h4 fw-bold mb-3" style={{ color: 'var(--app-text)' }}>
        {t('heading')}
      </h2>
      <p className="text-secondary mb-4" style={{ fontSize: '0.9rem' }}>
        {t('intro')}
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

        <div className="mb-3">
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
          />
          {/* Validation targets the default-locale title. Show the inline
              invalid message on that tab; on any other tab, point the admin
              back to the required locale so the error isn't invisible. */}
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

          {/* Advanced per-event overrides, collapsed by default so title +
              description stay the visual anchors. Each inherits the site
              default when left untouched. */}
          <details className="mt-3 mb-2">
            <summary
              className="fw-semibold"
              style={{ cursor: 'pointer', color: 'var(--app-text)' }}
            >
              {t('advancedOptions')}
            </summary>
            <div className="mt-3 ps-1">
          {/* Per-event kicker override: flipping it stores an explicit
              true/false; unchanged inherits the site default. */}
          <div className="form-check mt-2">
            <input
              id="ev-parse-title-kicker"
              type="checkbox"
              className="form-check-input"
              checked={value.parseTitleKicker ?? siteDefaultParseTitleKicker}
              onChange={(e) =>
                onChange({ parseTitleKicker: e.target.checked })
              }
            />
            <label className="form-check-label" htmlFor="ev-parse-title-kicker">
              {t('parseTitleKickerLabel')}
            </label>
            <small className="form-text text-muted d-block">
              {t('parseTitleKickerHelp')}
            </small>
          </div>

          {/* Per-event waiting-room engine override (inherits the site default
              when "Predefinita del sito" is selected). */}
          <div className="mt-3">
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
            </div>
          </details>
        </div>

        <div className="mb-3">
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

      {/* Schedule */}
      <section className="mb-4">
        <h3 className="h6 fw-semibold mb-2" style={{ color: 'var(--app-text)' }}>
          {t('scheduleHeading')}
        </h3>
        <div className="row g-3">
          <div className="col-md-6">
            <label className="form-label" htmlFor="ev-starts">
              {tAdmin('form.startsAt')}
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
          <div className="col-md-6">
            <label className="form-label" htmlFor="ev-ends">
              {tAdmin('form.endsAt')}
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
          <div className="col-12">
            {/* Serve a dimensionare il server video: il modello la imposta, e
                chi prepara l'evento la apre solo se vuole cambiarla. */}
            <details className="wizard-tech">
              <summary>
                {t('senderRatioLabel')}: {value.expectedSenderRatioPct ?? defaultSenderRatioPct}% ·{' '}
                {t('activeParticipantsEstimate', {
                  count: Math.round(
                    (value.maxParticipants * (value.expectedSenderRatioPct ?? defaultSenderRatioPct)) / 100,
                  ),
                })}
              </summary>
              <label className="form-label" htmlFor="ev-sender-ratio">
                {t('senderRatioLabel')}
              </label>
              <div className="d-flex align-items-center flex-wrap gap-2">
                {SENDER_RATIO_PRESETS.map((pct) => {
                  const effective = value.expectedSenderRatioPct ?? defaultSenderRatioPct;
                  const active = effective === pct;
                  return (
                    <button
                      key={pct}
                      type="button"
                      aria-pressed={active}
                      className={`btn btn-sm ${active ? 'btn-primary' : 'btn-outline-secondary'}`}
                      onClick={() => onChange({ expectedSenderRatioPct: pct })}
                    >
                      {t('senderRatioPreset', { pct })}
                    </button>
                  );
                })}
                <input
                  id="ev-sender-ratio"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  className="form-control"
                  style={{ maxWidth: 96 }}
                  value={value.expectedSenderRatioPct ?? defaultSenderRatioPct}
                  onChange={(e) => {
                    const raw = Number(e.target.value);
                    if (!Number.isFinite(raw)) return;
                    const clamped = Math.min(100, Math.max(0, Math.round(raw)));
                    onChange({ expectedSenderRatioPct: clamped });
                  }}
                  aria-label={t('senderRatioLabel')}
                />
                <span className="text-muted" style={{ fontSize: '0.85rem' }}>
                  {t('activeParticipantsEstimate', {
                    count: Math.round(
                      (value.maxParticipants *
                        (value.expectedSenderRatioPct ?? defaultSenderRatioPct)) /
                        100,
                    ),
                  })}
                </span>
              </div>
              <small className="form-text text-muted">
                {t('senderRatioHelp')}
              </small>
            </details>
          </div>
        </div>
      </section>

      {/* Recurrence */}
      {/* Recurrence collapsed by default — most single events won't touch it.
          Kept open when a recurrence is already configured (edit case). */}
      <details className="mb-4" open={value.recurrencePreset !== 'none'}>
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

      {/* Waiting room audio (optional) */}
      <section className="mb-3">
        <FileOrUrlInput
          id="ev-wr-audio"
          label={t('waitingRoomAudio')}
          assetType="audio"
          value={value.waitingRoomAudioUrl}
          onChange={(next) => onChange({ waitingRoomAudioUrl: next })}
          helpText={t('waitingRoomAudioHelp')}
        />
      </section>
    </div>
  );
}
