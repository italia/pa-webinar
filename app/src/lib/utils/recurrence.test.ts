import { describe, it, expect } from 'vitest';

import {
  buildRRule,
  parseRRule,
  describeRRule,
  nextOccurrences,
  jsWeekdayToRRule,
} from './recurrence';

// A Wednesday (2026-01-14 is a Wednesday) at 10:00 UTC.
const WED_10 = new Date('2026-01-14T10:00:00Z');
// A Friday at 10:00 UTC.
const FRI_10 = new Date('2026-01-16T10:00:00Z');

// ── Preset roundtrips ──────────────────────────────────────────────────────

describe('buildRRule + parseRRule roundtrip', () => {
  it('preset daily roundtrips', () => {
    const body = buildRRule({ preset: 'daily', dtstart: WED_10 });
    expect(body).toContain('FREQ=DAILY');
    const parsed = parseRRule(body);
    expect(parsed?.preset).toBe('daily');
  });

  it('preset weekly (default: dtstart weekday) roundtrips', () => {
    // dtstart is a Wednesday → BYDAY=WE
    const body = buildRRule({ preset: 'weekly', dtstart: WED_10 });
    expect(body).toContain('FREQ=WEEKLY');
    expect(body).toContain('BYDAY=WE');
    const parsed = parseRRule(body);
    expect(parsed?.preset).toBe('weekly');
  });

  it('preset weekly with explicit byWeekday=FR (caffettino!) roundtrips', () => {
    // 4 = Friday in RRULE convention (Mon=0..Sun=6)
    const body = buildRRule({ preset: 'weekly', dtstart: WED_10, byWeekday: [4] });
    expect(body).toContain('FREQ=WEEKLY');
    expect(body).toContain('BYDAY=FR');
    const parsed = parseRRule(body);
    expect(parsed?.preset).toBe('weekly');
  });

  it('preset weekdays generates BYDAY=MO,TU,WE,TH,FR and parses back', () => {
    const body = buildRRule({ preset: 'weekdays', dtstart: WED_10 });
    expect(body).toContain('FREQ=WEEKLY');
    expect(body).toMatch(/BYDAY=MO,TU,WE,TH,FR/);
    const parsed = parseRRule(body);
    expect(parsed?.preset).toBe('weekdays');
  });

  it('preset monthly roundtrips', () => {
    const body = buildRRule({ preset: 'monthly', dtstart: WED_10 });
    expect(body).toContain('FREQ=MONTHLY');
    const parsed = parseRRule(body);
    expect(parsed?.preset).toBe('monthly');
  });

  it('preset none returns empty string', () => {
    expect(buildRRule({ preset: 'none', dtstart: WED_10 })).toBe('');
  });

  it('UNTIL is emitted and parsed back', () => {
    const until = new Date('2026-12-31T23:59:59Z');
    const body = buildRRule({ preset: 'weekly', dtstart: WED_10, byWeekday: [4], until });
    expect(body).toContain('UNTIL=');
    const parsed = parseRRule(body);
    expect(parsed?.preset).toBe('weekly');
    expect(parsed?.until).toBe('2026-12-31');
  });

  it('COUNT is emitted and parsed back', () => {
    const body = buildRRule({ preset: 'weekly', dtstart: WED_10, byWeekday: [4], count: 12 });
    expect(body).toContain('COUNT=12');
    const parsed = parseRRule(body);
    expect(parsed?.count).toBe(12);
  });
});

// ── parseRRule failure modes ────────────────────────────────────────────────

describe('parseRRule error handling', () => {
  it('returns null for empty string', () => {
    expect(parseRRule('')).toBeNull();
  });

  it('returns null for garbage input', () => {
    expect(parseRRule('THIS IS NOT AN RRULE')).toBeNull();
  });

  it('returns null for RRULE with unknown FREQ', () => {
    expect(parseRRule('FREQ=BOGUS;BYDAY=FR')).toBeNull();
  });

  it('tolerates leading RRULE: prefix', () => {
    const parsed = parseRRule('RRULE:FREQ=DAILY');
    expect(parsed?.preset).toBe('daily');
  });

  it('falls back to custom when interval != 1', () => {
    const parsed = parseRRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=FR');
    expect(parsed?.preset).toBe('custom');
  });

  it('falls back to custom for unhandled shape (YEARLY)', () => {
    const parsed = parseRRule('FREQ=YEARLY');
    expect(parsed?.preset).toBe('custom');
  });
});

