import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TIMEZONE,
  formatDuration,
  formatDate,
  formatTime,
  toDatetimeLocalInTz,
  fromDatetimeLocalInTz,
} from './date-format';

// ── formatDuration ──────────────────────────────────────────

describe('formatDuration', () => {
  it('formats hours and minutes', () => {
    const start = new Date('2026-01-15T10:00:00Z');
    const end = new Date('2026-01-15T12:30:00Z');
    expect(formatDuration(start, end)).toBe('2h 30min');
  });

  it('formats exact hours', () => {
    const start = new Date('2026-01-15T10:00:00Z');
    const end = new Date('2026-01-15T12:00:00Z');
    expect(formatDuration(start, end)).toBe('2h');
  });

  it('formats minutes only', () => {
    const start = new Date('2026-01-15T10:00:00Z');
    const end = new Date('2026-01-15T10:45:00Z');
    expect(formatDuration(start, end)).toBe('45min');
  });
});

// ── toDatetimeLocalInTz ─────────────────────────────────────

describe('toDatetimeLocalInTz', () => {
  it('converts UTC midnight to CET +1 (winter)', () => {
    const utcMidnight = new Date('2026-01-15T00:00:00Z');
    const result = toDatetimeLocalInTz(utcMidnight, 'Europe/Rome');
    expect(result).toBe('2026-01-15T01:00');
  });

  it('converts UTC midnight to CEST +2 (summer)', () => {
    const utcMidnight = new Date('2026-07-15T00:00:00Z');
    const result = toDatetimeLocalInTz(utcMidnight, 'Europe/Rome');
    expect(result).toBe('2026-07-15T02:00');
  });

  it('converts UTC midnight to EST -5', () => {
    const utcMidnight = new Date('2026-01-15T00:00:00Z');
    const result = toDatetimeLocalInTz(utcMidnight, 'America/New_York');
    expect(result).toBe('2026-01-14T19:00');
  });

  it('converts UTC midnight to EDT -4 (summer)', () => {
    const utcMidnight = new Date('2026-07-15T00:00:00Z');
    const result = toDatetimeLocalInTz(utcMidnight, 'America/New_York');
    expect(result).toBe('2026-07-14T20:00');
  });

  it('handles UTC timezone', () => {
    const date = new Date('2026-03-10T14:30:00Z');
    expect(toDatetimeLocalInTz(date, 'UTC')).toBe('2026-03-10T14:30');
  });

  it('produces YYYY-MM-DDTHH:mm format', () => {
    const date = new Date('2026-06-01T08:05:00Z');
    const result = toDatetimeLocalInTz(date, 'UTC');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
});

// ── fromDatetimeLocalInTz ───────────────────────────────────

describe('fromDatetimeLocalInTz', () => {
  it('parses wall time in CET to UTC (winter)', () => {
    const result = fromDatetimeLocalInTz('2026-01-15T10:00', 'Europe/Rome');
    expect(result.toISOString()).toBe('2026-01-15T09:00:00.000Z');
  });

  it('parses wall time in CEST to UTC (summer)', () => {
    const result = fromDatetimeLocalInTz('2026-07-15T10:00', 'Europe/Rome');
    expect(result.toISOString()).toBe('2026-07-15T08:00:00.000Z');
  });

  it('parses wall time in EST to UTC', () => {
    const result = fromDatetimeLocalInTz('2026-01-15T19:00', 'America/New_York');
    expect(result.toISOString()).toBe('2026-01-16T00:00:00.000Z');
  });

  it('parses UTC wall time', () => {
    const result = fromDatetimeLocalInTz('2026-03-10T14:30', 'UTC');
    expect(result.toISOString()).toBe('2026-03-10T14:30:00.000Z');
  });

  it('handles Asia/Tokyo (+9, no DST)', () => {
    const result = fromDatetimeLocalInTz('2026-04-01T09:00', 'Asia/Tokyo');
    expect(result.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });
});

// ── roundtrip: toDatetimeLocalInTz <-> fromDatetimeLocalInTz ─

describe('timezone roundtrip', () => {
  const timezones = ['Europe/Rome', 'America/New_York', 'Asia/Tokyo', 'UTC', 'Pacific/Auckland'];
  const dates = [
    new Date('2026-01-15T12:00:00Z'),
    new Date('2026-07-15T12:00:00Z'),
    new Date('2026-03-29T01:30:00Z'),
    new Date('2026-10-25T01:30:00Z'),
  ];

  for (const tz of timezones) {
    for (const date of dates) {
      it(`roundtrips ${date.toISOString()} in ${tz}`, () => {
        const local = toDatetimeLocalInTz(date, tz);
        const back = fromDatetimeLocalInTz(local, tz);
        expect(back.getTime()).toBe(date.getTime());
      });
    }
  }
});

// ── formatTime with timezone ────────────────────────────────

describe('formatTime', () => {
  it('uses default timezone (Europe/Rome) when none specified', () => {
    const winter = new Date('2026-01-15T12:00:00Z');
    const result = formatTime(winter, 'it');
    expect(result).toBe('13:00');
  });

  it('respects explicit timezone', () => {
    const date = new Date('2026-01-15T12:00:00Z');
    const rome = formatTime(date, 'it', 'Europe/Rome');
    const ny = formatTime(date, 'it', 'America/New_York');
    expect(rome).toBe('13:00');
    expect(ny).toBe('07:00');
  });

  it('handles summer time (CEST)', () => {
    const summer = new Date('2026-07-15T12:00:00Z');
    const result = formatTime(summer, 'it', 'Europe/Rome');
    expect(result).toBe('14:00');
  });
});

// ── formatDate with timezone ────────────────────────────────

describe('formatDate', () => {
  it('uses default timezone when none specified', () => {
    const date = new Date('2026-01-15T23:30:00Z');
    const result = formatDate(date, 'it');
    // 23:30 UTC = 00:30 CET on Jan 16
    expect(result).toContain('16');
    expect(result).toContain('2026');
  });

  it('respects explicit timezone', () => {
    const date = new Date('2026-01-15T23:30:00Z');
    const utcResult = formatDate(date, 'en', 'UTC');
    const romeResult = formatDate(date, 'en', 'Europe/Rome');
    // UTC: still Jan 15; Rome: Jan 16
    expect(utcResult).toContain('15');
    expect(romeResult).toContain('16');
  });
});

// ── DEFAULT_TIMEZONE ────────────────────────────────────────

describe('DEFAULT_TIMEZONE', () => {
  it('is Europe/Rome', () => {
    expect(DEFAULT_TIMEZONE).toBe('Europe/Rome');
  });
});
