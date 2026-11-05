/**
 * Fusi orari proposti nei menu (impostazioni del sito, evento). Un solo
 * elenco: se il fuso predefinito del sito non compare nel menu dell'evento,
 * il browser seleziona la prima voce e mostra un fuso diverso da quello
 * che viene salvato.
 */
export const COMMON_TIMEZONES = [
  'Europe/Rome',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Amsterdam',
  'Europe/Brussels',
  'Europe/Zurich',
  'Europe/Vienna',
  'Europe/Athens',
  'Europe/Bucharest',
  'Europe/Helsinki',
  'Europe/Lisbon',
  'Europe/Warsaw',
  'Europe/Prague',
  'Europe/Stockholm',
  'Europe/Oslo',
  'Europe/Copenhagen',
  'Europe/Dublin',
  'Europe/Istanbul',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC',
] as const;

/**
 * Le voci del menu per un valore dato: l'elenco comune, più il valore
 * stesso in testa se non ne fa parte (un evento salvato con un fuso che il
 * menu non propone deve restare quello che si vede).
 */
export function timezoneOptions(current: string | null | undefined): string[] {
  const list: string[] = [...COMMON_TIMEZONES];
  if (current && !list.includes(current)) list.unshift(current);
  return list;
}

/** Etichetta leggibile: `America/New_York` → `America/New York`. */
export function timezoneLabel(tz: string): string {
  return tz.replace(/_/g, ' ');
}
