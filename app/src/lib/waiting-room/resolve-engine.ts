/**
 * Resolve which waiting-room engine/view to render, from the configured default
 * (admin site + per-event) and the client-side signals. Kept pure so the
 * precedence is unit-testable independent of the React effect that gathers the
 * inputs (window.location, localStorage, matchMedia).
 *
 * Precedence (highest first):
 *   1. explicit `?engine=` override (debug / opt-in escape hatch) — wins over
 *      the phone default AND a saved classic preference;
 *   2. the configured engine, then narrowed to CLASSIC when on a phone or when
 *      the user saved the "Versione classica" accessibility preference.
 */
export type WaitingRoomMode = 'GARDEN' | 'GAME' | 'CLASSIC';

export function resolveWaitingRoomMode(opts: {
  configured: WaitingRoomMode;
  /** Raw `?engine=` value: 'phaser' | 'svg' | 'classic' | null. */
  urlEngine: string | null;
  isPhone: boolean;
  classicPref: boolean;
}): WaitingRoomMode {
  const { configured, urlEngine, isPhone, classicPref } = opts;

  // 1) Explicit URL override wins over everything.
  if (urlEngine === 'phaser') return 'GAME';
  if (urlEngine === 'svg') return 'GARDEN';
  if (urlEngine === 'classic') return 'CLASSIC';

  // 2) Configured default, narrowed to the accessible card on phones or when
  //    the user opted into the classic view.
  let mode = configured;
  if (isPhone) mode = 'CLASSIC';
  if (classicPref) mode = 'CLASSIC';
  return mode;
}
