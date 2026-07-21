/**
 * RRULE utilities wrapping the `rrule` npm package.
 *
 * Consumers should import only the helpers from this module so we can keep the
 * underlying dependency (and its quirks) isolated. The helpers map a small set
 * of preset patterns — the ones actually exposed in the admin UI — to RFC 5545
 * RRULE strings and back.
 */

import { RRule, type Frequency, type Weekday } from 'rrule';

export type RecurrencePreset =
  | 'none'
  | 'daily'
  | 'weekly'
  | 'weekdays'
  | 'monthly'
  | 'custom';

export interface RecurrenceValue {
  preset: RecurrencePreset;
  /** Full RRULE string WITHOUT any leading `RRULE:` prefix. */
  rrule: string | null;
  /** ISO date string (YYYY-MM-DD) or null. Convenience mirror of UNTIL in rrule. */
  until?: string | null;
  /** Numeric COUNT. Mirror of COUNT in rrule. */
  count?: number | null;
}

// ── Weekday helpers ─────────────────────────────────────────────────────────
//
// The RRULE spec uses 0 = Monday ... 6 = Sunday (matching `rrule`'s Weekday
// numeric value). JavaScript's Date#getDay() returns 0 = Sunday ... 6 = Saturday.
// We only use the RRULE convention publicly from this module.

const RRULE_WEEKDAYS: Weekday[] = [
  RRule.MO,
  RRule.TU,
  RRule.WE,
  RRule.TH,
  RRule.FR,
  RRule.SA,
  RRule.SU,
];

const WEEKDAY_CODE_ORDER = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

/** Convert a JS Date weekday (Sun=0) into the RRULE index (Mon=0). */
export function jsWeekdayToRRule(jsDay: number): number {
  // JS: Sun=0, Mon=1, ..., Sat=6 → RRULE: Mon=0, Tue=1, ..., Sun=6
  return (jsDay + 6) % 7;
}

// ── buildRRule ──────────────────────────────────────────────────────────────

export interface BuildRRuleParams {
  preset: RecurrencePreset;
  dtstart: Date;
  until?: Date | null;
  count?: number | null;
  /** Indices using RRULE convention: 0=Mon ... 6=Sun. */
  byWeekday?: number[] | null;
  /** Raw RRULE body, used only when preset === 'custom'. */
  customRRule?: string | null;
}

export function buildRRule(params: BuildRRuleParams): string {
  const { preset, dtstart, until, count, byWeekday, customRRule } = params;

  if (preset === 'none') return '';

  if (preset === 'custom') {
    const body = stripRRulePrefix((customRRule ?? '').trim());
    return body;
  }

  let freq: Frequency;
  let byday: Weekday[] | undefined;

  switch (preset) {
    case 'daily':
      freq = RRule.DAILY;
      break;
    case 'weekly': {
      freq = RRule.WEEKLY;
      const days = (byWeekday && byWeekday.length > 0)
        ? byWeekday
        : [jsWeekdayToRRule(dtstart.getUTCDay())];
      byday = days
        .filter((i) => i >= 0 && i <= 6)
        .map((i) => RRULE_WEEKDAYS[i])
        .filter((w): w is Weekday => w !== undefined);
      break;
    }
    case 'weekdays':
      freq = RRule.WEEKLY;
      byday = [RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR];
      break;
    case 'monthly':
      freq = RRule.MONTHLY;
      break;
    default:
      return '';
  }

  const rule = new RRule({
    freq,
    dtstart,
    byweekday: byday,
    until: until ?? null,
    count: count ?? null,
  });

  // rule.toString() returns something like:
  //   "DTSTART:20260102T100000Z\nRRULE:FREQ=WEEKLY;BYDAY=FR"
  // We only want the RRULE body.
  return extractRRuleBody(rule.toString());
}

// ── parseRRule ──────────────────────────────────────────────────────────────

export function parseRRule(rrule: string): RecurrenceValue | null {
  const body = stripRRulePrefix((rrule ?? '').trim());
  if (!body) return null;

  let options;
  try {
    options = RRule.parseString(body);
  } catch {
    return null;
  }

  if (options.freq === undefined || options.freq === null) return null;

  const preset = detectPreset(options);
  const until = options.until
    ? toIsoDate(options.until as Date)
    : null;
  const count = typeof options.count === 'number' ? options.count : null;

  return {
    preset,
    rrule: body,
    until,
    count,
  };
}

