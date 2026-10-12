// @vitest-environment node
import { SignJWT } from 'jose';
import { beforeEach, describe, it, expect, vi } from 'vitest';

const findUnique = vi.fn();
const eventCount = vi.fn();
vi.mock('@/lib/db', () => ({
  prisma: {
    staffAccount: { findUnique: (...a: unknown[]) => findUnique(...a) },
    event: { count: (...a: unknown[]) => eventCount(...a) },
  },
}));
vi.mock('react', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  // Senza un renderer React `cache` non memorizza nulla: qui basta la funzione.
  cache: <T,>(fn: T) => fn,
}));

import {
  eventScope,
  getStaffSession,
  puoGestire,
  signStaffSession,
  type StaffSession,
} from './staff-session';

const admin: StaffSession = { role: 'admin', accountId: null };
const org: StaffSession = { role: 'organizer', accountId: 'a1', emailHash: 'hash-a1' };

describe('chi gestisce un evento (ADR-014)', () => {
  it('il filtro sugli elenchi: i propri eventi e quelli in cui si è organizzatori', () => {
    expect(eventScope(admin)).toEqual({});
    expect(eventScope(org)).toEqual({
      AND: [
        {
          OR: [
            { createdById: 'a1' },
            { additionalMods: { some: { organizer: true, revokedAt: null, emailHash: 'hash-a1' } } },
          ],
        },
      ],
    });
  });

  it('il filtro non si perde se chi lo usa aggiunge una sua ricerca', () => {
    // Una rotta con una ricerca assegna `where.OR` dopo aver sparso il filtro:
    // la regola sta in `AND` e resta.
    const where: Record<string, unknown> = { eventType: 'INSTANT', ...eventScope(org) };
    where.OR = [{ slug: { contains: 'x' } }];
    expect(where.AND).toEqual(eventScope(org).AND);
  });

  it('il singolo evento segue la stessa regola', async () => {
    eventCount.mockReset();
    eventCount.mockResolvedValueOnce(1);
    const ID = '11111111-2222-4333-8444-555555555555';
    expect(await puoGestire(org, ID)).toBe(true);
    expect(eventCount).toHaveBeenCalledWith({ where: { id: ID, ...eventScope(org) } });
    eventCount.mockResolvedValueOnce(0);
    expect(await puoGestire(org, ID)).toBe(false);
    // L'admin non interroga nulla; un id malformato non è di nessuno.
    expect(await puoGestire(admin, ID)).toBe(true);
    expect(await puoGestire(org, 'non-un-id')).toBe(false);
    expect(eventCount).toHaveBeenCalledTimes(2);
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
    findUnique.mockResolvedValue({ id: ID, active: true, role: 'ORGANIZER', emailHash: 'hash-x' });
    const token = await signStaffSession({ id: ID, role: 'ADMIN' });
    expect(await getStaffSession(cookiesCon(token))).toEqual({
      role: 'organizer',
      accountId: ID,
      emailHash: 'hash-x',
    });
  });

  it('un account disattivato non ha sessione, qualunque sia il token', async () => {
    findUnique.mockResolvedValue({ id: ID, active: false, role: 'ADMIN' });
    const token = await signStaffSession({ id: ID, role: 'ADMIN' });
    expect(await getStaffSession(cookiesCon(token))).toBeNull();
  });
});
