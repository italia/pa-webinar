// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { describe, expect, it } from 'vitest';

import {
  durataAmmessa,
  durataEffettiva,
  limiteDurataPrecedente,
} from './legacy-retention';

const vecchio = {
  legacyRecordingRetention: true,
  recordingPublished: false,
  dataRetentionDays: 30,
};

describe('la durata negli eventi nati prima della regola', () => {
  it('non pubblicata ha per limite la conservazione dei dati', () => {
    expect(limiteDurataPrecedente(vecchio)).toBe(30);
    expect(limiteDurataPrecedente({ ...vecchio, recordingPublished: true })).toBeNull();
    expect(
      limiteDurataPrecedente({ ...vecchio, legacyRecordingRetention: false })
    ).toBeNull();
  });

  it('vale la piu’ corta fra la scelta e la promessa', () => {
    expect(durataEffettiva({ ...vecchio, recordingDeleteAfterDays: null })).toBe(30);
    expect(durataEffettiva({ ...vecchio, recordingDeleteAfterDays: 90 })).toBe(30);
    expect(durataEffettiva({ ...vecchio, recordingDeleteAfterDays: 7 })).toBe(7);
    expect(
      durataEffettiva({
        ...vecchio,
        recordingPublished: true,
        recordingDeleteAfterDays: null,
      })
    ).toBeNull();
  });

  it('si accorcia, non si toglie ne’ si allunga', () => {
    expect(durataAmmessa(vecchio, 7)).toBe(true);
    expect(durataAmmessa(vecchio, 30)).toBe(true);
    expect(durataAmmessa(vecchio, 31)).toBe(false);
    expect(durataAmmessa(vecchio, null)).toBe(false);
    expect(durataAmmessa({ ...vecchio, recordingPublished: true }, null)).toBe(true);
  });
});
