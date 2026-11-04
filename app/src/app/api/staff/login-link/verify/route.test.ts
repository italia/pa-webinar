// @vitest-environment node
/**
 * Il clic sul link di accesso apre la sessione dello staff: un link scaduto,
 * gia' usato, inventato o di un account disattivato riceve una sola risposta, il
 * ruolo viene dall'account e il token non resta da nessuna parte.
 */
import { createHash } from 'node:crypto';

import { jwtVerify } from 'jose';
import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    adminAuditLog: { create: vi.fn() },
    staffAccount: { findUnique: vi.fn(), update: vi.fn() },
    staffLoginToken: { findUnique: vi.fn(), updateMany: vi.fn() },
  },
}));

vi.mock('@/lib/db', () => ({ prisma }));

import {
  ADMIN_COOKIE_MAX_AGE_SECONDS,
  ADMIN_SESSION_TTL_SECONDS,
} from '@/lib/auth/admin-session';
import { getStaffSession } from '@/lib/auth/staff-session';

import { POST } from './route';

const SEGRETO = 'segreto-di-prova-della-sessione-abbastanza-lungo';
const ACCOUNT_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const TOKEN = 'token-del-link-di-accesso-di-prova';
let ip = 0;

function clicca(corpo: unknown, indirizzo = `10.7.0.${(ip += 1)}`) {
  const request = new Request('http://localhost:3000/api/staff/login-link/verify', {
    method: 'POST',
    headers: { 'x-forwarded-for': indirizzo },
    body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  });
  return POST(request as unknown as NextRequest, { params: Promise.resolve({}) });
}

