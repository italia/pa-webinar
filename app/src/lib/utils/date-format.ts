type Locale = 'it' | 'en';

export function formatDuration(startsAt: Date, endsAt: Date): string {
  const diffMs = endsAt.getTime() - startsAt.getTime();
  const hours = Math.floor(diffMs / 3_600_000);
  const minutes = Math.floor((diffMs % 3_600_000) / 60_000);
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}min`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}min`;
}

export function formatDate(date: Date, locale: Locale): string {
  return date.toLocaleDateString(locale === 'it' ? 'it-IT' : 'en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function formatTime(date: Date, locale: Locale): string {
  return date.toLocaleTimeString(locale === 'it' ? 'it-IT' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Rome',
  });
}
