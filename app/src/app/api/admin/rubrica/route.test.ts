// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  admin: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
}));
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
}));
vi.mock('@/lib/auth/admin-session', () => ({ isAdminAuthenticated: m.admin }));
vi.mock('@/lib/crypto/pii', () => ({
  // Senza la prima parte: il valore della riga e' il testo «cifrato».
  tryDecryptPII: (v: string | null) => (v ? v.replace(/^cifrato:/, '') : null),
}));
vi.mock('@/lib/db', () => ({
  prisma: { person: { findMany: m.findMany, count: m.count } },
}));

import { VOCI_ESAMINATE_MAX } from '@/lib/persons/ricerca-rubrica';

import { GET, POST } from './route';

const riga = (id: string, email: string | null = null, campi: object = {}) => ({
  id,
  displayName: 'cifrato:Nome',
  email,
  organization: 'Ente',
  organizationRole: null,
  organizationType: null,
  optedInToAddressBook: true,
  optedInAt: null,
  optedOutAt: null,
  lastActiveAt: new Date('2026-01-01'),
  retentionMonths: 24,
  createdAt: new Date('2026-01-01'),
  _count: { registrations: 2 },
  ...campi,
});

const cerca = (corpo: unknown) =>
  POST(
    new Request('http://x/api/admin/rubrica', {
      method: 'POST',
      body: JSON.stringify(corpo),
    }) as never,
    {} as never
  );

/** Le voci esaminate alla prima lettura; la seconda rilegge solo la pagina. */
function voci(...righe: ReturnType<typeof riga>[]) {
  m.findMany.mockReset();
  m.findMany.mockResolvedValueOnce(righe);
  m.findMany.mockImplementationOnce(async ({ where, take }) =>
    righe.filter((r) => where.AND[1].id.in.includes(r.id)).slice(0, take)
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  m.admin.mockResolvedValue(true);
  m.findMany.mockResolvedValue([riga('p1', 'cifrata'), riga('p2', 'altra')]);
  m.count.mockResolvedValue(2);
});

describe('GET /api/admin/rubrica', () => {
  it("solo l'amministrazione", async () => {
    m.admin.mockResolvedValueOnce(false);
    const res = await GET(
      new Request('http://x/api/admin/rubrica') as never,
      {} as never
    );
    expect(res.status).toBe(401);
  });

  it("non legge ne' restituisce indirizzi, nemmeno a chiederli", async () => {
    for (const url of [
      'http://x/api/admin/rubrica',
      'http://x/api/admin/rubrica?withEmail=1&limit=1000',
    ]) {
      m.findMany.mockClear();
      const res = await GET(new Request(url) as never, {} as never);
      const body = await res.json();
      expect(m.findMany.mock.calls[0]?.[0]?.select.email, url).toBe(false);
      expect(body.rows[0], url).not.toHaveProperty('email');
      expect(m.findMany.mock.calls[0]?.[0]?.where, url).toEqual({
        optedInToAddressBook: true,
      });
    }
  });

  it("un testo nell'URL non cerca: nomi e indirizzi non passano da li'", async () => {
    await GET(
      new Request('http://x/api/admin/rubrica?q=Nome') as never,
      {} as never
    );
    expect(m.findMany.mock.calls[0]?.[0]?.where).toEqual({
      optedInToAddressBook: true,
    });
  });
});

