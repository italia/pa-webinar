// @vitest-environment node
/**
 * L'uscita dall'area di amministrazione: il cookie si azzera con gli stessi
 * attributi con cui era stato messo, e il registro dice chi e' uscito senza
 * conservare il token. La rotta e' aperta: senza una sessione vera non si scrive.
 */
import { createHash } from 'node:crypto';

import { SignJWT } from 'jose';
import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, biscotto } = vi.hoisted(() => ({
  prisma: {
    adminAuditLog: { create: vi.fn() },
    staffAccount: { findUnique: vi.fn() },
  },
  biscotto: { valore: undefined as string | undefined },
}));

vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => (biscotto.valore ? { value: biscotto.valore } : undefined),
  }),
}));

import { POST } from './route';

const SEGRETO = 'segreto-di-prova-della-sessione-abbastanza-lungo';
const ACCOUNT_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
let ip = 0;

function firma(
  claims: Record<string, unknown>,
  opzioni: { segreto?: string; soggetto?: string; scade?: string | number } = {}
) {
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(opzioni.scade ?? '1h');
  if (opzioni.soggetto) jwt.setSubject(opzioni.soggetto);
  return jwt.sign(new TextEncoder().encode(opzioni.segreto ?? SEGRETO));
}

function esci(sessione?: string) {
  biscotto.valore = sessione;
  const request = new Request('http://localhost:3000/api/admin/logout', {
    method: 'POST',
    headers: {
      'x-forwarded-for': `10.4.0.${(ip += 1)}`,
      ...(sessione ? { cookie: `admin_session=${sessione}` } : {}),
    },
  });
  return POST(request as unknown as NextRequest, { params: Promise.resolve({}) });
}

const rigaDelRegistro = () =>
  prisma.adminAuditLog.create.mock.calls[0]![0].data as {
    action: string;
    actorHash: string;
  };
const impronta = (token: string) =>
  createHash('sha256').update(token).digest('hex').slice(0, 16);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  process.env.APP_SECRET = SEGRETO;
  prisma.adminAuditLog.create.mockResolvedValue({ id: 'riga-1' });
  prisma.staffAccount.findUnique.mockResolvedValue({
    id: ACCOUNT_ID,
    active: true,
    role: 'ORGANIZER',
    emailHash: 'impronta',
    name: 'nome',
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('il cookie', () => {
  it('si azzera subito, con gli stessi attributi di quando e’ nato', async () => {
    const r = await esci(await firma({ role: 'admin' }));
    expect(r.status).toBe(200);
    await expect(r.json()).resolves.toEqual({ success: true });
    const cookie = r.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^admin_session=;/);
    expect(cookie).toContain('Max-Age=0');
    expect(cookie).toMatch(/;\s*HttpOnly/i);
    expect(cookie).toMatch(/;\s*SameSite=lax/i);
    expect(cookie).toMatch(/;\s*Path=\/\s*(;|$)/i);
  });

  it('in produzione e’ anche Secure, altrimenti il browser non lo sostituisce', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const r = await esci(await firma({ role: 'admin' }));
    expect(r.headers.get('set-cookie')).toMatch(/;\s*Secure/i);
  });

  it('esce anche chi ha una sessione scaduta, o nessuna', async () => {
    const scaduta = await firma({ role: 'admin' }, { scade: 1000 });
    for (const sessione of [scaduta, undefined]) {
      const r = await esci(sessione);
      expect(r.status).toBe(200);
      expect(r.headers.get('set-cookie')).toMatch(/^admin_session=;/);
    }
  });

  it('un database giu’ non tiene dentro nessuno', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    prisma.staffAccount.findUnique.mockRejectedValue(
      new Error('database non raggiungibile')
    );
    const r = await esci(await firma({ role: 'admin' }, { soggetto: ACCOUNT_ID }));
    expect(prisma.staffAccount.findUnique).toHaveBeenCalled();
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie')).toMatch(/^admin_session=;/);
  });

  it('un guasto del registro non tiene dentro nessuno', async () => {
    prisma.adminAuditLog.create.mockRejectedValue(
      new Error('database non raggiungibile')
    );
    const r = await esci(await firma({ role: 'admin' }));
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie')).toMatch(/^admin_session=;/);
  });
});

describe('chi resta nel registro', () => {
  it('con la chiave dell’istanza un’impronta, mai il token', async () => {
    const token = await firma({ role: 'admin' });
    await esci(token);
    const riga = rigaDelRegistro();
    expect(riga.action).toBe('ADMIN_LOGOUT');
    expect(riga.actorHash).toBe(impronta(token));
    expect(JSON.stringify(prisma.adminAuditLog.create.mock.calls)).not.toContain(token);
  });

  it('con un account l’account, con il ruolo che ha adesso', async () => {
    await esci(await firma({ role: 'admin' }, { soggetto: ACCOUNT_ID }));
    expect(prisma.staffAccount.findUnique.mock.calls[0]![0].where).toEqual({
      id: ACCOUNT_ID,
    });
    expect(rigaDelRegistro().actorHash).toBe(`organizer:${ACCOUNT_ID}`);
  });

  it('senza una sessione vera non si scrive niente', async () => {
    const falso = await firma(
      { role: 'admin' },
      { segreto: 'un-altro-segreto-lungo-quanto-basta-per-firmare', soggetto: ACCOUNT_ID }
    );
    const scaduta = await firma({ role: 'admin' }, { scade: 1000 });
    for (const sessione of [undefined, 'non-un-token', falso, scaduta]) {
      await esci(sessione);
    }
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it('un account che non esiste piu’ non scrive', async () => {
    prisma.staffAccount.findUnique.mockResolvedValue(null);
    await esci(await firma({ role: 'organizer' }, { soggetto: ACCOUNT_ID }));
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });
});
