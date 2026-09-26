import { describe, expect, it } from 'vitest';

import { currentReminder } from './reminder-plan';

const START = new Date('2026-09-25T21:48:00Z');
const min = (m: number) => new Date(START.getTime() - m * 60_000);

/** Promemoria creati con l'evento, `createdMinutesBefore` minuti prima dell'inizio. */
function reminders(createdMinutesBefore: number) {
  const createdAt = min(createdMinutesBefore);
  return {
    DAY: { id: 'r-1440', offsetMinutes: 1440, createdAt },
    HOUR: { id: 'r-60', offsetMinutes: 60, createdAt },
    HALF: { id: 'r-30', offsetMinutes: 30, createdAt },
  };
}

describe('currentReminder', () => {
  it('picks the due reminder with the smallest offset: the others are superseded', () => {
    const { DAY, HOUR, HALF } = reminders(5000);
    expect(currentReminder([DAY, HOUR, HALF], START, min(29))).toEqual({
      reminder: HALF,
      registeredBy: min(30),
    });
    // Tra il 60 e il 30 e' corrente il 60; il 1440 e' superato.
    expect(currentReminder([DAY, HOUR, HALF], START, min(45))?.reminder).toBe(HOUR);
  });

  it('never makes a superseded reminder current again while the date is fixed', () => {
    const { DAY, HOUR, HALF } = reminders(5000);
    const seen = new Set<string>();
    for (let m = 1500; m > 0; m -= 5) {
      const c = currentReminder([DAY, HOUR, HALF], START, min(m));
      if (c) seen.add(c.reminder.id);
      // Una volta scattato il 60, il 1440 non torna piu' corrente.
      if (m <= 60) expect(c?.reminder).not.toBe(DAY);
    }
    expect([...seen].sort()).toEqual(['r-1440', 'r-30', 'r-60']);
  });

  it('event created less than 24 h ahead: the reminders already overdue at creation never go out', () => {
    // Evento (e promemoria) creati 40 minuti prima dell'inizio: il 1440 e il
    // 60 erano scaduti prima di nascere. Tra T-40 e T-30 non parte nulla,
    // poi solo il 30.
    const { DAY, HOUR, HALF } = reminders(40);
    expect(currentReminder([DAY, HOUR, HALF], START, min(35))).toBeNull();
    expect(currentReminder([DAY, HOUR, HALF], START, min(29))?.reminder).toBe(HALF);
  });

  it('returns nothing before the first trigger and after the start', () => {
    const { DAY, HOUR } = reminders(5000);
    expect(currentReminder([DAY, HOUR], START, min(2000))).toBeNull();
    expect(currentReminder([DAY, HOUR], START, new Date(START.getTime() + 60_000))).toBeNull();
    expect(currentReminder([], START, min(10))).toBeNull();
  });
});
