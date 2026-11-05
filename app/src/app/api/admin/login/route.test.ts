// @vitest-environment node
/**
 * L'ingresso con la chiave dell'istanza: la sessione nasce solo dalla chiave
 * giusta, i tentativi si contano per indirizzo anche quando la chiave e' giusta,
 * e la chiave non esce mai dal server.
 */
import { jwtVerify } from 'jose';
import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    adminAuditLog: { create: vi.fn() },
    staffAccount: { findUnique: vi.fn() },
  },
}));

vi.mock('@/lib/db', () => ({ prisma }));

import {
  ADMIN_COOKIE_MAX_AGE_SECONDS,
  ADMIN_SESSION_TTL_SECONDS,
} from '@/lib/auth/admin-session';
import { getStaffSession } from '@/lib/auth/staff-session';

import { POST } from './route';

const CHIAVE = 'chiave-dell-istanza-di-prova';
const SEGRETO = 'segreto-di-prova-della-sessione-abbastanza-lungo';
let ip = 0;

function accedi(corpo: unknown, indirizzo = `10.3.0.${(ip += 1)}`) {
  const request = new Request('http://localhost:3000/api/admin/login', {
    method: 'POST',
    headers: { 'x-forwarded-for': indirizzo, 'user-agent': 'browser-di-prova' },
    body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  });
  return POST(request as unknown as NextRequest, { params: Promise.resolve({}) });
}

const cookieDi = (r: Response) => r.headers.get('set-cookie') ?? '';
const tokenDi = (r: Response) => /admin_session=([^;]*)/.exec(cookieDi(r))?.[1] ?? '';
const spieDeiLog = () => [
  vi.spyOn(console, 'log'),
  vi.spyOn(console, 'warn'),
  vi.spyOn(console, 'error'),
];
const scrittoNeiLog = () =>
  JSON.stringify(spieDeiLog().flatMap((spia) => spia.mock.calls));

