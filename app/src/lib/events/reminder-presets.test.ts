import { describe, expect, it } from 'vitest';

import messages from '@/i18n/messages/it.json';
import { VALID_OFFSETS } from '@/lib/validation/schemas';

import { REMINDER_PRESETS, reminderPresetKey } from './reminder-presets';

describe('reminder-presets', () => {
  it('la rotta accetta esattamente questi scarti', () => {
    expect(VALID_OFFSETS).toEqual(REMINDER_PRESETS.map((p) => p.offsetMinutes));
  });

  it('ogni scarto ha il suo testo', () => {
    for (const { key } of REMINDER_PRESETS) {
      expect(messages.reminders.presets[key]).toBeTruthy();
    }
  });

  it('uno scarto fuori dall\'elenco non ha chiave', () => {
    expect(reminderPresetKey(1440)).toBe('1day');
    expect(reminderPresetKey(45)).toBeNull();
  });
});
