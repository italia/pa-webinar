/**
 * Quale promemoria di un evento mandare in un giro del cron, e a chi.
 *
 * Un promemoria scatta a `startsAt - offsetMinutes`. Prima il cron mandava
 * ogni promemoria scattato a chiunque non l'avesse ancora ricevuto, tutti
 * nello stesso giro. Succedeva ogni volta che un evento nasceva a meno di un
 * giorno dall'inizio, o che qualcuno si iscriveva tardi: nello stesso minuto
 * arrivavano «inizia domani», «inizia tra 1 ora» e «inizia tra 30 minuti», a
 * pochi minuti dall'inizio.
 *
 * Regole:
 *   - per evento conta solo il promemoria CORRENTE, quello scattato con
 *     l'anticipo minore: e' il piu' vicino al tempo che manca davvero, quindi
 *     il testo («tra 30 minuti») e' quello giusto. Quelli scattati prima sono
 *     superati. Con la data fissa un promemoria superato non torna mai
 *     corrente (l'insieme degli scattati cresce soltanto), quindi non parte
 *     piu', senza bisogno di segnarlo: una riga ReminderSent vuol dire
 *     «spedito», e il pannello dell'evento la conta come tale;
 *   - il promemoria corrente va solo a chi era iscritto quando e' scattato:
 *     chi si iscrive dopo ha appena ricevuto la conferma;
 *   - un promemoria creato dopo il suo momento (evento creato a meno di un
 *     giorno dall'inizio, promemoria aggiunto tardi) non parte: era gia'
 *     scaduto quando e' nato.
 * Se l'evento viene rinviato, un promemoria superato puo' tornare corrente
 * alla nuova data e partire allora: e' il momento giusto per il suo testo.
 */

export interface PlannableReminder {
  id: string;
  offsetMinutes: number;
  createdAt: Date;
}

export function reminderTriggerAt(startsAt: Date, offsetMinutes: number): Date {
  return new Date(startsAt.getTime() - offsetMinutes * 60_000);
}

/**
 * Il promemoria corrente dell'evento, se c'e' e se puo' ancora partire.
 *
 * `null` quando l'evento e' gia' iniziato, quando nessun promemoria e'
 * scattato, o quando quello corrente era gia' scaduto alla sua creazione.
 * `sendTo` e' il limite sulle iscrizioni: solo chi si e' iscritto entro quel
 * momento lo riceve.
 */
export function currentReminder<R extends PlannableReminder>(
  reminders: readonly R[],
  startsAt: Date,
  now: Date,
): { reminder: R; registeredBy: Date } | null {
  if (startsAt <= now) return null;
  let current: R | null = null;
  for (const r of reminders) {
    if (reminderTriggerAt(startsAt, r.offsetMinutes) > now) continue;
    if (!current || r.offsetMinutes < current.offsetMinutes) current = r;
  }
  if (!current) return null;
  const triggerAt = reminderTriggerAt(startsAt, current.offsetMinutes);
  if (triggerAt < current.createdAt) return null;
  return { reminder: current, registeredBy: triggerAt };
}
