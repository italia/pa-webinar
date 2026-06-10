import type { PlayerProfile } from './ports/types';

/**
 * Tiny, fault-tolerant local persistence adapter.
 *
 * Per the module rules we never use localStorage directly for *network* state.
 * The only things persisted here are local-user conveniences — the chosen
 * profile and whether onboarding was dismissed — and they go through this
 * adapter so the storage backend can be swapped (or disabled) in one place.
 */
const PREFIX = 'pawebinar.lobby.';

function read(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(PREFIX + key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(PREFIX + key, value);
  } catch {
    /* private mode / disabled storage — ignore */
  }
}

export interface PersistedProfile {
  name?: string;
  color?: string;
  accessories?: PlayerProfile['accessories'];
}

export const lobbyStorage = {
  getProfile(): PersistedProfile | null {
    const raw = read('profile');
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as PersistedProfile;
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  },

  setProfile(p: PersistedProfile): void {
    write('profile', JSON.stringify(p));
  },

  isOnboardingDismissed(): boolean {
    return read('onboardingDismissed') === '1';
  },

  setOnboardingDismissed(dismissed: boolean): void {
    write('onboardingDismissed', dismissed ? '1' : '0');
  },
};
