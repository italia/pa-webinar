// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Cambiare l'indirizzo di un invito lo rimette «da inviare»: l'invito non e'
 * arrivato al nuovo indirizzo, e il link di quello vecchio non deve aprire il
 * modulo con i dati nuovi: le email del vecchio indirizzo se ne vanno con lui.
 * Token e impronta non escono dalla risposta.
 */
const EVENTO = '11111111-2222-4333-8444-555555555555';
const INVITO = '22222222-3333-4444-8555-666666666666';
const db = vi.hoisted(() => ({
  eventInvitation: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  person: { findUnique: vi.fn() },
  registration: { findFirst: vi.fn() },
  emailOutbox: { deleteMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('@/lib/auth/staff-session', () => ({
  requireEventManager: vi.fn(async () => ({ role: 'admin' })),
}));
vi.mock('@/lib/audit/admin-audit', () => ({ logAdminAction: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/crypto/pii', () => ({
  encryptPII: (v: string) => `cif:${v}`,
  encryptPIIOrNull: (v: string | null) => (v ? `cif:${v}` : null),
  hashEmail: (v: string) => `h:${v}`,
  tryDecryptPII: (v: string | null) => (v ? v.replace(/^cif:/, '') : null),
}));

import { DELETE, PATCH } from './route';

const richiesta = (body: unknown) =>
  new Request(`http://localhost/api/admin/events/${EVENTO}/invitations/${INVITO}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
const ctx = { params: Promise.resolve({ id: EVENTO, invId: INVITO }) };

beforeEach(() => {
  for (const f of Object.values(db.eventInvitation)) f.mockReset();
  db.emailOutbox.deleteMany.mockReset().mockResolvedValue({ count: 0 });
  db.$transaction.mockReset().mockImplementation((fn: (tx: typeof db) => unknown) => fn(db));
  const riga = { id: INVITO, eventId: EVENTO };
  db.eventInvitation.findUnique.mockResolvedValue(riga);
  // Un invito fermato su un altro indirizzo: di norma nessuno.
  db.eventInvitation.findFirst.mockResolvedValue(null);
  db.person.findUnique.mockReset().mockResolvedValue(null);
  db.registration.findFirst.mockReset().mockResolvedValue(null);
  db.eventInvitation.update.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: INVITO,
      eventId: EVENTO,
      name: 'cif:Ada',
      email: (data.email as string) ?? 'cif:vecchia@example.org',
      emailHash: 'h:x',
      token: (data.token as string | null | undefined) ?? 'tok',
      sentAt: null,
    })
  );
});

describe('PATCH un invito', () => {
  it("con un indirizzo nuovo toglie le email del vecchio, anche gia' inviate", async () => {
    await PATCH(richiesta({ email: 'nuova@example.org' }) as never, ctx as never);
    expect(db.emailOutbox.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ dedupKey: { startsWith: `event-invitation:${INVITO}:` } }] },
    });
    expect(db.emailOutbox.deleteMany.mock.invocationCallOrder[0]!).toBeLessThan(
      db.eventInvitation.update.mock.invocationCallOrder[0]!
    );
  });

  it("riscrivendo lo stesso indirizzo o solo il nome le email restano", async () => {
    db.eventInvitation.findUnique.mockResolvedValue({
      id: INVITO,
      eventId: EVENTO,
      emailHash: 'h:stessa@example.org',
    });
    await PATCH(richiesta({ email: 'stessa@example.org' }) as never, ctx as never);
    await PATCH(richiesta({ name: 'Ada' }) as never, ctx as never);
    expect(db.emailOutbox.deleteMany).not.toHaveBeenCalled();
    expect(db.eventInvitation.update).toHaveBeenCalledTimes(2);
  });

  it("con un indirizzo nuovo azzera token, invio e stop, e non restituisce token ne' impronta", async () => {
    const res = await PATCH(
      richiesta({ email: 'Nuova@Example.org' }) as never,
      ctx as never
    );
    expect(res.status).toBe(200);
    const data = db.eventInvitation.update.mock.calls[0]![0].data;
    expect(data).toMatchObject({
      email: 'cif:nuova@example.org',
      emailHash: 'h:nuova@example.org',
      token: null,
      sentAt: null,
      declinedAt: null,
    });
    const corpo = await res.json();
    expect(corpo).not.toHaveProperty('token');
    expect(corpo).not.toHaveProperty('emailHash');
    expect(corpo.email).toBe('nuova@example.org');
  });

  it('un indirizzo che ha smesso di ricevere inviti nasce fermo anche su questa riga', async () => {
    const quando = new Date('2026-11-01T10:00:00Z');
    db.eventInvitation.findUnique.mockResolvedValue({
      id: INVITO,
      eventId: EVENTO,
      emailHash: 'h:prima@example.org',
      declinedAt: null,
    });
    db.person.findUnique.mockResolvedValue({ optedInToAddressBook: false, optedOutAt: quando });
    await PATCH(richiesta({ email: 'ritirata@example.org' }) as never, ctx as never);
    const { data } = db.eventInvitation.update.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(data.declinedAt).toBeInstanceOf(Date);
    expect(data.token).toBeNull();
    expect(data.sentAt).toBeNull();
  });

  it('tornando su un indirizzo fermato lo stop resta', async () => {
    const quando = new Date('2026-11-01T10:00:00Z');
    db.eventInvitation.findUnique.mockResolvedValue({
      id: INVITO,
      eventId: EVENTO,
      emailHash: 'h:prima@example.org',
      declinedAt: quando,
    });
    db.registration.findFirst.mockResolvedValue({ id: 'iscrizione-con-ritiro' });
    await PATCH(richiesta({ email: 'ritirata@example.org' }) as never, ctx as never);
    const { data } = db.eventInvitation.update.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(data.declinedAt).toBe(quando);
  });

  it('riscrivendo lo stesso indirizzo uno stop del ritiro resta, con token e invio', async () => {
    db.eventInvitation.findUnique.mockResolvedValue({
      id: INVITO,
      eventId: EVENTO,
      emailHash: 'h:stessa@example.org',
      declinedAt: new Date('2026-11-01T10:00:00Z'),
    });
    const res = await PATCH(
      richiesta({ email: 'Stessa@example.org' }) as never,
      ctx as never
    );
    expect(res.status).toBe(200);
    const { data } = db.eventInvitation.update.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(data).not.toHaveProperty('declinedAt');
    expect(data).not.toHaveProperty('token');
    expect(data).not.toHaveProperty('sentAt');
  });

  it('una riga senza impronta si confronta sull’indirizzo: riscriverlo non toglie lo stop', async () => {
    db.eventInvitation.findUnique.mockResolvedValue({
      id: INVITO,
      eventId: EVENTO,
      email: 'cif:stessa@example.org',
      emailHash: null,
      declinedAt: new Date('2026-11-01T10:00:00Z'),
    });
    await PATCH(richiesta({ email: 'stessa@example.org' }) as never, ctx as never);
    const { data } = db.eventInvitation.update.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(data).not.toHaveProperty('declinedAt');
  });

  it("cambiando solo il nome l'invito resta com'era", async () => {
    await PATCH(richiesta({ name: 'Ada Rossi' }) as never, ctx as never);
    const data = db.eventInvitation.update.mock.calls[0]![0].data;
    expect(data).not.toHaveProperty('token');
    expect(data).not.toHaveProperty('sentAt');
  });
});

describe('DELETE un invito', () => {
  it('toglie le sue email ancora da inviare prima della riga', async () => {
    db.eventInvitation.delete.mockResolvedValue({});
    const res = await DELETE(
      new Request(`http://localhost/api/admin/events/${EVENTO}/invitations/${INVITO}`, {
        method: 'DELETE',
      }) as never,
      ctx as never
    );
    expect(res.status).toBe(200);
    expect(db.emailOutbox.deleteMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['PENDING', 'FAILED'] },
        OR: [{ dedupKey: { startsWith: `event-invitation:${INVITO}:` } }],
      },
    });
    expect(db.emailOutbox.deleteMany.mock.invocationCallOrder[0]!).toBeLessThan(
      db.eventInvitation.delete.mock.invocationCallOrder[0]!
    );
  });
});