// ── describeRRule ───────────────────────────────────────────────────────────

describe('describeRRule', () => {
  it('describes weekly Friday with UNTIL in Italian', () => {
    const body = 'FREQ=WEEKLY;BYDAY=FR;UNTIL=20261231T235959Z';
    const text = describeRRule(body, 'it');
    expect(text.toLowerCase()).toContain('venerdì');
    expect(text).toContain('fino al');
    expect(text).toContain('2026');
  });

  it('describes weekly Friday with UNTIL in English', () => {
    const body = 'FREQ=WEEKLY;BYDAY=FR;UNTIL=20261231T235959Z';
    const text = describeRRule(body, 'en');
    expect(text.toLowerCase()).toContain('friday');
    expect(text.toLowerCase()).toContain('until');
  });

  it('describes daily no-end in Italian and English', () => {
    expect(describeRRule('FREQ=DAILY', 'it').toLowerCase()).toContain('ogni giorno');
    expect(describeRRule('FREQ=DAILY', 'en').toLowerCase()).toContain('every day');
  });

  it('describes COUNT in both locales', () => {
    const body = 'FREQ=WEEKLY;BYDAY=FR;COUNT=5';
    expect(describeRRule(body, 'it')).toMatch(/per 5 volte/);
    expect(describeRRule(body, 'en')).toMatch(/for 5 occurrences/);
  });

  it('describes weekdays as a single phrase', () => {
    const body = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
    expect(describeRRule(body, 'it').toLowerCase()).toContain('feriali');
    expect(describeRRule(body, 'en').toLowerCase()).toContain('weekday');
  });

  it('returns empty string for empty input', () => {
    expect(describeRRule('', 'it')).toBe('');
  });
});

// ── nextOccurrences ─────────────────────────────────────────────────────────

describe('nextOccurrences', () => {
  it('FREQ=WEEKLY;BYDAY=FR starting Wednesday: first hit is the next Friday', () => {
    const dates = nextOccurrences('FREQ=WEEKLY;BYDAY=FR', WED_10, 3);
    expect(dates.length).toBe(3);
    // 2026-01-14 is Wed; next Friday is 2026-01-16
    expect(dates[0]!.toISOString().slice(0, 10)).toBe('2026-01-16');
    // Subsequent Fridays 7 days apart
    expect(dates[1]!.toISOString().slice(0, 10)).toBe('2026-01-23');
    expect(dates[2]!.toISOString().slice(0, 10)).toBe('2026-01-30');
  });

  it('FREQ=WEEKLY;BYDAY=FR starting on Friday includes that Friday', () => {
    const dates = nextOccurrences('FREQ=WEEKLY;BYDAY=FR', FRI_10, 2);
    expect(dates[0]!.toISOString().slice(0, 10)).toBe('2026-01-16');
    expect(dates[1]!.toISOString().slice(0, 10)).toBe('2026-01-23');
  });

  it('FREQ=DAILY returns `limit` daily occurrences', () => {
    const dates = nextOccurrences('FREQ=DAILY', WED_10, 5);
    expect(dates).toHaveLength(5);
    expect(dates[0]!.toISOString().slice(0, 10)).toBe('2026-01-14');
    expect(dates[4]!.toISOString().slice(0, 10)).toBe('2026-01-18');
  });

  it('respects COUNT from the RRULE', () => {
    const dates = nextOccurrences('FREQ=WEEKLY;BYDAY=FR;COUNT=2', WED_10, 10);
    expect(dates).toHaveLength(2);
  });

  it('returns empty array for invalid rule', () => {
    expect(nextOccurrences('FREQ=BOGUS', WED_10, 5)).toEqual([]);
  });

  it('returns empty array for limit <= 0', () => {
    expect(nextOccurrences('FREQ=DAILY', WED_10, 0)).toEqual([]);
  });
});

// ── jsWeekdayToRRule ────────────────────────────────────────────────────────

describe('jsWeekdayToRRule', () => {
  it('maps Sunday (JS=0) → 6 (RRULE)', () => {
    expect(jsWeekdayToRRule(0)).toBe(6);
  });
  it('maps Monday (JS=1) → 0 (RRULE)', () => {
    expect(jsWeekdayToRRule(1)).toBe(0);
  });
  it('maps Friday (JS=5) → 4 (RRULE)', () => {
    expect(jsWeekdayToRRule(5)).toBe(4);
  });
});
