'use client';

/**
 * Step 1 — Base event info.
 *
 * Owns: title & description (multilingual), cover image, schedule (start/end +
 * timezone), expected max participants, tags, recurrence, and optional
 * waiting-room audio. No submit logic lives here — the parent wizard shell
 * collects the full form and POSTs on review.
 */

import { useState } from 'react';
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
import { fromDatetimeLocalInTz } from '@/lib/utils/date-format';

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
}: Props) {
  const t = useTranslations('admin.wizard.step1');
  const tAdmin = useTranslations('admin');
  const [contentLocale, setContentLocale] = useState(defaultLocale);

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
          </label>
          <input
            id="ev-title"
            type="text"
            className={`form-control ${fieldErrors[`title.${contentLocale}`] ? 'is-invalid' : ''}`}
            value={value.title[contentLocale] ?? ''}
            onChange={(e) => setLocalized('title', contentLocale, e.target.value)}
            required={contentLocale === defaultLocale}
          />
          {fieldErrors[`title.${contentLocale}`] && (
            <div className="invalid-feedback">
              {fieldErrors[`title.${contentLocale}`]}
            </div>
          )}

          {/* Per-event kicker override — always shown so the admin can
              toggle pipe-splitting on or off for this event. The initial
              checked state mirrors the resolved value (override ??
              site default); flipping it stores an explicit true/false. */}
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
        </div>

        <div className="mb-3">
          <MarkdownEditor
            id={`ev-description-${contentLocale}`}
            label={tAdmin('form.descriptionLabel')}
            value={value.description[contentLocale] ?? ''}
            onChange={(v) => setLocalized('description', contentLocale, v)}
            rows={6}
          />
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
              onChange={(e) => handleStartsAt(e.target.value)}
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
                max={500}
                step={1}
                className="form-range flex-grow-1"
                value={Math.min(500, Math.max(2, value.maxParticipants || 150))}
                onChange={(e) =>
                  onChange({ maxParticipants: Number(e.target.value) || 2 })
                }
                aria-label={tAdmin('form.expectedParticipants')}
              />
              <input
                id="ev-max"
                type="number"
                min={2}
                max={500}
                className="form-control"
                style={{ maxWidth: 96 }}
                value={value.maxParticipants}
                onChange={(e) => {
                  const raw = Number(e.target.value);
                  if (!Number.isFinite(raw)) return;
                  const clamped = Math.min(500, Math.max(2, Math.floor(raw)));
                  onChange({ maxParticipants: clamped });
                }}
              />
            </div>
            <small className="form-text text-muted">
              {t('maxParticipantsHelp')}
            </small>
          </div>
          <div className="col-12">
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
          </div>
        </div>
      </section>

      {/* Recurrence */}
      <section className="mb-4">
        <h3 className="h6 fw-semibold mb-2" style={{ color: 'var(--app-text)' }}>
          {t('recurrenceHeading')}
        </h3>
        <RecurrencePicker
          value={recurrenceValue}
          onChange={onRecurrenceChange}
          dtstart={dtstart}
          timezone={value.timezone}
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
