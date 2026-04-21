'use client';

import { useMemo, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import {
  buildRRule,
  nextOccurrences,
  jsWeekdayToRRule,
  type RecurrencePreset,
  type RecurrenceValue,
} from '@/lib/utils/recurrence';
import { DEFAULT_TIMEZONE } from '@/lib/utils/date-format';

export interface RecurrencePickerProps {
  value: RecurrenceValue;
  onChange: (v: RecurrenceValue) => void;
  /** Event start date — drives "first occurrence" preview and default weekday. */
  dtstart: Date;
  disabled?: boolean;
  /** IANA timezone for preview rendering. Defaults to Europe/Rome. */
  timezone?: string;
}

type EndMode = 'never' | 'until' | 'count';

const PRESETS: RecurrencePreset[] = [
  'none',
  'daily',
  'weekly',
  'weekdays',
  'monthly',
  'custom',
];

const WEEKDAY_ORDER = [0, 1, 2, 3, 4, 5, 6] as const; // Mon..Sun (RRULE convention)

/**
 * Standalone RecurrencePicker. Emits a new RecurrenceValue on every interaction
 * via `onChange`. Does not own any state other than derived UI state.
 */
export default function RecurrencePicker({
  value,
  onChange,
  dtstart,
  disabled = false,
  timezone = DEFAULT_TIMEZONE,
}: RecurrencePickerProps) {
  const t = useTranslations('admin.recurrence');
  const locale = useLocale();
  const localeCode: 'it' | 'en' = locale === 'it' ? 'it' : 'en';

  const preset = value.preset;

  // ── Derived: selected weekdays for "weekly" preset ────────────────────────
  const selectedWeekdays = useMemo<number[]>(() => {
    if (preset !== 'weekly') return [];
    // Extract BYDAY=... from the current rrule, or default to dtstart weekday.
    if (value.rrule) {
      const match = /BYDAY=([A-Z,]+)/i.exec(value.rrule);
      if (match) {
        const codes = match[1]!.split(',').map((s) => s.trim().toUpperCase());
        const map: Record<string, number> = {
          MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6,
        };
        const arr = codes
          .map((c) => map[c])
          .filter((i) => i !== undefined);
        if (arr.length > 0) return arr;
      }
    }
    return [jsWeekdayToRRule(dtstart.getUTCDay())];
  }, [preset, value.rrule, dtstart]);

  // ── Derived: end mode ─────────────────────────────────────────────────────
  const endMode: EndMode = useMemo(() => {
    if (value.until) return 'until';
    if (value.count) return 'count';
    return 'never';
  }, [value.until, value.count]);

  // ── Emitters ──────────────────────────────────────────────────────────────

  const emit = useCallback(
    (next: {
      preset?: RecurrencePreset;
      byWeekday?: number[];
      endMode?: EndMode;
      until?: string | null;
      count?: number | null;
      customRRule?: string;
    }) => {
      const nextPreset = next.preset ?? preset;
      if (nextPreset === 'none') {
        onChange({ preset: 'none', rrule: null, until: null, count: null });
        return;
      }

      const nextEndMode = next.endMode ?? endMode;
      let nextUntil: string | null = null;
      let nextCount: number | null = null;
      if (nextEndMode === 'until') {
        nextUntil = next.until ?? value.until ?? null;
      } else if (nextEndMode === 'count') {
        nextCount = next.count ?? value.count ?? 12;
      }

      const byWeekday =
        nextPreset === 'weekly' ? (next.byWeekday ?? selectedWeekdays) : undefined;

      const customRRule =
        nextPreset === 'custom'
          ? (next.customRRule ?? value.rrule ?? '')
          : undefined;

      const untilDate = nextUntil ? parseIsoDateToUtc(nextUntil) : undefined;

      const rrule = buildRRule({
        preset: nextPreset,
        dtstart,
        byWeekday,
        count: nextCount ?? undefined,
        until: untilDate,
        customRRule,
      });

      onChange({
        preset: nextPreset,
        rrule: rrule || null,
        until: nextUntil,
        count: nextCount,
      });
    },
    [preset, endMode, value, dtstart, selectedWeekdays, onChange],
  );

  // ── Render ────────────────────────────────────────────────────────────────
  const isActive = preset !== 'none';
  const previewDates = useMemo(() => {
    if (!value.rrule) return [];
    return nextOccurrences(value.rrule, dtstart, 5);
  }, [value.rrule, dtstart]);

  const customValid = useMemo(() => {
    if (preset !== 'custom') return true;
    if (!value.rrule) return false;
    return previewDates.length > 0;
  }, [preset, value.rrule, previewDates]);

  return (
    <div className="recurrence-picker">
      {/* Preset segmented group */}
      <div className="mb-3">
        <div className="form-label mb-2">{t('label')}</div>
        <div className="text-secondary mb-2" style={{ fontSize: '0.85rem' }}>
          {t('helpText')}
        </div>
        <div className="d-flex flex-wrap gap-2" role="radiogroup" aria-label={t('label')}>
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={preset === p}
              disabled={disabled}
              onClick={() => emit({ preset: p })}
              className={`btn btn-sm ${preset === p ? 'btn-primary' : 'btn-outline-primary'}`}
              style={{ borderRadius: 20 }}
            >
              {t(`preset.${p}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Weekly weekday pills */}
      {preset === 'weekly' && (
        <div className="mb-3">
          <div className="form-label mb-2">{t('weekdaysLabel')}</div>
          <div className="d-flex flex-wrap gap-2" role="group">
            {WEEKDAY_ORDER.map((i) => {
              const active = selectedWeekdays.includes(i);
              const label = t(`weekdayShort.${i}`);
              return (
                <button
                  key={i}
                  type="button"
                  aria-pressed={active}
                  disabled={disabled}
                  onClick={() => {
                    const nextSel = active
                      ? selectedWeekdays.filter((x) => x !== i)
                      : [...selectedWeekdays, i].sort((a, b) => a - b);
                    // Ensure at least one stays selected
                    if (nextSel.length === 0) return;
                    emit({ byWeekday: nextSel });
                  }}
                  className={`btn btn-sm ${active ? 'btn-primary' : 'btn-outline-secondary'}`}
                  style={{ minWidth: 48, borderRadius: 20 }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Custom RRULE input */}
      {preset === 'custom' && (
        <div className="mb-3">
          <label htmlFor="rp-custom" className="form-label">
            {t('customRRuleLabel')}
          </label>
          <input
            id="rp-custom"
            type="text"
            className="form-control"
            disabled={disabled}
            placeholder="FREQ=WEEKLY;BYDAY=FR"
            value={value.rrule ?? ''}
            onChange={(e) => emit({ customRRule: e.target.value })}
          />
          {!customValid && (
            <div className="form-text text-danger">{t('invalidRRule')}</div>
          )}
        </div>
      )}

      {/* End section (for any active preset) */}
      {isActive && (
        <div className="mb-3">
          <div className="form-label mb-2">{t('endLabel')}</div>
          <div className="d-flex flex-column gap-1">
            <label
              className="d-flex align-items-center gap-2"
              style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
            >
              <input
                type="radio"
                name="rp-end"
                checked={endMode === 'never'}
                disabled={disabled}
                onChange={() => emit({ endMode: 'never' })}
              />
              <span style={{ fontSize: '0.88rem' }}>{t('endNever')}</span>
            </label>

            <label
              className="d-flex align-items-center gap-2"
              style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
            >
              <input
                type="radio"
                name="rp-end"
                checked={endMode === 'until'}
                disabled={disabled}
                onChange={() => emit({ endMode: 'until', until: value.until ?? defaultUntilIso(dtstart) })}
              />
              <span style={{ fontSize: '0.88rem' }}>{t('endDate')}</span>
            </label>

            {endMode === 'until' && (
              <div className="ms-4 mt-1" style={{ maxWidth: 220 }}>
                <input
                  type="date"
                  className="form-control form-control-sm"
                  disabled={disabled}
                  value={value.until ?? defaultUntilIso(dtstart)}
                  onChange={(e) => emit({ endMode: 'until', until: e.target.value })}
                />
              </div>
            )}

            <label
              className="d-flex align-items-center gap-2"
              style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
            >
              <input
                type="radio"
                name="rp-end"
                checked={endMode === 'count'}
                disabled={disabled}
                onChange={() => emit({ endMode: 'count', count: value.count ?? 12 })}
              />
              <span style={{ fontSize: '0.88rem' }}>{t('endCount')}</span>
            </label>

            {endMode === 'count' && (
              <div className="ms-4 mt-1" style={{ maxWidth: 140 }}>
                <input
                  type="number"
                  min={1}
                  max={999}
                  className="form-control form-control-sm"
                  disabled={disabled}
                  value={value.count ?? 12}
                  onChange={(e) => {
                    const n = Number.parseInt(e.target.value, 10);
                    if (!Number.isFinite(n) || n < 1) return;
                    emit({ endMode: 'count', count: n });
                  }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Preview */}
      {isActive && (
        <div
          className="p-3 rounded-2 bg-light border"
          aria-live="polite"
        >
          <div
            className="form-label mb-2"
            style={{ fontSize: '0.85rem', fontWeight: 600 }}
          >
            {t('previewLabel')}
          </div>
          {previewDates.length === 0 ? (
            <div className="text-secondary" style={{ fontSize: '0.85rem' }}>
              {t('invalidRRule')}
            </div>
          ) : (
            <ul className="list-unstyled mb-0" style={{ fontSize: '0.85rem' }}>
              {previewDates.map((d, i) => (
                <li key={i}>{formatPreview(d, localeCode, timezone)}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────────────────────

function parseIsoDateToUtc(iso: string): Date | undefined {
  // "YYYY-MM-DD" → UTC end-of-day so that the UNTIL includes the selected day.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return undefined;
  return new Date(Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    23, 59, 59,
  ));
}

function defaultUntilIso(dtstart: Date): string {
  // Default: 3 months from dtstart.
  const d = new Date(dtstart.getTime());
  d.setUTCMonth(d.getUTCMonth() + 3);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

function formatPreview(date: Date, locale: 'it' | 'en', tz: string): string {
  return new Intl.DateTimeFormat(locale === 'it' ? 'it-IT' : 'en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz,
  }).format(date);
}
