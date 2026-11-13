// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
/**
 * Gli account dello staff: solo l'amministrazione dell'istanza. Nome e indirizzo
 * sono cifrati a riposo, l'unicita' si controlla sull'impronta dell'indirizzo, e
 * un invio di posta non riuscito non lascia a meta' la creazione dell'account.
 */
import { Prisma } from '@prisma/client';
import type { NextRequest } from 'next/server';
import { SignJWT } from 'jose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, enqueueEmail, biscotti } = vi.hoisted(() => ({
  prisma: {
    staffAccount: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    staffLoginToken: { create: vi.fn() },
    adminAuditLog: { create: vi.fn() },
  },
  enqueueEmail: vi.fn(),
  biscotti: new Map<string, { value: string }>(),
}));

vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('@/lib/email/outbox', () => ({ enqueueEmail }));
vi.mock('@/lib/settings', () => ({
  getSettings: async () => ({ siteName: 'PA Webinar' }),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (nome: string) => biscotti.get(nome) }),
}));

import { signStaffSession } from '@/lib/auth/staff-session';
import { decryptPII, encryptPII, hashEmail } from '@/lib/crypto/pii';

import { GET, POST } from './route';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const NUOVO = '22222222-2222-4222-8222-222222222222';
const SEGRETO = 'segreto-di-prova-degli-account-dello-staff-lungo';
const CORPO = { name: 'Anna Bianchi', email: 'anna.bianchi@example.com' };

let conto: { id: string; active: boolean; role: string; emailHash: string; name: string };
let impronteUsate: Set<string>;

function entraConLaChiave() {
  return new SignJWT({ role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SEGRETO));
}

function intestazioni(): Record<string, string> {
  const sessione = biscotti.get('admin_session')?.value;
  return sessione ? { cookie: `admin_session=${sessione}` } : {};
}

function elenca() {
  const request = new Request('http://localhost:3000/api/admin/organizers', {
    headers: intestazioni(),
  });
  return GET(request as unknown as NextRequest, { params: Promise.resolve({}) });
}

function crea(corpo: unknown) {
  const request = new Request('http://localhost:3000/api/admin/organizers', {
    method: 'POST',
    headers: { 'x-forwarded-for': '203.0.113.9', ...intestazioni() },
    body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  });
  return POST(request as unknown as NextRequest, { params: Promise.resolve({}) });
}

function datiScritti() {
  return prisma.staffAccount.create.mock.calls[0]![0].data as {
    emailHash: string;
    email: string;
    name: string;
    role: string;
  };
}

function riga(extra: Record<string, unknown> = {}) {
  return {
    id: NUOVO,
    name: encryptPII('Anna Bianchi'),
    email: encryptPII('anna.bianchi@example.com'),
    emailHash: 'impronta-da-non-mostrare',
    role: 'ORGANIZER',
    active: true,
    createdAt: new Date('2026-10-02T08:00:00Z'),
    lastLoginAt: null,
    _count: { events: 3 },
    ...extra,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  process.env.APP_SECRET = SEGRETO;
  process.env.PII_ENCRYPTION_KEY = 'a'.repeat(64);
  process.env.NEXT_PUBLIC_APP_URL = 'https://webinar.example.com';
  biscotti.clear();
  biscotti.set('admin_session', { value: await entraConLaChiave() });
  conto = { id: ACCOUNT, active: true, role: 'ADMIN', emailHash: 'impronta', name: 'x' };
  impronteUsate = new Set();
  prisma.staffAccount.findUnique.mockImplementation(
    async ({ where }: { where: { id?: string; emailHash?: string } }) => {
      if (where.emailHash)
        return impronteUsate.has(where.emailHash) ? { id: 'gia-li' } : null;
      return where.id === conto.id ? conto : null;
    }
  );
  prisma.staffAccount.findMany.mockResolvedValue([riga()]);
  prisma.staffAccount.create.mockImplementation(
    async ({ data }: { data: { email: string; name: string } }) => ({
      id: NUOVO,
      email: data.email,
      name: data.name,
    })
  );
  prisma.staffLoginToken.create.mockResolvedValue({ id: 't1' });
  prisma.adminAuditLog.create.mockResolvedValue({ id: 'a1' });
  enqueueEmail.mockResolvedValue(undefined);
});

