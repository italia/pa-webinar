// @vitest-environment node
/**
 * Il rinnovo silenzioso della sessione: allunga solo una sessione valida, tiene
 * il ruolo che l'account ha adesso e non regala mai i poteri dell'istanza a un
 * organizzatore. Non e' un'azione da registro.
 */
import { jwtVerify, SignJWT } from 'jose';
import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, barattolo } = vi.hoisted(() => ({
  prisma: {
    adminAuditLog: { create: vi.fn() },
    staffAccount: { findUnique: vi.fn() },
  },
  barattolo: { sessione: undefined as string | undefined },
}));

vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) =>
      nome === 'admin_session' && barattolo.sessione
        ? { value: barattolo.sessione }
        : undefined,
  }),
}));

import {
  ADMIN_COOKIE_MAX_AGE_SECONDS,
  ADMIN_SESSION_TTL_SECONDS,
} from '@/lib/auth/admin-session';

import { POST } from './route';

const SEGRETO = 'segreto-di-prova-della-sessione-abbastanza-lungo';
const ACCOUNT_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const chiaveJwt = new TextEncoder().encode(SEGRETO);

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

function rinnova() {
  const request = new Request('http://localhost:3000/api/admin/refresh', {
    method: 'POST',
  });
  return POST(request as unknown as NextRequest, { params: Promise.resolve({}) });
}

function account(ruolo: 'ADMIN' | 'ORGANIZER', extra: Record<string, unknown> = {}) {
  return {
    id: ACCOUNT_ID,
    active: true,
    role: ruolo,
    emailHash: 'impronta-dell-indirizzo',
    name: 'nome-cifrato',
    ...extra,
  };
}

async function nuovoToken(r: Response) {
  const valore =
    /admin_session=([^;]*)/.exec(r.headers.get('set-cookie') ?? '')?.[1] ?? '';
  return (await jwtVerify(valore, chiaveJwt)).payload;
}

async function atteso401() {
  const r = await rinnova();
  expect(r.status).toBe(401);
  expect(r.headers.get('set-cookie')).toBeNull();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  process.env.APP_SECRET = SEGRETO;
  barattolo.sessione = undefined;
  prisma.staffAccount.findUnique.mockResolvedValue(account('ORGANIZER'));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('cosa si rinnova', () => {
  it('senza cookie non c’e’ niente da rinnovare', async () => {
    await atteso401();
  });

  it('un token firmato altrove e’ 401', async () => {
    barattolo.sessione = await firma(
      { role: 'admin' },
      { segreto: 'un-altro-segreto-lungo-quanto-basta-per-firmare' }
    );
    await atteso401();
  });

  it('un token scaduto non torna in vita', async () => {
    barattolo.sessione = await firma({ role: 'admin' }, { scade: 1000 });
    await atteso401();
  });

  it('il permesso della password di un evento non vale come sessione', async () => {
    barattolo.sessione = await firma({ eventId: 'ev-1', role: 'guest' });
    await atteso401();
  });

  it('un ruolo inventato, o un account malformato, non passa', async () => {
    barattolo.sessione = await firma({ role: 'root' }, { soggetto: ACCOUNT_ID });
    await atteso401();
    barattolo.sessione = await firma({ role: 'admin' }, { soggetto: 'non-un-uuid' });
    await atteso401();
    expect(prisma.staffAccount.findUnique).not.toHaveBeenCalled();
  });

  it('l’account disattivato o cancellato non si rinnova', async () => {
    barattolo.sessione = await firma({ role: 'admin' }, { soggetto: ACCOUNT_ID });
    prisma.staffAccount.findUnique.mockResolvedValue(account('ADMIN', { active: false }));
    await atteso401();
    prisma.staffAccount.findUnique.mockResolvedValue(null);
    await atteso401();
  });

  it('con un segreto troppo corto si rifiuta, non si firma', async () => {
    barattolo.sessione = await firma({ role: 'admin' });
    process.env.APP_SECRET = 'corto';
    await atteso401();
  });
});

describe('il ruolo del nuovo token', () => {
  it('la chiave dell’istanza resta senza account', async () => {
    barattolo.sessione = await firma({ role: 'admin' });
    const r = await rinnova();
    expect(r.status).toBe(200);
    await expect(r.json()).resolves.toEqual({ success: true });
    const token = await nuovoToken(r);
    expect(token.role).toBe('admin');
    expect(token.sub).toBeUndefined();
    expect(prisma.staffAccount.findUnique).not.toHaveBeenCalled();
  });

  it('l’organizzatore resta organizzatore', async () => {
    barattolo.sessione = await firma({ role: 'organizer' }, { soggetto: ACCOUNT_ID });
    const token = await nuovoToken(await rinnova());
    expect(token.role).toBe('organizer');
    expect(token.sub).toBe(ACCOUNT_ID);
  });

  it('un token che dice admin non vale piu’ dell’account: il declassato scende', async () => {
    barattolo.sessione = await firma({ role: 'admin' }, { soggetto: ACCOUNT_ID });
    const token = await nuovoToken(await rinnova());
    expect(token.role).toBe('organizer');
    expect(token.sub).toBe(ACCOUNT_ID);
  });

  it('chi e’ stato nominato amministratore sale', async () => {
    prisma.staffAccount.findUnique.mockResolvedValue(account('ADMIN'));
    barattolo.sessione = await firma({ role: 'organizer' }, { soggetto: ACCOUNT_ID });
    const token = await nuovoToken(await rinnova());
    expect(token.role).toBe('admin');
    expect(token.sub).toBe(ACCOUNT_ID);
  });
});

describe('il rinnovo', () => {
  it('riparte dalla durata piena, sia per la chiave sia per un account', async () => {
    barattolo.sessione = await firma({ role: 'admin' }, { scade: '5m' });
    const chiave = await nuovoToken(await rinnova());
    expect(chiave.exp! - chiave.iat!).toBe(ADMIN_SESSION_TTL_SECONDS);

    barattolo.sessione = await firma(
      { role: 'organizer' },
      { soggetto: ACCOUNT_ID, scade: '5m' }
    );
    const organizzatore = await nuovoToken(await rinnova());
    expect(organizzatore.exp! - organizzatore.iat!).toBe(ADMIN_SESSION_TTL_SECONDS);
  });

  it('il cookie resta HttpOnly e SameSite, e Secure in produzione', async () => {
    barattolo.sessione = await firma({ role: 'admin' });
    const cookie = (await rinnova()).headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/;\s*HttpOnly/i);
    expect(cookie).toMatch(/;\s*SameSite=lax/i);
    expect(cookie).toContain(`Max-Age=${ADMIN_COOKIE_MAX_AGE_SECONDS}`);
    expect(cookie).not.toMatch(/;\s*Secure/i);

    vi.stubEnv('NODE_ENV', 'production');
    const inProduzione = (await rinnova()).headers.get('set-cookie') ?? '';
    expect(inProduzione).toMatch(/;\s*Secure/i);
  });

  it('non scrive nel registro delle azioni', async () => {
    barattolo.sessione = await firma({ role: 'admin' });
    await rinnova();
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });
});
