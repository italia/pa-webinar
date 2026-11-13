// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
/**
 * I testi delle email dell’istanza: li cambia solo l’amministrazione, una riga
 * per chiave e lingua, e un campo lasciato vuoto torna al testo predefinito.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, sessione } = vi.hoisted(() => ({
  prisma: {
    staffAccount: { findUnique: vi.fn() },
    adminAuditLog: { create: vi.fn() },
    emailTemplate: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
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

import { DELETE, GET, PUT } from './route';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';

function chiama(handler: typeof GET, method: string, corpo?: unknown) {
  const request = new Request('http://localhost/api/admin/email-templates', {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(corpo !== undefined
      ? { body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo) }
      : {}),
  });
  return handler(request as never, { params: Promise.resolve({}) });
}

async function entra(role: 'ADMIN' | 'ORGANIZER') {
  prisma.staffAccount.findUnique.mockResolvedValue({
    id: ACCOUNT,
    active: true,
    role,
    emailHash: 'impronta-account',
  });
  sessione.cookie = await signStaffSession({ id: ACCOUNT, role });
}

const riga = (extra: Record<string, unknown> = {}) => ({
  id: 'riga-1',
  key: 'reminder',
  locale: 'it',
  subject: 'Oggetto',
  heading: null,
  bodyIntro: null,
  ctaLabel: null,
  infoNote: null,
  footerNote: null,
  updatedAt: new Date('2026-10-01T08:00:00Z'),
  updatedBy: null,
  ...extra,
});

const nessunaScrittura = () => {
  expect(prisma.emailTemplate.upsert).not.toHaveBeenCalled();
  expect(prisma.emailTemplate.deleteMany).not.toHaveBeenCalled();
};

beforeAll(() => {
  process.env.APP_SECRET = 'segreto-di-prova-dei-testi-email-abbastanza-lungo';
});

beforeEach(async () => {
  vi.clearAllMocks();
  await entra('ADMIN');
  prisma.emailTemplate.findMany.mockResolvedValue([riga()]);
  prisma.emailTemplate.upsert.mockResolvedValue(riga());
  prisma.emailTemplate.deleteMany.mockResolvedValue({ count: 1 });
});

describe('chi puo’ entrare', () => {
  const chiamate = () => [
    chiama(GET, 'GET'),
    chiama(PUT, 'PUT', { key: 'reminder', locale: 'it', subject: 'Oggetto' }),
    chiama(DELETE, 'DELETE', { key: 'reminder', locale: 'it' }),
  ];

  it('senza sessione e’ 401, e non si legge ne’ si scrive niente', async () => {
    sessione.cookie = undefined;
    const risposte = await Promise.all(chiamate());
    expect(risposte.map((r) => r.status)).toEqual([401, 401, 401]);
    expect(prisma.emailTemplate.findMany).not.toHaveBeenCalled();
    nessunaScrittura();
  });

  it('chi organizza e’ rifiutato: i testi sono dell’istanza', async () => {
    await entra('ORGANIZER');
    const risposte = await Promise.all(chiamate());
    expect(risposte.map((r) => r.status)).toEqual([401, 401, 401]);
    expect(prisma.emailTemplate.findMany).not.toHaveBeenCalled();
    nessunaScrittura();
  });
});

describe('GET', () => {
  it('consegna le righe senza farle tenere in cache', async () => {
    const r = await chiama(GET, 'GET');
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    const corpo = (await r.json()) as { rows: Array<{ key: string; updatedAt: string }> };
    expect(corpo.rows[0]).toMatchObject({
      key: 'reminder',
      updatedAt: '2026-10-01T08:00:00.000Z',
    });
  });
});

describe('PUT', () => {
  it('rifiuta chiave, lingua o testi fuori misura senza scrivere', async () => {
    const corpi = [
      { key: 'altra-chiave', locale: 'it' },
      { key: 'reminder', locale: 'pt' },
      { key: 'reminder', locale: 'it', subject: 'x'.repeat(201) },
      { key: 'reminder', locale: 'it', bodyIntro: 'x'.repeat(2001) },
    ];
    for (const corpo of corpi) {
      expect((await chiama(PUT, 'PUT', corpo)).status).toBe(422);
    }
    nessunaScrittura();
  });

  it('un corpo che non e’ JSON e’ 400', async () => {
    expect((await chiama(PUT, 'PUT', 'non-json')).status).toBe(400);
    nessunaScrittura();
  });

  it('scrive sulla riga di chiave e lingua; un campo vuoto torna al predefinito', async () => {
    const r = await chiama(PUT, 'PUT', {
      key: 'reminder',
      locale: 'fr',
      subject: 'Rappel',
      heading: '   ',
      bodyIntro: '',
      ctaLabel: null,
    });
    expect(r.status).toBe(200);
    const argomenti = prisma.emailTemplate.upsert.mock.calls[0]![0];
    const campi = {
      subject: 'Rappel',
      heading: null,
      bodyIntro: null,
      ctaLabel: null,
      infoNote: null,
      footerNote: null,
    };
    expect(argomenti.where).toEqual({ key_locale: { key: 'reminder', locale: 'fr' } });
    expect(argomenti.update).toEqual(campi);
    expect(argomenti.create).toEqual({ key: 'reminder', locale: 'fr', ...campi });
  });

  it('lascia traccia di chiave e lingua', async () => {
    await chiama(PUT, 'PUT', { key: 'reminder', locale: 'it', subject: 'Oggetto' });
    expect(prisma.adminAuditLog.create.mock.calls[0]![0].data).toMatchObject({
      action: 'EMAIL_TEMPLATE_UPSERT',
      target: 'riga-1',
      details: JSON.stringify({ key: 'reminder', locale: 'it' }),
    });
  });
});

describe('DELETE', () => {
  it('toglie solo la riga di quella chiave e lingua, e ne lascia traccia', async () => {
    const r = await chiama(DELETE, 'DELETE', { key: 'confirmation', locale: 'de' });
    expect(r.status).toBe(200);
    expect(prisma.emailTemplate.deleteMany.mock.calls[0]![0]).toEqual({
      where: { key: 'confirmation', locale: 'de' },
    });
    expect(prisma.adminAuditLog.create.mock.calls[0]![0].data.action).toBe(
      'EMAIL_TEMPLATE_DELETE'
    );
  });

  it('si cancella anche una lingua in cui le email non partono piu’', async () => {
    const r = await chiama(DELETE, 'DELETE', { key: 'reminder', locale: 'pt' });
    expect(r.status).toBe(200);
    expect(prisma.emailTemplate.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('una chiave sconosciuta o una lingua malformata sono 422', async () => {
    const corpi = [
      { key: 'altra-chiave', locale: 'it' },
      { key: 'reminder', locale: 'ita' },
    ];
    for (const corpo of corpi) {
      expect((await chiama(DELETE, 'DELETE', corpo)).status).toBe(422);
    }
    nessunaScrittura();
  });
});
