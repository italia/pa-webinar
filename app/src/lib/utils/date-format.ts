type Locale = 'it' | 'en';

export const DEFAULT_TIMEZONE = 'Europe/Rome';

export function formatDuration(startsAt: Date, endsAt: Date): string {
  const diffMs = endsAt.getTime() - startsAt.getTime();
  const hours = Math.floor(diffMs / 3_600_000);
  const minutes = Math.floor((diffMs % 3_600_000) / 60_000);
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}min`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}min`;
}

export function formatDate(date: Date, locale: Locale, timeZone?: string): string {
  return date.toLocaleDateString(locale === 'it' ? 'it-IT' : 'en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: timeZone ?? DEFAULT_TIMEZONE,
  });
}

export function formatTime(date: Date, locale: Locale, timeZone?: string): string {
  return date.toLocaleTimeString(locale === 'it' ? 'it-IT' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timeZone ?? DEFAULT_TIMEZONE,
  });
}

/**
 * Convert a UTC Date to a `datetime-local` input value (YYYY-MM-DDTHH:mm)
 * displayed as wall-clock time in the given IANA timezone.
 */
export function toDatetimeLocalInTz(date: Date, tz: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value]),
  );
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}`;
}

/**
 * Parse a `datetime-local` value (YYYY-MM-DDTHH:mm) as wall-clock time
 * in the given IANA timezone and return a UTC Date.
 */
export function fromDatetimeLocalInTz(local: string, tz: string): Date {
  const iso = `${local}:00`;
  const guess = new Date(iso + 'Z');
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const wallAtGuess = fmt.format(guess).replace(', ', 'T');
  const offsetMs = new Date(wallAtGuess + 'Z').getTime() - guess.getTime();
  return new Date(new Date(iso + 'Z').getTime() - offsetMs);
}
