// @vitest-environment node
/**
 * La scheda di una persona in rubrica: solo l’amministrazione la apre. Il nome
 * e’ cifrato a riposo e arriva in chiaro solo qui, l’impronta dell’indirizzo non
 * esce mai, e la cancellazione (art. 17) non lascia dati personali nella traccia.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, sessione } = vi.hoisted(() => ({
  prisma: {
    staffAccount: { findUnique: vi.fn() },
    adminAuditLog: { create: vi.fn() },
    person: { findUnique: vi.fn(), delete: vi.fn() },
  },
  sessione: { cookie: undefined as string | undefined },
}));

vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) =>
      nome === 'admin_session' && sessione.cookie
        ? { value: sessione.cookie }
        : undefined,
  }),
}));

import { signStaffSession } from '@/lib/auth/staff-session';
import { encryptPII } from '@/lib/crypto/pii';

import { DELETE, GET } from './route';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const PERSONA = '66666666-6666-4666-8666-666666666666';
const IMPRONTA = 'f'.repeat(64);

function chiama(handler: typeof GET, method: string) {
  const request = new Request(`http://localhost/api/admin/rubrica/${PERSONA}`, {
    method,
  });
  return handler(request as never, { params: Promise.resolve({ id: PERSONA }) });
}
const apri = () => chiama(GET, 'GET');
const cancella = () => chiama(DELETE, 'DELETE');

async function entra(role: 'ADMIN' | 'ORGANIZER') {
  prisma.staffAccount.findUnique.mockResolvedValue({
    id: ACCOUNT,
    active: true,
    role,
    emailHash: 'impronta-account',
  });
  sessione.cookie = await signStaffSession({ id: ACCOUNT, role });
}

const persona = () => ({
  id: PERSONA,
  emailHash: IMPRONTA,
  displayName: encryptPII('Anna Bianchi'),
  organization: 'Comune',
  organizationRole: null,
  organizationType: 'MUNICIPALITY',
  optedInToAddressBook: true,
  optedInAt: new Date('2026-01-01T08:00:00Z'),
  optedOutAt: null,
  lastActiveAt: new Date('2026-10-01T08:00:00Z'),
  retentionMonths: 24,
  createdAt: new Date('2026-01-01T08:00:00Z'),
  updatedAt: new Date('2026-10-01T08:00:00Z'),
  registrations: [
    {
      id: 'r1',
      createdAt: new Date('2026-09-01T08:00:00Z'),
      organization: 'Comune',
      organizationRole: null,
      organizationType: null,
      accessToken: 'token-segreto-di-accesso',
      event: {
        id: 'e1',
        slug: 'evento',
        title: { it: 'Evento' },
        startsAt: new Date('2026-09-02T08:00:00Z'),
      },
    },
  ],
});

beforeAll(() => {
  process.env.PII_ENCRYPTION_KEY = 'a'.repeat(64);
  process.env.APP_SECRET = 'segreto-di-prova-della-rubrica-abbastanza-lungo';
});

beforeEach(async () => {
  vi.clearAllMocks();
  await entra('ADMIN');
  prisma.person.findUnique.mockResolvedValue(persona());
  prisma.person.delete.mockResolvedValue({ id: PERSONA });
});

describe('chi puo’ entrare', () => {
  it('senza sessione e’ 401, e la persona non si legge', async () => {
    sessione.cookie = undefined;
    expect((await apri()).status).toBe(401);
    expect((await cancella()).status).toBe(401);
    expect(prisma.person.findUnique).not.toHaveBeenCalled();
    expect(prisma.person.delete).not.toHaveBeenCalled();
  });

  it('chi organizza e’ rifiutato: la rubrica e’ dell’amministrazione', async () => {
    await entra('ORGANIZER');
    expect((await apri()).status).toBe(401);
    expect((await cancella()).status).toBe(401);
    expect(prisma.person.findUnique).not.toHaveBeenCalled();
    expect(prisma.person.delete).not.toHaveBeenCalled();
  });
});

describe('GET', () => {
  it('una persona che non esiste e’ 404', async () => {
    prisma.person.findUnique.mockResolvedValue(null);
    expect((await apri()).status).toBe(404);
  });

  it('il nome arriva in chiaro, senza cache', async () => {
    const r = await apri();
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect(prisma.person.findUnique.mock.calls[0]![0].where).toEqual({ id: PERSONA });
    expect(await r.json()).toMatchObject({
      id: PERSONA,
      displayName: 'Anna Bianchi',
      organization: 'Comune',
      optedInToAddressBook: true,
      optedInAt: '2026-01-01T08:00:00.000Z',
      optedOutAt: null,
    });
  });

  it('elenca le iscrizioni con il loro evento', async () => {
    const corpo = (await (await apri()).json()) as { registrations: unknown[] };
    expect(corpo.registrations).toEqual([
      {
        id: 'r1',
        createdAt: '2026-09-01T08:00:00.000Z',
        organization: 'Comune',
        organizationRole: null,
        organizationType: null,
        event: {
          id: 'e1',
          slug: 'evento',
          title: { it: 'Evento' },
          startsAt: '2026-09-02T08:00:00.000Z',
        },
      },
    ]);
  });

  it('non escono impronta dell’indirizzo ne’ token di accesso', async () => {
    const testo = await (await apri()).text();
    expect(testo).not.toContain(IMPRONTA);
    expect(testo).not.toContain('token-segreto-di-accesso');
  });
});

describe('DELETE', () => {
  it('una persona che non esiste e’ 404, senza traccia', async () => {
    prisma.person.findUnique.mockResolvedValue(null);
    expect((await cancella()).status).toBe(404);
    expect(prisma.person.delete).not.toHaveBeenCalled();
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it('cancella la persona indicata', async () => {
    const r = await cancella();
    expect(r.status).toBe(200);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect(prisma.person.delete.mock.calls[0]![0]).toEqual({ where: { id: PERSONA } });
  });

  it('la traccia dice chi e’ stato cancellato solo con l’identificativo', async () => {
    await cancella();
    expect(prisma.adminAuditLog.create.mock.calls[0]![0].data).toMatchObject({
      action: 'RUBRICA_PERSON_DELETE',
      target: PERSONA,
      details: null,
    });
  });
});