const azioni = { elenca: () => elenca(), crea: () => crea(CORPO) };

describe.each(['elenca', 'crea'] as const)('%s: chi entra', (azione) => {
  function nulla() {
    expect(prisma.staffAccount.findMany).not.toHaveBeenCalled();
    expect(prisma.staffAccount.create).not.toHaveBeenCalled();
  }

  it('senza sessione e’ 401', async () => {
    biscotti.clear();
    expect((await azioni[azione]()).status).toBe(401);
    nulla();
  });

  it('un organizzatore e’ 401', async () => {
    conto = { ...conto, role: 'ORGANIZER' };
    biscotti.set('admin_session', {
      value: await signStaffSession({ id: ACCOUNT, role: 'ORGANIZER' }),
    });
    expect((await azioni[azione]()).status).toBe(401);
    nulla();
  });

  it('il ruolo si rilegge dal conto, non dal token', async () => {
    conto = { ...conto, role: 'ORGANIZER' };
    biscotti.set('admin_session', {
      value: await signStaffSession({ id: ACCOUNT, role: 'ADMIN' }),
    });
    expect((await azioni[azione]()).status).toBe(401);
    nulla();
  });

  it('un amministratore disattivato e’ 401 subito', async () => {
    conto = { ...conto, active: false };
    biscotti.set('admin_session', {
      value: await signStaffSession({ id: ACCOUNT, role: 'ADMIN' }),
    });
    expect((await azioni[azione]()).status).toBe(401);
    nulla();
  });
});

describe('l’elenco', () => {
  it('nomi e indirizzi tornano in chiaro, l’impronta resta dentro', async () => {
    const r = await elenca();
    const testo = await r.text();
    expect(JSON.parse(testo)).toEqual({
      selfId: null,
      rows: [
        {
          id: NUOVO,
          name: 'Anna Bianchi',
          email: 'anna.bianchi@example.com',
          role: 'ORGANIZER',
          active: true,
          createdAt: '2026-10-02T08:00:00.000Z',
          lastLoginAt: null,
          eventCount: 3,
        },
      ],
    });
    expect(testo).not.toContain('impronta-da-non-mostrare');
  });

  it('dice all’amministratore con un conto qual e’ la sua riga', async () => {
    biscotti.set('admin_session', {
      value: await signStaffSession({ id: ACCOUNT, role: 'ADMIN' }),
    });
    await expect((await elenca()).json()).resolves.toMatchObject({ selfId: ACCOUNT });
  });
});

describe('cosa si accetta', () => {
  it('un corpo che non e’ JSON e’ 400', async () => {
    expect((await crea('non json')).status).toBe(400);
  });

  it.each([
    ['un nome troppo corto', { ...CORPO, name: ' a ' }],
    ['un nome troppo lungo', { ...CORPO, name: 'x'.repeat(121) }],
    ['un indirizzo non valido', { ...CORPO, email: 'non-un-indirizzo' }],
    ['un ruolo sconosciuto', { ...CORPO, role: 'SUPERADMIN' }],
    ['una lingua troppo lunga', { ...CORPO, locale: 'italiano' }],
  ])('%s e’ 422', async (_nome, corpo) => {
    expect((await crea(corpo)).status).toBe(422);
    expect(prisma.staffAccount.create).not.toHaveBeenCalled();
  });
});

