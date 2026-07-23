/**
 * Resolve which waiting-room view to render, from the configured default
 * (admin site + per-event) and the client-side signals. Kept pure so the
 * precedence is unit-testable independent of the React effect that gathers the
 * inputs (window.location, localStorage, matchMedia).
 *
 * Precedence (highest first):
 *   1. explicit `?engine=` override (debug / opt-in escape hatch) — wins over
 *      the phone default AND a saved classic preference;
 *   2. the configured engine, then narrowed to CLASSIC when on a phone or when
 *      the user saved the "Versione classica" accessibility preference.
 *
 * There are only TWO outcomes, because there is only one game left: the piazza
 * is either available (GAME) or it isn't (CLASSIC). GARDEN was the minimal SVG
 * scene, deleted in C1; stored rows and `?engine=svg` links still say GARDEN,
 * so it is normalised here rather than left to mean two different things in
 * different call sites.
 */
export type WaitingRoomEngine = 'GARDEN' | 'GAME' | 'CLASSIC';
export type WaitingRoomMode = 'GAME' | 'CLASSIC';

export function resolveWaitingRoomMode(opts: {
  configured: WaitingRoomEngine;
  /** Raw `?engine=` value: 'phaser' | 'svg' | 'classic' | null. */
  urlEngine: string | null;
  isPhone: boolean;
  classicPref: boolean;
}): WaitingRoomMode {
  const { configured, urlEngine, isPhone, classicPref } = opts;

  // 1) Explicit URL override wins over everything. `svg` is the legacy name of
  //    the deleted garden: it now lands on the piazza, the only game there is.
  if (urlEngine === 'phaser' || urlEngine === 'svg') return 'GAME';
  if (urlEngine === 'classic') return 'CLASSIC';

  // 2) Configured default, narrowed to the accessible card on phones or when
  //    the user opted into the classic view.
  if (isPhone || classicPref) return 'CLASSIC';
  return configured === 'CLASSIC' ? 'CLASSIC' : 'GAME';
}