beforeEach(() => {
  vi.clearAllMocks();
  for (const spia of spieDeiLog()) spia.mockImplementation(() => {});
  process.env.ADMIN_API_KEY = CHIAVE;
  process.env.APP_SECRET = SEGRETO;
  delete process.env.TRUSTED_PROXY_HOPS;
  prisma.adminAuditLog.create.mockResolvedValue({ id: 'riga-1' });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('chi entra', () => {
  it('con la chiave giusta nasce una sessione dell’istanza, senza account', async () => {
    const r = await accedi({ key: CHIAVE });
    expect(r.status).toBe(200);
    await expect(r.json()).resolves.toEqual({ success: true });

    const token = tokenDi(r);
    const { payload, protectedHeader } = await jwtVerify(
      token,
      new TextEncoder().encode(SEGRETO)
    );
    expect(protectedHeader.alg).toBe('HS256');
    expect(payload.role).toBe('admin');
    expect(payload.sub).toBeUndefined();
    expect(payload.exp! - payload.iat!).toBe(ADMIN_SESSION_TTL_SECONDS);
  });

  it('la sessione e’ quella che il resto dell’area riconosce', async () => {
    const token = tokenDi(await accedi({ key: CHIAVE }));
    const cookies = { get: () => ({ value: token }) } as unknown as Parameters<
      typeof getStaffSession
    >[0];
    await expect(getStaffSession(cookies)).resolves.toEqual({
      role: 'admin',
      accountId: null,
    });
  });

  it('una chiave simile non basta: niente cookie e niente traccia', async () => {
    for (const key of [
      'sbagliata',
      CHIAVE.slice(0, -1),
      `${CHIAVE}x`,
      CHIAVE.toUpperCase(),
      '',
    ]) {
      const r = await accedi({ key });
      expect(r.status).toBe(401);
      expect(r.headers.get('set-cookie')).toBeNull();
    }
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it('senza chiave nel corpo e’ 401', async () => {
    expect((await accedi({})).status).toBe(401);
    expect((await accedi({ key: null })).status).toBe(401);
  });

  it('senza ADMIN_API_KEY configurata non entra nessuno, nemmeno con la chiave vuota', async () => {
    delete process.env.ADMIN_API_KEY;
    expect((await accedi({ key: '' })).status).toBe(401);
    expect((await accedi({})).status).toBe(401);
    process.env.ADMIN_API_KEY = '';
    const r = await accedi({ key: '' });
    expect(r.status).toBe(401);
    expect(r.headers.get('set-cookie')).toBeNull();
  });

  it('il rifiuto non dice se una chiave e’ configurata', async () => {
    const conChiave = await (await accedi({ key: 'sbagliata' })).text();
    delete process.env.ADMIN_API_KEY;
    const senzaChiave = await (await accedi({ key: 'sbagliata' })).text();
    expect(senzaChiave).toBe(conChiave);
  });

  it('una chiave che non e’ un testo e’ un rifiuto, non un errore del server', async () => {
    for (const corpo of [{ key: 123 }, { key: ['x'] }, { key: {} }, null, 'null', '[]']) {
      const r = await accedi(corpo);
      expect(r.status).toBe(401);
      expect(r.headers.get('set-cookie')).toBeNull();
    }
  });

  it('un corpo che non e’ JSON e’ 400, senza cookie', async () => {
    const r = await accedi('non json');
    expect(r.status).toBe(400);
    expect(r.headers.get('set-cookie')).toBeNull();
  });
});

describe('i tentativi', () => {
  it('dal sesto in un minuto e’ 429, anche con la chiave giusta', async () => {
    const insistente = '10.3.200.1';
    for (let i = 0; i < 5; i += 1) {
      expect((await accedi({ key: 'sbagliata' }, insistente)).status).toBe(401);
    }
    const fermato = await accedi({ key: CHIAVE }, insistente);
    expect(fermato.status).toBe(429);
    expect(Number(fermato.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(Number(fermato.headers.get('retry-after'))).toBeLessThanOrEqual(60);
    expect(fermato.headers.get('set-cookie')).toBeNull();
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it('un indirizzo fermato non ferma gli altri', async () => {
    const insistente = '10.3.200.2';
    for (let i = 0; i < 6; i += 1) await accedi({ key: 'sbagliata' }, insistente);
    expect((await accedi({ key: CHIAVE }, '10.3.200.3')).status).toBe(200);
  });

  it('inventare voci a sinistra in X-Forwarded-For non apre un contatore nuovo', async () => {
    for (let i = 0; i < 5; i += 1) {
      await accedi({ key: 'sbagliata' }, `198.51.100.${i + 1}, 10.3.200.4`);
    }
    const r = await accedi({ key: CHIAVE }, '198.51.100.99, 10.3.200.4');
    expect(r.status).toBe(429);
  });
});

describe('il cookie della sessione', () => {
  it('non si legge da JavaScript e non viaggia fra siti', async () => {
    const cookie = cookieDi(await accedi({ key: CHIAVE }));
    expect(cookie).toMatch(/;\s*HttpOnly/i);
    expect(cookie).toMatch(/;\s*SameSite=lax/i);
    expect(cookie).toMatch(/;\s*Path=\/\s*(;|$)/i);
    expect(cookie).toContain(`Max-Age=${ADMIN_COOKIE_MAX_AGE_SECONDS}`);
  });

  it('in produzione viaggia solo su HTTPS', async () => {
    expect(cookieDi(await accedi({ key: CHIAVE }))).not.toMatch(/;\s*Secure/i);
    vi.stubEnv('NODE_ENV', 'production');
    expect(cookieDi(await accedi({ key: CHIAVE }))).toMatch(/;\s*Secure/i);
  });

  it('in produzione con un segreto corto non si firma niente', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.APP_SECRET = 'corto';
    const r = await accedi({ key: CHIAVE });
    expect(r.status).toBe(500);
    await expect(r.json()).resolves.toMatchObject({ error: 'server_misconfigured' });
    expect(r.headers.get('set-cookie')).toBeNull();
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });
});

describe('la traccia dell’accesso', () => {
  it('l’accesso riuscito lascia una riga con indirizzo e browser', async () => {
    await accedi({ key: CHIAVE }, '10.3.200.5');
    expect(prisma.adminAuditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.adminAuditLog.create.mock.calls[0]![0].data).toMatchObject({
      action: 'ADMIN_LOGIN',
      ip: '10.3.200.5',
      userAgent: 'browser-di-prova',
    });
  });

  it('la chiave non finisce in risposta, nel registro o nei log', async () => {
    const riuscito = await accedi({ key: CHIAVE });
    const rifiutato = await accedi({ key: `${CHIAVE}x` });
    expect(await riuscito.text()).not.toContain(CHIAVE);
    expect(await rifiutato.text()).not.toContain(CHIAVE);
    expect(cookieDi(riuscito)).not.toContain(CHIAVE);
    expect(JSON.stringify(prisma.adminAuditLog.create.mock.calls)).not.toContain(CHIAVE);
    expect(scrittoNeiLog()).not.toContain(CHIAVE);
  });
});
