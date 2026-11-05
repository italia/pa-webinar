// @vitest-environment node
/**
 * L'elenco dei link di conduzione di tutti gli eventi: e' fatto di credenziali
 * durevoli, quindi lo vede solo l'amministrazione dell'istanza, mai
 * l'organizzatore, e non resta in cache. Chi ne cambia uno lascia traccia, senza
 * che il link nuovo finisca nel registro.
 */
import type { NextRequest } from 'next/server';
import { SignJWT } from 'jose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, biscotti } = vi.hoisted(() => ({
  prisma: {
    staffAccount: { findUnique: vi.fn() },
    event: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    adminAuditLog: { create: vi.fn() },
  },
  biscotti: new Map<string, { value: string }>(),
}));

vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (nome: string) => biscotti.get(nome) }),
}));

import { signStaffSession } from '@/lib/auth/staff-session';
import { encryptPII } from '@/lib/crypto/pii';

import { GET, POST } from './route';

const EVENTO = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const SEGRETO = 'segreto-di-prova-dell-elenco-moderatori-lungo';
const TOKEN_VECCHIO = '33333333-3333-4333-8333-333333333333';

let conto: { id: string; active: boolean; role: string; emailHash: string; name: string };

function entraConLaChiave() {
  return new SignJWT({ role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SEGRETO));
}

function entraConIlConto(ruoloNelToken: 'ADMIN' | 'ORGANIZER') {
  return signStaffSession({ id: ACCOUNT, role: ruoloNelToken });
}

function intestazioni(): Record<string, string> {
  const sessione = biscotti.get('admin_session')?.value;
  return sessione ? { cookie: `admin_session=${sessione}` } : {};
}

function elenca(query = '') {
  const request = new Request(`http://localhost:3000/api/admin/moderators${query}`, {
    headers: intestazioni(),
  });
  return GET(request as unknown as NextRequest, { params: Promise.resolve({}) });
}

function rigenera(corpo: unknown) {
  const request = new Request('http://localhost:3000/api/admin/moderators', {
    method: 'POST',
    headers: { 'x-forwarded-for': '203.0.113.9', ...intestazioni() },
    body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  });
  return POST(request as unknown as NextRequest, { params: Promise.resolve({}) });
}

function riga(extra: Record<string, unknown> = {}) {
  return {
    id: EVENTO,
    slug: 'evento',
    title: { it: 'Il titolo', en: 'The title' },
    status: 'LIVE',
    eventType: 'SCHEDULED',
    startsAt: new Date('2026-10-02T08:00:00Z'),
    endsAt: new Date('2026-10-02T09:00:00Z'),
    moderatorName: 'Anna Bianchi',
    moderatorEmail: encryptPII('anna.bianchi@example.com'),
    moderatorToken: TOKEN_VECCHIO,
    ...extra,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  process.env.APP_SECRET = SEGRETO;
  process.env.PII_ENCRYPTION_KEY = 'a'.repeat(64);
  biscotti.clear();
  biscotti.set('admin_session', { value: await entraConLaChiave() });
  conto = { id: ACCOUNT, active: true, role: 'ADMIN', emailHash: 'impronta', name: 'x' };
  prisma.staffAccount.findUnique.mockImplementation(
    async ({ where }: { where: { id: string } }) => (where.id === conto.id ? conto : null)
  );
  prisma.event.findMany.mockResolvedValue([riga()]);
  prisma.event.findUnique.mockResolvedValue({
    id: EVENTO,
    moderatorToken: TOKEN_VECCHIO,
  });
  prisma.event.update.mockResolvedValue({ id: EVENTO });
  prisma.adminAuditLog.create.mockResolvedValue({ id: 'a1' });
});

const azioni = {
  elenca: () => elenca(),
  rigenera: () => rigenera({ eventId: EVENTO, action: 'regenerate' }),
};

describe.each(['elenca', 'rigenera'] as const)('%s: chi entra', (azione) => {
  function nulla() {
    expect(prisma.event.findMany).not.toHaveBeenCalled();
    expect(prisma.event.update).not.toHaveBeenCalled();
  }

  it('senza sessione e’ 401', async () => {
    biscotti.clear();
    expect((await azioni[azione]()).status).toBe(401);
    nulla();
  });

  it('con una sessione firmata da altri e’ 401', async () => {
    biscotti.set('admin_session', {
      value: await new SignJWT({ role: 'admin' })
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime('1h')
        .sign(
          new TextEncoder().encode('altro-segreto-di-prova-abbastanza-lungo-davvero')
        ),
    });
    expect((await azioni[azione]()).status).toBe(401);
    nulla();
  });

  it('un organizzatore e’ 401: non vede i link di tutti gli eventi', async () => {
    conto = { ...conto, role: 'ORGANIZER' };
    biscotti.set('admin_session', { value: await entraConIlConto('ORGANIZER') });
    expect((await azioni[azione]()).status).toBe(401);
    nulla();
  });

  it('il ruolo si rilegge dal conto, non dal token', async () => {
    conto = { ...conto, role: 'ORGANIZER' };
    biscotti.set('admin_session', { value: await entraConIlConto('ADMIN') });
    expect((await azioni[azione]()).status).toBe(401);
    nulla();
  });

  it('un amministratore disattivato e’ 401 subito', async () => {
    conto = { ...conto, active: false };
    biscotti.set('admin_session', { value: await entraConIlConto('ADMIN') });
    expect((await azioni[azione]()).status).toBe(401);
    nulla();
  });

  it('un amministratore con il conto passa', async () => {
    biscotti.set('admin_session', { value: await entraConIlConto('ADMIN') });
    expect((await azioni[azione]()).status).toBe(200);
  });
});