function account(ruolo: 'ADMIN' | 'ORGANIZER') {
  return {
    id: ACCOUNT_ID,
    role: ruolo,
    active: true,
    emailHash: 'impronta-dell-indirizzo',
    name: 'nome-cifrato',
  };
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
  process.env.APP_SECRET = SEGRETO;
  delete process.env.TRUSTED_PROXY_HOPS;
  prisma.staffLoginToken.findUnique.mockResolvedValue({
    id: 'riga-token',
    accountId: ACCOUNT_ID,
    account: { active: true },
  });
  prisma.staffLoginToken.updateMany.mockResolvedValue({ count: 1 });
  prisma.staffAccount.update.mockResolvedValue({ id: ACCOUNT_ID });
  prisma.staffAccount.findUnique.mockResolvedValue(account('ORGANIZER'));
  prisma.adminAuditLog.create.mockResolvedValue({ id: 'riga-1' });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('il link che vale', () => {
  it('apre la sessione dell’account, con il suo ruolo', async () => {
    const r = await clicca({ token: TOKEN });
    expect(r.status).toBe(200);
    await expect(r.json()).resolves.toEqual({ ok: true });
    const { payload } = await jwtVerify(tokenDi(r), new TextEncoder().encode(SEGRETO));
    expect(payload.sub).toBe(ACCOUNT_ID);
    expect(payload.role).toBe('organizer');
    expect(payload.exp! - payload.iat!).toBe(ADMIN_SESSION_TTL_SECONDS);
  });

  it('un amministratore entra da amministratore', async () => {
    prisma.staffAccount.findUnique.mockResolvedValue(account('ADMIN'));
    const r = await clicca({ token: TOKEN });
    const { payload } = await jwtVerify(tokenDi(r), new TextEncoder().encode(SEGRETO));
    expect(payload.role).toBe('admin');
  });

  it('il ruolo viene dall’account, non da chi chiama', async () => {
    const r = await clicca({ token: TOKEN, role: 'ADMIN', accountId: 'altro' });
    const { payload } = await jwtVerify(tokenDi(r), new TextEncoder().encode(SEGRETO));
    expect(payload.role).toBe('organizer');
    expect(payload.sub).toBe(ACCOUNT_ID);
  });

  it('la sessione e’ quella che il resto dell’area riconosce', async () => {
    const token = tokenDi(await clicca({ token: TOKEN }));
    const cookies = { get: () => ({ value: token }) } as unknown as Parameters<
      typeof getStaffSession
    >[0];
    await expect(getStaffSession(cookies)).resolves.toEqual({
      role: 'organizer',
      accountId: ACCOUNT_ID,
      emailHash: 'impronta-dell-indirizzo',
    });
  });

  it('nel database si cerca l’hash e il consumo vale una volta sola', async () => {
    await clicca({ token: TOKEN });
    expect(prisma.staffLoginToken.findUnique.mock.calls[0]![0].where).toEqual({
      tokenHash: createHash('sha256').update(TOKEN).digest('hex'),
    });
    const { where } = prisma.staffLoginToken.updateMany.mock.calls[0]![0] as {
      where: { id: string; usedAt: null; expiresAt: { gt: Date } };
    };
    expect(where.id).toBe('riga-token');
    expect(where.usedAt).toBeNull();
    expect(where.expiresAt.gt).toBeInstanceOf(Date);
  });

  it('il cookie non si legge da JavaScript e non viaggia fra siti', async () => {
    const cookie = cookieDi(await clicca({ token: TOKEN }));
    expect(cookie).toMatch(/;\s*HttpOnly/i);
    expect(cookie).toMatch(/;\s*SameSite=lax/i);
    expect(cookie).toContain(`Max-Age=${ADMIN_COOKIE_MAX_AGE_SECONDS}`);
    expect(cookie).not.toMatch(/;\s*Secure/i);

    vi.stubEnv('NODE_ENV', 'production');
    expect(cookieDi(await clicca({ token: TOKEN }))).toMatch(/;\s*Secure/i);
  });
});

describe('il link che non vale', () => {
  it('inventato, disattivato, gia’ usato o eliminato: una sola risposta', async () => {
    const casi: Array<() => void> = [
      () => prisma.staffLoginToken.findUnique.mockResolvedValue(null),
      () =>
        prisma.staffLoginToken.findUnique.mockResolvedValue({
          id: 'riga-token',
          accountId: ACCOUNT_ID,
          account: { active: false },
        }),
      () => {
        prisma.staffLoginToken.findUnique.mockResolvedValue({
          id: 'riga-token',
          accountId: ACCOUNT_ID,
          account: { active: true },
        });
        prisma.staffLoginToken.updateMany.mockResolvedValue({ count: 0 });
      },
      () => {
        prisma.staffLoginToken.updateMany.mockResolvedValue({ count: 1 });
        prisma.staffAccount.findUnique.mockResolvedValue(null);
      },
    ];
    const corpi = new Set<string>();
    for (const prepara of casi) {
      prepara();
      const r = await clicca({ token: TOKEN });
      expect(r.status).toBe(422);
      expect(r.headers.get('set-cookie')).toBeNull();
      corpi.add(await r.text());
    }
    expect(corpi.size).toBe(1);
    expect(JSON.parse([...corpi][0]!)).toMatchObject({ error: 'invalid_link' });
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it('un token malformato riceve la stessa risposta, senza toccare il database', async () => {
    for (const corpo of [
      {},
      { token: 42 },
      { token: 'corto' },
      { token: 'x'.repeat(201) },
      null,
    ]) {
      const r = await clicca(corpo);
      expect(r.status).toBe(422);
      await expect(r.json()).resolves.toMatchObject({ error: 'invalid_link' });
    }
    expect(prisma.staffLoginToken.findUnique).not.toHaveBeenCalled();
  });

  it('un corpo che non e’ JSON e’ 400', async () => {
    expect((await clicca('non json')).status).toBe(400);
    expect(prisma.staffLoginToken.findUnique).not.toHaveBeenCalled();
  });
});

describe('i tentativi', () => {
  it('dall’undicesimo in un minuto e’ 429, e un link buono non si brucia', async () => {
    const insistente = '10.7.200.1';
    prisma.staffLoginToken.findUnique.mockResolvedValue(null);
    for (let i = 0; i < 10; i += 1) {
      expect((await clicca({ token: `tentativo-${i}-lungo` }, insistente)).status).toBe(
        422
      );
    }
    prisma.staffLoginToken.findUnique.mockClear();
    const r = await clicca({ token: TOKEN }, insistente);
    expect(r.status).toBe(429);
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(r.headers.get('set-cookie')).toBeNull();
    expect(prisma.staffLoginToken.findUnique).not.toHaveBeenCalled();
    expect(prisma.staffLoginToken.updateMany).not.toHaveBeenCalled();
  });

  it('un indirizzo fermato non ferma gli altri', async () => {
    const insistente = '10.7.200.2';
    for (let i = 0; i < 11; i += 1) await clicca({ token: TOKEN }, insistente);
    expect((await clicca({ token: TOKEN }, '10.7.200.3')).status).toBe(200);
  });
});

describe('la traccia dell’accesso', () => {
  it('dice chi e’ entrato, dall’account e non dal cookie in arrivo', async () => {
    await clicca({ token: TOKEN }, '10.7.200.4');
    expect(prisma.adminAuditLog.create.mock.calls[0]![0].data).toMatchObject({
      action: 'STAFF_LOGIN',
      target: ACCOUNT_ID,
      actorHash: `organizer:${ACCOUNT_ID}`,
      ip: '10.7.200.4',
    });
  });

  it('per un amministratore lo dice', async () => {
    prisma.staffAccount.findUnique.mockResolvedValue(account('ADMIN'));
    await clicca({ token: TOKEN });
    expect(prisma.adminAuditLog.create.mock.calls[0]![0].data.actorHash).toBe(
      `admin:${ACCOUNT_ID}`
    );
  });

  it('il token non finisce in risposta, nel cookie, nel registro o nei log', async () => {
    const r = await clicca({ token: TOKEN });
    expect(await r.text()).not.toContain(TOKEN);
    expect(cookieDi(r)).not.toContain(TOKEN);
    expect(JSON.stringify(prisma.adminAuditLog.create.mock.calls)).not.toContain(TOKEN);
    expect(scrittoNeiLog()).not.toContain(TOKEN);
  });
});
