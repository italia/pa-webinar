// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Cambiare l'indirizzo di un invito lo rimette «da inviare»: l'invito non e'
 * arrivato al nuovo indirizzo, e il link di quello vecchio non deve aprire il
 * modulo con i dati nuovi. Token e impronta non escono dalla risposta.
 */
const EVENTO = '11111111-2222-4333-8444-555555555555';
const INVITO = '22222222-3333-4444-8555-666666666666';
const db = vi.hoisted(() => ({
  eventInvitation: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
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

import { PATCH } from './route';

const richiesta = (body: unknown) =>
  new Request(`http://localhost/api/admin/events/${EVENTO}/invitations/${INVITO}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
const ctx = { params: Promise.resolve({ id: EVENTO, invId: INVITO }) };

beforeEach(() => {
  for (const f of Object.values(db.eventInvitation)) f.mockReset();
  const riga = { id: INVITO, eventId: EVENTO };
  db.eventInvitation.findUnique.mockResolvedValue(riga);
  db.eventInvitation.findFirst.mockResolvedValue(riga);
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
  it("con un indirizzo nuovo azzera token e invio, e non restituisce token ne' impronta", async () => {
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
    });
    const corpo = await res.json();
    expect(corpo).not.toHaveProperty('token');
    expect(corpo).not.toHaveProperty('emailHash');
    expect(corpo.email).toBe('nuova@example.org');
  });

  it("cambiando solo il nome l'invito resta com'era", async () => {
    await PATCH(richiesta({ name: 'Ada Rossi' }) as never, ctx as never);
    const data = db.eventInvitation.update.mock.calls[0]![0].data;
    expect(data).not.toHaveProperty('token');
    expect(data).not.toHaveProperty('sentAt');
  });
});
