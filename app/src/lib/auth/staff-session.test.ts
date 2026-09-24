import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: {} }));

import { canManageEvent, eventScope, type StaffSession } from './staff-session';

const admin: StaffSession = { role: 'admin' };
const org: StaffSession = { role: 'organizer', accountId: 'a1' };

describe('chi gestisce un evento (ADR-014)', () => {
  it('l’admin gestisce tutto, anche gli eventi senza proprietario', () => {
    expect(canManageEvent(admin, { createdById: null })).toBe(true);
    expect(canManageEvent(admin, { createdById: 'altro' })).toBe(true);
  });

  it('l’organizzatore gestisce solo i propri', () => {
    expect(canManageEvent(org, { createdById: 'a1' })).toBe(true);
    expect(canManageEvent(org, { createdById: 'altro' })).toBe(false);
  });

  it('un evento senza proprietario è dell’amministrazione, non di chiunque', () => {
    // Gli eventi nati prima dei ruoli non hanno proprietario: se `null`
    // valesse come «di nessuno, quindi di tutti», ogni organizzatore li
    // vedrebbe tutti.
    expect(canManageEvent(org, { createdById: null })).toBe(false);
  });

  it('il filtro sugli elenchi segue la stessa regola', () => {
    expect(eventScope(admin)).toEqual({});
    expect(eventScope(org)).toEqual({ createdById: 'a1' });
  });
});
