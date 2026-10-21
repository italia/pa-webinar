import { describe, expect, it } from 'vitest';

import { unisciZero } from './track-zero';

const t = (iso: string) => new Date(iso);

describe('unisciZero', () => {
  it('senza tracce salvate vale lo zero del manifest', () => {
    expect(
      unisciZero({
        esistente: t('2026-10-08T10:00:00Z'),
        conTracce: false,
        arrivoMs: Date.parse('2026-10-08T10:05:00Z'),
      })
    ).toEqual({
      zero: t('2026-10-08T10:05:00Z'),
      spostaEsistentiMs: 0,
      spostaNuoveMs: 0,
    });
    expect(
      unisciZero({ esistente: null, conTracce: true, arrivoMs: 1_700_000_000_000 }).zero
    ).toEqual(new Date(1_700_000_000_000));
  });

  it('un manifest piu recente si sposta sullo zero salvato', () => {
    expect(
      unisciZero({
        esistente: t('2026-10-08T10:00:00Z'),
        conTracce: true,
        arrivoMs: Date.parse('2026-10-08T10:25:00Z'),
      })
    ).toEqual({
      zero: t('2026-10-08T10:00:00Z'),
      spostaEsistentiMs: 0,
      spostaNuoveMs: 25 * 60_000,
    });
  });

  it('un manifest piu vecchio diventa lo zero e sposta le tracce salvate', () => {
    expect(
      unisciZero({
        esistente: t('2026-10-08T10:01:00Z'),
        conTracce: true,
        arrivoMs: Date.parse('2026-10-08T10:00:00Z'),
      })
    ).toEqual({
      zero: t('2026-10-08T10:00:00Z'),
      spostaEsistentiMs: 60_000,
      spostaNuoveMs: 0,
    });
  });
});