describe('POST /api/admin/rubrica', () => {
  it("solo l'amministrazione", async () => {
    m.admin.mockResolvedValueOnce(false);
    expect((await cerca({ q: 'nome' })).status).toBe(401);
    expect(m.findMany).not.toHaveBeenCalled();
  });

  it('rifiuta una ricerca vuota, un filtro sconosciuto o un limite fuori misura', async () => {
    for (const corpo of [
      { q: '   ' },
      { q: 'nome', orgType: 'NON_ESISTE' },
      { q: 'nome', limit: 5000 },
      { q: 'nome', offset: -1 },
    ]) {
      expect((await cerca(corpo)).status).toBe(422);
    }
    expect(m.findMany).not.toHaveBeenCalled();
  });

  it('trova per nome una voce senza ente', async () => {
    voci(
      riga('p1', 'cifrato:a@example.org', {
        displayName: 'cifrato:Giulia Rossi',
        organization: null,
      }),
      riga('p2', 'cifrato:b@example.org', {
        displayName: 'cifrato:Mario Bianchi',
        organization: null,
      })
    );
    const body = await (await cerca({ q: 'giulia', withEmail: true })).json();
    expect(body.rows.map((r: { id: string }) => r.id)).toEqual(['p1']);
    expect(body.total).toBe(1);
    expect(body.rows[0].email).toBe('a@example.org');
    expect(body).not.toHaveProperty('scanLimit');
  });

  it("trova per email, che resta fuori dalla risposta senza withEmail", async () => {
    voci(riga('p1', 'cifrato:a@example.org'), riga('p2', 'cifrato:b@example.org'));
    const body = await (await cerca({ q: 'B@EXAMPLE' })).json();
    expect(body.rows.map((r: { id: string }) => r.id)).toEqual(['p2']);
    expect(body.rows[0]).not.toHaveProperty('email');
    expect(m.findMany.mock.calls[1]?.[0]?.select.email).toBe(false);
  });

  it("con withEmail: solo le voci con un'email, letta dalla voce e decifrata", async () => {
    voci(riga('p1', 'cifrato:a@example.org'), riga('p2', 'cifrato:b@example.org'));
    const body = await (await cerca({ q: 'nome', withEmail: true })).json();
    expect(m.findMany.mock.calls[1]?.[0]?.select.email).toBe(true);
    expect(body.rows.map((r: { email: string | null }) => r.email)).toEqual([
      'a@example.org',
      'b@example.org',
    ]);
  });

  it("trova per ente, e con withEmail guarda solo le voci con un'email", async () => {
    voci(riga('p1', 'cifrato:a@example.org', { organization: 'Comune di Prova' }));
    const body = await (await cerca({ q: 'comune', withEmail: true })).json();
    expect(body.rows).toHaveLength(1);
    expect(m.findMany.mock.calls[0]?.[0]?.where).toEqual({
      optedInToAddressBook: true,
      email: { not: null },
    });
  });

  it('chi ha ritirato il consenso resta fuori, salvo richiesta esplicita', async () => {
    voci(riga('p1'));
    await cerca({ q: 'nome' });
    expect(m.findMany.mock.calls[0]?.[0]?.where).toEqual({ optedInToAddressBook: true });
    voci(riga('p1'));
    await cerca({ q: 'nome', includeOptedOut: true, orgType: 'MINISTRY' });
    expect(m.findMany.mock.calls[0]?.[0]?.where).toEqual({ organizationType: 'MINISTRY' });
  });

  it('pagina sulle voci trovate, con il totale di tutte', async () => {
    voci(riga('p1'), riga('p2'), riga('p3'));
    const body = await (await cerca({ q: 'nome', limit: 1, offset: 1 })).json();
    expect(body.rows.map((r: { id: string }) => r.id)).toEqual(['p2']);
    expect(body.total).toBe(3);
  });

  it('esamina al massimo il limite, e la risposta dice che ha guardato solo quelle', async () => {
    const tutte = Array.from({ length: VOCI_ESAMINATE_MAX + 1 }, (_, i) => riga(`p${i}`));
    tutte[VOCI_ESAMINATE_MAX] = riga('oltre', null, { displayName: 'cifrato:Fuori' });
    voci(...tutte);
    const body = await (await cerca({ q: 'fuori' })).json();
    expect(m.findMany.mock.calls[0]?.[0]?.take).toBe(VOCI_ESAMINATE_MAX + 1);
    expect(body.rows).toEqual([]);
    expect(body.scanLimit).toBe(VOCI_ESAMINATE_MAX);
  });

  it('non scrive nei log il testo cercato ne i dati decifrati', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    voci(riga('p1', 'cifrato:a@example.org', { displayName: 'cifrato:Giulia Rossi' }));
    await cerca({ q: 'giulia', withEmail: true });
    const scritto = JSON.stringify(log.mock.calls);
    log.mockRestore();
    expect(scritto).not.toContain('iulia');
    expect(scritto).not.toContain('example.org');
  });
});