describe('la creazione', () => {
  it('nel database nome e indirizzo sono cifrati, con l’impronta per cercarli', async () => {
    expect((await crea(CORPO)).status).toBe(201);
    const dati = datiScritti();
    expect(dati.emailHash).toBe(hashEmail('anna.bianchi@example.com'));
    expect(JSON.stringify(dati)).not.toContain('anna.bianchi');
    expect(JSON.stringify(dati)).not.toContain('Anna');
    expect(decryptPII(dati.email)).toBe('anna.bianchi@example.com');
    expect(decryptPII(dati.name)).toBe('Anna Bianchi');
  });

  it('il ruolo di partenza e’ organizzatore, e si puo’ scegliere amministratore', async () => {
    await crea(CORPO);
    expect(datiScritti().role).toBe('ORGANIZER');
    vi.mocked(prisma.staffAccount.create).mockClear();
    await crea({ ...CORPO, role: 'ADMIN' });
    expect(datiScritti().role).toBe('ADMIN');
  });

  it('un indirizzo gia’ usato e’ 409, senza guardare maiuscole e spazi', async () => {
    impronteUsate.add(hashEmail('anna.bianchi@example.com'));
    const r = await crea({ ...CORPO, email: ' Anna.Bianchi@Example.com ' });
    expect(r.status).toBe(409);
    await expect(r.json()).resolves.toMatchObject({ error: 'organizer_exists' });
    expect(prisma.staffAccount.create).not.toHaveBeenCalled();
    expect(enqueueEmail).not.toHaveBeenCalled();
  });

  it('due richieste insieme: quella fermata dal vincolo di unicita’ e’ 409', async () => {
    prisma.staffAccount.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicato', {
        code: 'P2002',
        clientVersion: 'test',
      })
    );
    const r = await crea(CORPO);
    expect(r.status).toBe(409);
    await expect(r.json()).resolves.toMatchObject({ error: 'organizer_exists' });
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it('un altro guasto del database non si traveste da doppione', async () => {
    prisma.staffAccount.create.mockRejectedValue(new Error('database irraggiungibile'));
    expect((await crea(CORPO)).status).toBe(500);
    expect(enqueueEmail).not.toHaveBeenCalled();
  });

  it('la risposta non riporta i dati della persona', async () => {
    const testo = await (await crea({ ...CORPO, invite: false })).text();
    expect(JSON.parse(testo)).toEqual({ id: NUOVO, invited: false });
  });

  it('il registro dice l’azione e il ruolo, senza nome ne’ indirizzo', async () => {
    await crea({ ...CORPO, role: 'ADMIN' });
    const { data } = prisma.adminAuditLog.create.mock.calls[0]![0] as {
      data: { action: string; target: string; details: string };
    };
    expect(data).toMatchObject({ action: 'ORGANIZER_CREATE', target: NUOVO });
    expect(JSON.parse(data.details)).toEqual({ role: 'ADMIN' });
    expect(JSON.stringify(data)).not.toContain('anna.bianchi');
    expect(JSON.stringify(data)).not.toContain('Anna');
  });
});

describe('l’invito', () => {
  it('di norma parte il link, all’indirizzo in chiaro, e il token non si salva', async () => {
    const r = await crea(CORPO);
    await expect(r.json()).resolves.toEqual({ id: NUOVO, invited: true });
    const posta = enqueueEmail.mock.calls[0]![0] as { to: string; text: string };
    expect(posta.to).toBe('anna.bianchi@example.com');
    const { accountId, tokenHash } = prisma.staffLoginToken.create.mock.calls[0]![0]
      .data as {
      accountId: string;
      tokenHash: string;
    };
    expect(accountId).toBe(NUOVO);
    expect(posta.text).not.toContain(tokenHash);
  });

  it('il link segue la lingua richiesta', async () => {
    await crea({ ...CORPO, locale: 'en' });
    const posta = enqueueEmail.mock.calls[0]![0] as { text: string };
    expect(posta.text).toContain('https://webinar.example.com/en/');
  });

  it('con invite: false non parte niente', async () => {
    await crea({ ...CORPO, invite: false });
    expect(prisma.staffLoginToken.create).not.toHaveBeenCalled();
    expect(enqueueEmail).not.toHaveBeenCalled();
  });

  it('se l’invio non riesce l’account resta, e lo si dice', async () => {
    enqueueEmail.mockRejectedValue(new Error('coda irraggiungibile'));
    const r = await crea(CORPO);
    expect(r.status).toBe(201);
    await expect(r.json()).resolves.toEqual({ id: NUOVO, invited: false });
  });
});
