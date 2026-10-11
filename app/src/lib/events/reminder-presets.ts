/**
 * I momenti in cui un evento puo' mandare una notifica a chi si e' iscritto:
 * lo scarto dall'inizio, la chiave del testo (`reminders.presets.*`) e
 * l'etichetta italiana che la rotta scrive in `EventReminder.label` alla
 * creazione. Il nome mostrato si scrive dalla chiave, nella lingua di chi
 * guarda. Un elenco solo, per la rotta (lib/validation/schemas) e per la
 * pagina dell'evento.
 */
export const REMINDER_PRESETS = [
  { offsetMinutes: 10080, key: '7days', labelIt: '7 giorni prima' },
  { offsetMinutes: 4320, key: '3days', labelIt: '3 giorni prima' },
  { offsetMinutes: 1440, key: '1day', labelIt: '1 giorno prima' },
  { offsetMinutes: 720, key: '12hours', labelIt: '12 ore prima' },
  { offsetMinutes: 360, key: '6hours', labelIt: '6 ore prima' },
  { offsetMinutes: 180, key: '3hours', labelIt: '3 ore prima' },
  { offsetMinutes: 60, key: '1hour', labelIt: '1 ora prima' },
  { offsetMinutes: 30, key: '30min', labelIt: '30 minuti prima' },
  { offsetMinutes: 15, key: '15min', labelIt: '15 minuti prima' },
] as const;

export type ReminderPresetKey = (typeof REMINDER_PRESETS)[number]['key'];

/** Quanti promemoria al massimo per evento. */
export const MAX_REMINDERS = 5;

/** La chiave del testo per uno scarto, se e' uno di quelli previsti. */
export function reminderPresetKey(offsetMinutes: number): ReminderPresetKey | null {
  return REMINDER_PRESETS.find((p) => p.offsetMinutes === offsetMinutes)?.key ?? null;
}
