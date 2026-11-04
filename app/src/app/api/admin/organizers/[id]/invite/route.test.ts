// @vitest-environment node
/**
 * Un nuovo link di accesso per un account dello staff: lo manda solo
 * l'amministrazione, mai a un account disattivato, e il registro delle azioni
 * dice a chi senza riportare dati della persona.
 */
import type { NextRequest } from 'next/server';
import { SignJWT } from 'jose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, enqueueEmail, biscotti } = vi.hoisted(() => ({
  prisma: {
    staffAccount: { findUnique: vi.fn() },
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
import { encryptPII } from '@/lib/crypto/pii';

import { POST } from './route';

const AMMINISTRATORE = '11111111-1111-4111-8111-111111111111';
const DESTINATARIO = '22222222-2222-4222-8222-222222222222';
const SEGRETO = 'segreto-di-prova-degli-inviti-dello-staff-lungo';

let conti: Map<string, Record<string, unknown>>;

function destinatario(extra: Record<string, unknown> = {}) {
  return {
    id: DESTINATARIO,
    email: encryptPII('anna.bianchi@example.com'),
    name: encryptPII('Anna Bianchi'),
    active: true,
    role: 'ORGANIZER',
    emailHash: 'impronta',
    ...extra,
  };
}

function invita(id = DESTINATARIO, corpo?: unknown) {
  const sessione = biscotti.get('admin_session')?.value;
  const request = new Request(`http://localhost:3000/api/admin/organizers/${id}/invite`, {
    method: 'POST',
    headers: {
      'x-forwarded-for': '203.0.113.9',
      ...(sessione ? { cookie: `admin_session=${sessione}` } : {}),
    },
    body:
      corpo === undefined
        ? undefined
        : typeof corpo === 'string'
          ? corpo
          : JSON.stringify(corpo),
  });
  return POST(request as unknown as NextRequest, { params: Promise.resolve({ id }) });
}

function nessunInvio() {
  expect(prisma.staffLoginToken.create).not.toHaveBeenCalled();
  expect(enqueueEmail).not.toHaveBeenCalled();
  expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  process.env.APP_SECRET = SEGRETO;
  process.env.PII_ENCRYPTION_KEY = 'a'.repeat(64);
  process.env.NEXT_PUBLIC_APP_URL = 'https://webinar.example.com';
  biscotti.clear();
  biscotti.set('admin_session', {
    value: await new SignJWT({ role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(SEGRETO)),
  });
  conti = new Map([[DESTINATARIO, destinatario()]]);
  prisma.staffAccount.findUnique.mockImplementation(
    async ({ where }: { where: { id: string } }) => conti.get(where.id) ?? null
  );
  prisma.staffLoginToken.create.mockResolvedValue({ id: 't1' });
  prisma.adminAuditLog.create.mockResolvedValue({ id: 'a1' });
  enqueueEmail.mockResolvedValue(undefined);
});

describe('chi invita', () => {
  it('senza sessione e’ 401', async () => {
    biscotti.clear();
    expect((await invita()).status).toBe(401);
    expect(prisma.staffAccount.findUnique).not.toHaveBeenCalled();
    nessunInvio();
  });

  it('un organizzatore e’ 401: non manda link agli altri', async () => {
    conti.set(AMMINISTRATORE, {
      id: AMMINISTRATORE,
      active: true,
      role: 'ORGANIZER',
      emailHash: 'impronta',
      name: 'x',
    });
    biscotti.set('admin_session', {
      value: await signStaffSession({ id: AMMINISTRATORE, role: 'ORGANIZER' }),
    });
    expect((await invita()).status).toBe(401);
    nessunInvio();
  });

  it('il ruolo si rilegge dal conto, non dal token', async () => {
    conti.set(AMMINISTRATORE, {
      id: AMMINISTRATORE,
      active: true,
      role: 'ORGANIZER',
      emailHash: 'impronta',
      name: 'x',
    });
    biscotti.set('admin_session', {
      value: await signStaffSession({ id: AMMINISTRATORE, role: 'ADMIN' }),
    });
    expect((await invita()).status).toBe(401);
    nessunInvio();
  });
});

describe('a chi si invia', () => {
  it('un identificativo che non e’ un UUID e’ 404, senza toccare il database', async () => {
    expect((await invita('non-un-uuid')).status).toBe(404);
    expect(prisma.staffAccount.findUnique).not.toHaveBeenCalled();
    nessunInvio();
  });

  it('un account inesistente e’ 404', async () => {
    conti.clear();
    expect((await invita()).status).toBe(404);
    nessunInvio();
  });

  it('un account disattivato non riceve link', async () => {
    conti.set(DESTINATARIO, destinatario({ active: false }));
    const r = await invita();
    expect(r.status).toBe(422);
    await expect(r.json()).resolves.toMatchObject({ error: 'organizer_inactive' });
    nessunInvio();
  });

  it('una lingua troppo lunga e’ 422', async () => {
    expect((await invita(DESTINATARIO, { locale: 'italiano' })).status).toBe(422);
    nessunInvio();
  });
});

describe('l’invio', () => {
  it('parte anche senza corpo, all’indirizzo in chiaro dell’account', async () => {
    const r = await invita();
    expect(r.status).toBe(202);
    await expect(r.json()).resolves.toEqual({ ok: true });
    const posta = enqueueEmail.mock.calls[0]![0] as { to: string; text: string };
    expect(posta.to).toBe('anna.bianchi@example.com');
    expect(posta.text).toContain('https://webinar.example.com/it/');
    expect(prisma.staffLoginToken.create.mock.calls[0]![0].data.accountId).toBe(
      DESTINATARIO
    );
  });

  it('un corpo che non e’ JSON vale come corpo vuoto', async () => {
    expect((await invita(DESTINATARIO, 'non json')).status).toBe(202);
  });

  it('il link segue la lingua richiesta', async () => {
    await invita(DESTINATARIO, { locale: 'en' });
    const posta = enqueueEmail.mock.calls[0]![0] as { text: string };
    expect(posta.text).toContain('https://webinar.example.com/en/');
  });

  it('il registro dice a chi, senza nome ne’ indirizzo', async () => {
    await invita();
    const { data } = prisma.adminAuditLog.create.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(data).toMatchObject({ action: 'ORGANIZER_INVITE', target: DESTINATARIO });
    expect(JSON.stringify(data)).not.toContain('anna.bianchi');
    expect(JSON.stringify(data)).not.toContain('Anna');
  });

  it('se la posta non parte lo dice, e non registra un invio mai avvenuto', async () => {
    enqueueEmail.mockRejectedValue(new Error('coda irraggiungibile'));
    expect((await invita()).status).toBe(500);
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });
});
