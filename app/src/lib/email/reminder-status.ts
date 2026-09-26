/**
 * Cosa dire, nel pannello dell'evento, di un promemoria non ancora spedito.
 *
 * Segue le regole del cron (lib/email/reminder-plan): per evento parte solo il
 * promemoria corrente, a chi era iscritto quando e' scattato. «Non inviato»
 * da solo non distingue quindi «deve ancora partire» da «non partira' piu'»:
 *   - `scheduled`: il suo momento non e' ancora arrivato;
 *   - `soon`: e' il promemoria corrente e qualcuno lo aspetta, parte al
 *     prossimo giro del cron;
 *   - `missed`: non partira' piu' — l'evento e' gia' iniziato, un promemoria
 *     piu' vicino all'inizio lo ha superato, era gia' scaduto quando e' stato
 *     creato, o nessuno era iscritto quando e' scattato.
 */

import { currentReminder, reminderTriggerAt, type PlannableReminder } from './reminder-plan';

export type UnsentReminderState = 'scheduled' | 'soon' | 'missed';

export function unsentReminderState(
  reminder: PlannableReminder,
  reminders: readonly PlannableReminder[],
  startsAt: Date,
  now: Date,
  /** Quando si sono iscritte le persone dell'evento. */
  registeredAt: readonly Date[],
): UnsentReminderState {
  if (startsAt <= now) return 'missed';
  if (reminderTriggerAt(startsAt, reminder.offsetMinutes) > now) return 'scheduled';
  const corrente = currentReminder(reminders, startsAt, now);
  if (!corrente || corrente.reminder.id !== reminder.id) return 'missed';
  return registeredAt.some((d) => d <= corrente.registeredBy) ? 'soon' : 'missed';
}
