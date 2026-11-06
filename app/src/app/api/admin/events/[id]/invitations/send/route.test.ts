// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * L'invio degli inviti dalla pagina dell'evento: chi gestisce l'evento li
 * manda quando e' pubblicato; una bozza risponde 409; il corpo e' validato.
 */
const ID = '11111111-2222-4333-8444-555555555555';
const db = vi.hoisted(() => ({
  event: { findUnique: vi.fn() },
  eventInvitation: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
    findUnique: vi.fn(),
  },
  registration: { findMany: vi.fn() },
  person: { findMany: vi.fn() },
}));
const coda = vi.hoisted(() => ({
  enqueueEmailOnce: vi.fn(async () => true),
  chiaveEmailInvito: (id: string) => `event-invitation:${id}:`,
}));
vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('@/lib/auth/staff-session', () => ({
  requireEventManager: vi.fn(async () => ({ role: 'organizer' })),
}));
vi.mock('@/lib/audit/admin-audit', () => ({ logAdminAction: vi.fn() }));
vi.mock('@/lib/settings', () => ({
  getSettings: async () => ({
    defaultLocale: 'it',
    publicRegistrationEnabled: true,
    siteName: 'Prova',
  }),
}));
vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/email/outbox', () => coda);
vi.mock('@/lib/crypto/pii', () => ({
  tryDecryptPII: (v: string | null) => v,
  hashEmail: (v: string) => `h:${v}`,
}));
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (chiave: string) => chiave,
}));

import { POST } from './route';

const evento = (status: string) => ({
  id: ID,
  slug: 'evento',
  title: { it: 'Evento', en: 'Event' },
  status,
  eventType: 'SCHEDULED',
  accessMode: 'INVITATION',
  startsAt: new Date('2099-11-10T09:00:00Z'),
  endsAt: new Date('2099-11-10T10:00:00Z'),
  timezone: 'Europe/Rome',
});
const richiesta = (body: unknown) =>
  new Request(`http://localhost/api/admin/events/${ID}/invitations/send?locale=en`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
const ctx = { params: Promise.resolve({ id: ID }) };

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://webinar.example.org');
  for (const f of [
    db.event.findUnique,
    db.eventInvitation.findMany,
    db.eventInvitation.updateMany,
    db.eventInvitation.findUnique,
    db.registration.findMany,
    db.person.findMany,
  ])
    f.mockReset();
  coda.enqueueEmailOnce.mockClear();
  db.registration.findMany.mockResolvedValue([]);
  db.person.findMany.mockResolvedValue([]);
  db.eventInvitation.findUnique.mockResolvedValue({ token: 'tok' });
});

describe('POST /api/admin/events/[id]/invitations/send', () => {
  it('manda gli inviti nella lingua della pagina, riservati agli invitati', async () => {
    db.event.findUnique.mockResolvedValue(evento('PUBLISHED'));
    db.eventInvitation.findMany.mockResolvedValue([
      {
        id: 'i1',
        name: 'Ada',
        email: 'ada@example.org',
        emailHash: 'h:ada@example.org',
        token: null,
      },
    ]);
    const res = await POST(richiesta({}) as never, ctx as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 1, skipped: 0, remaining: 0 });
    const mail = (
      coda.enqueueEmailOnce.mock.calls as unknown as Array<
        [{ subject: string; text: string }]
      >
    )[0]![0];
    expect(mail.subject).toBe('Invitation: Event');
    expect(mail.text).toContain('Registration is reserved for invited people');
    expect(mail.text).not.toContain('addressBook');
  });

  it("l'esito conta fra i saltati chi ha ritirato il consenso alla rubrica", async () => {
    db.event.findUnique.mockResolvedValue(evento('PUBLISHED'));
    db.eventInvitation.findMany.mockResolvedValue([
      {
        id: 'i1',
        name: null,
        email: 'ada@example.org',
        emailHash: 'h:ada@example.org',
        token: 'tok',
      },
    ]);
    db.person.findMany.mockResolvedValue([
      {
        id: 'p1',
        emailHash: 'h:ada@example.org',
        optedInToAddressBook: false,
        optedOutAt: new Date('2026-11-01T10:00:00Z'),
      },
    ]);
    const res = await POST(richiesta({}) as never, ctx as never);
    expect(await res.json()).toEqual({ sent: 0, skipped: 1, remaining: 0 });
    expect(coda.enqueueEmailOnce).not.toHaveBeenCalled();
  });

  it('una bozza risponde 409 EVENT_NOT_SENDABLE, senza email', async () => {
    db.event.findUnique.mockResolvedValue(evento('DRAFT'));
    const res = await POST(richiesta({ ids: [ID] }) as never, ctx as never);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('EVENT_NOT_SENDABLE');
    expect(coda.enqueueEmailOnce).not.toHaveBeenCalled();
  });

  it('un evento che non esiste risponde 404', async () => {
    db.event.findUnique.mockResolvedValue(null);
    expect((await POST(richiesta({}) as never, ctx as never)).status).toBe(404);
  });

  it("un corpo con campi sconosciuti o id non validi e' rifiutato", async () => {
    expect((await POST(richiesta({ tutti: true }) as never, ctx as never)).status).toBe(
      422
    );
    expect((await POST(richiesta({ ids: ['x'] }) as never, ctx as never)).status).toBe(
      422
    );
    expect(coda.enqueueEmailOnce).not.toHaveBeenCalled();
  });
});