type ParsedOptions = ReturnType<typeof RRule.parseString>;

function detectPreset(opts: ParsedOptions): RecurrencePreset {
  const interval = opts.interval ?? 1;
  const byday = normalizeByWeekday(opts.byweekday);

  if (interval !== 1) return 'custom';

  // Daily, no BYDAY
  if (opts.freq === RRule.DAILY && (!byday || byday.length === 0)) {
    return 'daily';
  }

  // Weekly
  if (opts.freq === RRule.WEEKLY) {
    if (!byday || byday.length === 0) return 'weekly';
    if (isWeekdaysSet(byday)) return 'weekdays';
    if (byday.length >= 1) return 'weekly';
  }

  // Monthly, no BYMONTHDAY/BYDAY constraints
  if (
    opts.freq === RRule.MONTHLY &&
    (!byday || byday.length === 0) &&
    !opts.bymonthday
  ) {
    return 'monthly';
  }

  return 'custom';
}

function normalizeByWeekday(value: ParsedOptions['byweekday']): string[] | null {
  if (value == null) return null;
  const arr = Array.isArray(value) ? value : [value];
  const codes: string[] = [];
  for (const v of arr) {
    if (typeof v === 'number') {
      if (v >= 0 && v <= 6) {
        const code = WEEKDAY_CODE_ORDER[v];
        if (code) codes.push(code);
      }
    } else if (v && typeof (v as Weekday).toString === 'function') {
      // rrule Weekday#toString() returns e.g. "MO"
      codes.push((v as Weekday).toString().toUpperCase());
    }
  }
  return codes;
}

function isWeekdaysSet(codes: string[]): boolean {
  if (codes.length !== 5) return false;
  const set = new Set(codes);
  return ['MO', 'TU', 'WE', 'TH', 'FR'].every((c) => set.has(c));
}

// ── describeRRule ───────────────────────────────────────────────────────────

const IT_WEEKDAY_LONG: Record<string, string> = {
  MO: 'lunedì',
  TU: 'martedì',
  WE: 'mercoledì',
  TH: 'giovedì',
  FR: 'venerdì',
  SA: 'sabato',
  SU: 'domenica',
};
const EN_WEEKDAY_LONG: Record<string, string> = {
  MO: 'Monday',
  TU: 'Tuesday',
  WE: 'Wednesday',
  TH: 'Thursday',
  FR: 'Friday',
  SA: 'Saturday',
  SU: 'Sunday',
};

export function describeRRule(
  rrule: string,
  locale: 'it' | 'en',
  _dtstart?: Date,
): string {
  const body = stripRRulePrefix((rrule ?? '').trim());
  if (!body) return '';

  let options: ParsedOptions;
  try {
    options = RRule.parseString(body);
  } catch {
    return locale === 'it' ? 'Regola non valida' : 'Invalid rule';
  }

  const interval = options.interval ?? 1;
  const byday = normalizeByWeekday(options.byweekday) ?? [];

  let base: string;
  if (options.freq === RRule.DAILY) {
    base = locale === 'it' ? everyDayIt(interval) : everyDayEn(interval);
  } else if (options.freq === RRule.WEEKLY) {
    if (isWeekdaysSet(byday)) {
      base = locale === 'it' ? 'Tutti i giorni feriali' : 'Every weekday';
    } else if (byday.length > 0) {
      const names = byday
        .map((c) =>
          locale === 'it' ? IT_WEEKDAY_LONG[c] : EN_WEEKDAY_LONG[c],
        )
        .filter((n): n is string => typeof n === 'string');
      base =
        locale === 'it'
          ? `Ogni ${joinList(names, 'it')}`
          : `Every ${joinList(names, 'en')}`;
    } else {
      base = locale === 'it' ? everyWeekIt(interval) : everyWeekEn(interval);
    }
  } else if (options.freq === RRule.MONTHLY) {
    base = locale === 'it' ? everyMonthIt(interval) : everyMonthEn(interval);
  } else if (options.freq === RRule.YEARLY) {
    base = locale === 'it' ? everyYearIt(interval) : everyYearEn(interval);
  } else {
    return body;
  }

  const tail: string[] = [];
  if (options.until instanceof Date) {
    const dateLabel = formatLongDate(options.until, locale);
    tail.push(locale === 'it' ? `fino al ${dateLabel}` : `until ${dateLabel}`);
  } else if (typeof options.count === 'number') {
    tail.push(
      locale === 'it'
        ? `per ${options.count} ${options.count === 1 ? 'volta' : 'volte'}`
        : `for ${options.count} ${options.count === 1 ? 'occurrence' : 'occurrences'}`,
    );
  }

  return tail.length > 0 ? `${base} ${tail.join(' ')}` : base;
}

