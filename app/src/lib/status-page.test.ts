import { beforeEach, describe, expect, it, vi } from 'vitest';

const { siteSettings, isAdmin, cookieStore } = vi.hoisted(() => ({
  siteSettings: { statusPageEnabled: true },
  isAdmin: vi.fn(),
  cookieStore: {},
}));

vi.mock('@/lib/settings', () => ({ getSettings: async () => siteSettings }));
vi.mock('@/lib/auth/admin-session', () => ({ isAdminAuthenticated: isAdmin }));
vi.mock('next/headers', () => ({ cookies: async () => cookieStore }));

import { statusDataAccess, statusDataVisible } from './status-page';

beforeEach(() => {
  vi.clearAllMocks();
  siteSettings.statusPageEnabled = true;
  isAdmin.mockResolvedValue(false);
});

describe('statusDataVisible', () => {
  it('pagina accesa: i dati sono pubblici, senza guardare la sessione', async () => {
    await expect(statusDataVisible()).resolves.toBe(true);
    expect(isAdmin).not.toHaveBeenCalled();
  });

  it('pagina spenta: il pubblico non li vede', async () => {
    siteSettings.statusPageEnabled = false;
    await expect(statusDataVisible()).resolves.toBe(false);
  });

  it("pagina spenta: l'amministratore li vede ancora (mappa dell'infrastruttura)", async () => {
    siteSettings.statusPageEnabled = false;
    isAdmin.mockResolvedValue(true);
    await expect(statusDataVisible()).resolves.toBe(true);
    expect(isAdmin).toHaveBeenCalledWith(cookieStore);
  });
});

describe('statusDataAccess', () => {
  it('pagina accesa: pubblico, la risposta può stare in una cache condivisa', async () => {
    await expect(statusDataAccess()).resolves.toBe('public');
  });

  it("pagina spenta: solo l'amministratore, la risposta dipende dal suo cookie", async () => {
    siteSettings.statusPageEnabled = false;
    isAdmin.mockResolvedValue(true);
    await expect(statusDataAccess()).resolves.toBe('admin');
  });

  it('pagina spenta e nessuna sessione: nessuno', async () => {
    siteSettings.statusPageEnabled = false;
    await expect(statusDataAccess()).resolves.toBe('none');
  });
});