describe('l’elenco', () => {
  const filtro = () =>
    prisma.event.findMany.mock.calls[0]![0] as {
      where: Record<string, unknown>;
      take: number;
    };

  it('uno stato inesistente e’ rifiutato, senza interrogare il database', async () => {
    expect((await elenca('?status=INVENTATO')).status).toBe(422);
    expect(prisma.event.findMany).not.toHaveBeenCalled();
  });

  it('di norma lascia fuori le bozze, e ha un tetto', async () => {
    await elenca();
    expect(filtro().where).toEqual({ status: { not: 'DRAFT' } });
    expect(filtro().take).toBe(200);
  });

  it('si filtra per stato', async () => {
    await elenca('?status=LIVE');
    expect(filtro().where.status).toBe('LIVE');
  });

  it('la ricerca guarda slug e nome, non l’email cifrata', async () => {
    await elenca('?q=%20anna%20');
    expect(filtro().where.OR).toEqual([
      { slug: { contains: 'anna', mode: 'insensitive' } },
      { moderatorName: { contains: 'anna', mode: 'insensitive' } },
    ]);
  });

  it('una riga ha l’email in chiaro, il titolo e il link, e non resta in cache', async () => {
    const r = await elenca();
    expect(r.headers.get('cache-control')).toBe('no-store');
    await expect(r.json()).resolves.toEqual({
      rows: [
        {
          id: EVENTO,
          slug: 'evento',
          title: 'Il titolo',
          status: 'LIVE',
          eventType: 'SCHEDULED',
          startsAt: '2026-10-02T08:00:00.000Z',
          endsAt: '2026-10-02T09:00:00.000Z',
          moderatorName: 'Anna Bianchi',
          moderatorEmail: 'anna.bianchi@example.com',
          moderatorToken: TOKEN_VECCHIO,
        },
      ],
    });
  });
});

describe('il cambio del link', () => {
  it('un corpo che non e’ JSON e’ 400', async () => {
    expect((await rigenera('non json')).status).toBe(400);
    expect(prisma.event.update).not.toHaveBeenCalled();
  });

  it.each([
    ['un evento che non e’ un UUID', { eventId: 'evento', action: 'regenerate' }],
    ['un’azione sconosciuta', { eventId: EVENTO, action: 'delete' }],
    ['nessuna azione', { eventId: EVENTO }],
  ])('%s e’ 422', async (_nome, corpo) => {
    expect((await rigenera(corpo)).status).toBe(422);
    expect(prisma.event.update).not.toHaveBeenCalled();
  });

  it('un evento inesistente e’ 404, e non lascia traccia', async () => {
    prisma.event.findUnique.mockResolvedValue(null);
    expect((await rigenera({ eventId: EVENTO, action: 'regenerate' })).status).toBe(404);
    expect(prisma.event.update).not.toHaveBeenCalled();
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it('il link nuovo e’ un UUID diverso, e si legge una volta sola', async () => {
    const r = await rigenera({ eventId: EVENTO, action: 'regenerate' });
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const corpo = (await r.json()) as { eventId: string; moderatorToken: string };
    expect(corpo.eventId).toBe(EVENTO);
    expect(corpo.moderatorToken).toMatch(/^[0-9a-f-]{36}$/);
    expect(corpo.moderatorToken).not.toBe(TOKEN_VECCHIO);
    expect(prisma.event.update).toHaveBeenCalledWith({
      where: { id: EVENTO },
      data: { moderatorToken: corpo.moderatorToken },
    });
  });

  it('due cambi danno due link diversi', async () => {
    const leggi = async () =>
      (
        (await (await rigenera({ eventId: EVENTO, action: 'regenerate' })).json()) as {
          moderatorToken: string;
        }
      ).moderatorToken;
    expect(await leggi()).not.toBe(await leggi());
  });

  it('il registro dice chi ha agito e su cosa, senza il link', async () => {
    biscotti.set('admin_session', { value: await entraConIlConto('ADMIN') });
    const r = await rigenera({ eventId: EVENTO, action: 'regenerate' });
    const { moderatorToken } = (await r.json()) as { moderatorToken: string };
    const { data } = prisma.adminAuditLog.create.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(data).toMatchObject({
      action: 'EVENT_MODERATOR_TOKEN_ROTATE',
      target: EVENTO,
      actorHash: `admin:${ACCOUNT}`,
    });
    expect(JSON.stringify(data)).not.toContain(moderatorToken);
    expect(JSON.stringify(data)).not.toContain(TOKEN_VECCHIO);
  });
});