function everyDayIt(interval: number): string {
  return interval === 1 ? 'Ogni giorno' : `Ogni ${interval} giorni`;
}
function everyDayEn(interval: number): string {
  return interval === 1 ? 'Every day' : `Every ${interval} days`;
}
function everyWeekIt(interval: number): string {
  return interval === 1 ? 'Ogni settimana' : `Ogni ${interval} settimane`;
}
function everyWeekEn(interval: number): string {
  return interval === 1 ? 'Every week' : `Every ${interval} weeks`;
}
function everyMonthIt(interval: number): string {
  return interval === 1 ? 'Ogni mese' : `Ogni ${interval} mesi`;
}
function everyMonthEn(interval: number): string {
  return interval === 1 ? 'Every month' : `Every ${interval} months`;
}
function everyYearIt(interval: number): string {
  return interval === 1 ? 'Ogni anno' : `Ogni ${interval} anni`;
}
function everyYearEn(interval: number): string {
  return interval === 1 ? 'Every year' : `Every ${interval} years`;
}

function joinList(items: string[], locale: 'it' | 'en'): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0] ?? '';
  const last = items[items.length - 1] ?? '';
  const rest = items.slice(0, -1).join(', ');
  return locale === 'it' ? `${rest} e ${last}` : `${rest} and ${last}`;
}

function formatLongDate(date: Date, locale: 'it' | 'en'): string {
  return new Intl.DateTimeFormat(locale === 'it' ? 'it-IT' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

// ── nextOccurrences ─────────────────────────────────────────────────────────

export function nextOccurrences(
  rrule: string,
  dtstart: Date,
  limit: number,
): Date[] {
  const body = stripRRulePrefix((rrule ?? '').trim());
  if (!body || limit <= 0) return [];

  let options: ParsedOptions;
  try {
    options = RRule.parseString(body);
  } catch {
    return [];
  }

  try {
    // The RRULE string alone doesn't carry DTSTART, so attach the caller's.
    const rule = new RRule({ ...options, dtstart });

    // If the rule has a COUNT or UNTIL, let it bound naturally; otherwise cap at `limit`.
    if (typeof options.count === 'number' || options.until instanceof Date) {
      const all = rule.all();
      return all.slice(0, limit);
    }
    return rule.all((_d, i) => i < limit);
  } catch {
    return [];
  }
}

/**
 * First occurrence strictly after `after`, or null.
 *
 * Distinct from `nextOccurrences(...).find(d => d > now)`: that enumerates from
 * DTSTART, so a series already past the requested limit returns only past dates
 * and the caller silently falls back to them. `RRule.after` seeks instead of
 * enumerating, so it is correct however long the series has been running (and
 * cheap for a daily rule started years ago).
 */
export function nextOccurrenceAfter(rrule: string, dtstart: Date, after: Date): Date | null {
  const body = stripRRulePrefix((rrule ?? '').trim());
  if (!body) return null;
  try {
    const options = RRule.parseString(body);
    return new RRule({ ...options, dtstart }).after(after) ?? null;
  } catch {
    return null;
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function stripRRulePrefix(input: string): string {
  if (!input) return '';
  // Remove leading "RRULE:" (case-insensitive) and any DTSTART:...\n prefix line.
  let body = input;
  // If multi-line (DTSTART:...\nRRULE:...), take the RRULE line.
  if (body.includes('\n')) {
    const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
    const rruleLine = lines.find((l) => l.toUpperCase().startsWith('RRULE:'));
    body = rruleLine ?? lines[lines.length - 1] ?? '';
  }
  body = body.replace(/^RRULE:/i, '').trim();
  return body;
}

function extractRRuleBody(fullString: string): string {
  return stripRRulePrefix(fullString);
}

function toIsoDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
