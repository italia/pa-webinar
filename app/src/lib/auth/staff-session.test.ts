// @vitest-environment node
import { SignJWT } from 'jose';
import { beforeEach, describe, it, expect, vi } from 'vitest';

const findUnique = vi.fn();
vi.mock('@/lib/db', () => ({ prisma: { staffAccount: { findUnique: (...a: unknown[]) => findUnique(...a) } } }));
vi.mock('react', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  // Senza un renderer React `cache` non memorizza nulla: qui basta la funzione.
  cache: <T,>(fn: T) => fn,
}));

import {
  canManageEvent,
  eventScope,
  getStaffSession,
  signStaffSession,
  type StaffSession,
} from './staff-session';

const admin: StaffSession = { role: 'admin', accountId: null };
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

describe('la sessione rilegge l’account (ADR-014)', () => {
  const SECRET = 'x'.repeat(40);
  const ID = '11111111-2222-4333-8444-555555555555';
  const cookiesCon = (token: string) =>
    ({ get: (n: string) => (n === 'admin_session' ? { value: token } : undefined) }) as never;

  beforeEach(() => {
    process.env.APP_SECRET = SECRET;
    findUnique.mockReset();
  });

  it('la chiave dell’istanza è un admin senza account', async () => {
    const token = await new SignJWT({ role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    expect(await getStaffSession(cookiesCon(token))).toEqual({ role: 'admin', accountId: null });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('un account amministratore è admin con il suo nome', async () => {
    findUnique.mockResolvedValue({ id: ID, active: true, role: 'ADMIN' });
    const token = await signStaffSession({ id: ID, role: 'ADMIN' });
    expect(await getStaffSession(cookiesCon(token))).toEqual({ role: 'admin', accountId: ID });
  });

  it('il ruolo viene dall’account, non dal token: un admin declassato è organizzatore', async () => {
    findUnique.mockResolvedValue({ id: ID, active: true, role: 'ORGANIZER' });
    const token = await signStaffSession({ id: ID, role: 'ADMIN' });
    expect(await getStaffSession(cookiesCon(token))).toEqual({ role: 'organizer', accountId: ID });
  });

  it('un account disattivato non ha sessione, qualunque sia il token', async () => {
    findUnique.mockResolvedValue({ id: ID, active: false, role: 'ADMIN' });
    const token = await signStaffSession({ id: ID, role: 'ADMIN' });
    expect(await getStaffSession(cookiesCon(token))).toBeNull();
  });
});
