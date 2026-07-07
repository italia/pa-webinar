import { describe, it, expect } from 'vitest';

import { resolveWaitingRoomMode } from './resolve-engine';

const base = {
  configured: 'GARDEN' as const,
  urlEngine: null as string | null,
  isPhone: false,
  classicPref: false,
};

describe('resolveWaitingRoomMode', () => {
  it('usa il motore configurato quando non ci sono override', () => {
    expect(resolveWaitingRoomMode({ ...base, configured: 'GAME' })).toBe('GAME');
    expect(resolveWaitingRoomMode({ ...base, configured: 'CLASSIC' })).toBe('CLASSIC');
    expect(resolveWaitingRoomMode(base)).toBe('GARDEN');
  });

  it('?engine= ha la precedenza su tutto', () => {
    expect(resolveWaitingRoomMode({ ...base, urlEngine: 'phaser' })).toBe('GAME');
    expect(resolveWaitingRoomMode({ ...base, urlEngine: 'svg' })).toBe('GARDEN');
    expect(resolveWaitingRoomMode({ ...base, urlEngine: 'classic' })).toBe('CLASSIC');
  });

  it('?engine=phaser VINCE su una preferenza classic salvata (il bug che correggiamo)', () => {
    expect(
      resolveWaitingRoomMode({
        ...base,
        configured: 'CLASSIC',
        urlEngine: 'phaser',
        classicPref: true,
        isPhone: true,
      }),
    ).toBe('GAME');
  });

  it('senza override, telefono e preferenza classic forzano CLASSIC', () => {
    expect(resolveWaitingRoomMode({ ...base, configured: 'GAME', isPhone: true })).toBe(
      'CLASSIC',
    );
    expect(
      resolveWaitingRoomMode({ ...base, configured: 'GAME', classicPref: true }),
    ).toBe('CLASSIC');
  });

  it('un urlEngine sconosciuto viene ignorato (fallback al configurato)', () => {
    expect(resolveWaitingRoomMode({ ...base, configured: 'GAME', urlEngine: 'xyz' })).toBe(
      'GAME',
    );
  });
});
