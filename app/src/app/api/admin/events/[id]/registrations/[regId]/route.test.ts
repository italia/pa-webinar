import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Rettifica e cancellazione di una singola iscrizione da parte dello staff:
 * solo su un'iscrizione dell'evento, valori cifrati, email unica nell'evento,
 * correzione portata anche sulla voce di rubrica e sulle email in coda,
 * cancellazione dell'iscrizione con i suoi contributi.
 */
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/lib/auth/staff-session', () => ({ requireEventManager: vi.fn(async () => ({ role: 'admin' })) }));
vi.mock('@/lib/audit/admin-audit', () => ({ logAdminAction: vi.fn(async () => undefined) }));
vi.mock('@/lib/gdpr/erase-registrations', () => ({
  eraseRegistrations: vi.fn(async () => ({
    registrations: 1,
    feedback: 0,
    questionnaireResponses: 0,
    chatMessages: 2,
    outboxRows: 1,
    attachmentFilesNotDeleted: 0,
  })),
}));
vi.mock('@/lib/crypto/pii', () => ({
  encryptPII: (s: string) => `enc(${s})`,
  hashEmail: (s: string) => `hash(${s})`,
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    registration: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), count: vi.fn() },
    person: { findUnique: vi.fn(), update: vi.fn() },
    emailOutbox: { updateMany: vi.fn() },
    gdprAuditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { requireEventManager } from '@/lib/auth/staff-session';
import { prisma } from '@/lib/db';
import { eraseRegistrations } from '@/lib/gdpr/erase-registrations';

import { DELETE, PATCH } from './route';

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as {
  registration: { findUnique: Fn; findFirst: Fn; update: Fn; count: Fn };
  person: { findUnique: Fn; update: Fn };
  emailOutbox: { updateMany: Fn };
  gdprAuditLog: { create: Fn };
  $transaction: Fn;
};

const EVENT = '11111111-1111-4111-8111-111111111111';
const REG = '44444444-4444-4444-8444-444444444444';
const PERSON = '55555555-5555-4555-8555-555555555555';
const ctx = { params: Promise.resolve({ id: EVENT, regId: REG }) };

function req(method: string, body?: unknown): Request {
  return new Request(`https://portale.example.test/api/admin/events/${EVENT}/registrations/${REG}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

function iscrizione(personId: string | null) {
  db.registration.findUnique.mockResolvedValue({
    id: REG,
    eventId: EVENT,
    emailHash: 'hash(vecchia@esempio.it)',
    personId,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
  iscrizione(null);
  db.registration.findFirst.mockResolvedValue(null);
  db.registration.update.mockResolvedValue({});
  db.registration.count.mockResolvedValue(0);
  db.person.findUnique.mockResolvedValue(null);
  db.person.update.mockResolvedValue({});
  db.emailOutbox.updateMany.mockResolvedValue({ count: 0 });
  db.gdprAuditLog.create.mockResolvedValue({});
});

describe('PATCH registration', () => {
  it('stores the corrected name and email encrypted, with the new hash', async () => {
    const res = await PATCH(
      req('PATCH', { displayName: 'Anna Bianchi', email: 'Anna@Esempio.it' }) as never,
      ctx as never,
    );
    expect(res.status).toBe(200);
    expect(requireEventManager).toHaveBeenCalled();
    expect(db.registration.update).toHaveBeenCalledWith({
      where: { id: REG },
      data: {
        displayName: 'enc(Anna Bianchi)',
        email: 'enc(anna@esempio.it)',
        emailHash: 'hash(anna@esempio.it)',
      },
    });
  });

  it('refuses an email already registered to the same event', async () => {
    db.registration.findFirst.mockResolvedValue({ id: 'altra' });
    const res = await PATCH(req('PATCH', { email: 'doppia@esempio.it' }) as never, ctx as never);
    expect(res.status).toBe(409);
    expect(db.registration.update).not.toHaveBeenCalled();
  });

  it('sends the emails still queued for the registration to the new address', async () => {
    db.emailOutbox.updateMany.mockResolvedValue({ count: 2 });
    const res = await PATCH(req('PATCH', { email: 'nuova@esempio.it' }) as never, ctx as never);
    expect(res.status).toBe(200);
    expect(db.emailOutbox.updateMany).toHaveBeenCalledWith({
      where: { status: 'PENDING', metadata: { path: ['registrationId'], equals: REG } },
      data: { toAddress: 'enc(nuova@esempio.it)' },
    });
  });

  it('leaves email and queue alone when the same address is written again', async () => {
    const res = await PATCH(req('PATCH', { email: 'vecchia@esempio.it' }) as never, ctx as never);
    expect(res.status).toBe(200);
    expect(db.emailOutbox.updateMany).not.toHaveBeenCalled();
    expect(db.registration.update).toHaveBeenCalledWith({ where: { id: REG }, data: {} });
  });

  it('carries an administrator\'s correction to the linked address-book entry', async () => {
    iscrizione(PERSON);
    const res = await PATCH(
      req('PATCH', { displayName: 'Anna Bianchi', organization: 'Comune' }) as never,
      ctx as never,
    );
    expect(res.status).toBe(200);
    expect(db.person.update).toHaveBeenCalledWith({
      where: { id: PERSON },
      data: { displayName: 'enc(Anna Bianchi)', organization: 'Comune' },
    });
  });

  it('keeps an organizer\'s correction on the registration only', async () => {
    vi.mocked(requireEventManager).mockResolvedValueOnce({ role: 'organizer', accountId: 'org-1' });
    iscrizione(PERSON);
    const res = await PATCH(req('PATCH', { displayName: 'Anna Bianchi' }) as never, ctx as never);
    expect(res.status).toBe(200);
    expect(db.registration.update).toHaveBeenCalled();
    expect(db.person.update).not.toHaveBeenCalled();
  });

  it('refuses a new email while the registration is linked to an address-book entry', async () => {
    iscrizione(PERSON);
    const res = await PATCH(req('PATCH', { email: 'nuova@esempio.it' }) as never, ctx as never);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('ADDRESS_BOOK_LINKED');
    expect(db.registration.update).not.toHaveBeenCalled();
    expect(db.emailOutbox.updateMany).not.toHaveBeenCalled();
  });

  it('answers 404 for a registration of another event', async () => {
    db.registration.findUnique.mockResolvedValue({
      id: REG,
      eventId: 'altro-evento',
      emailHash: 'x',
      personId: null,
    });
    const res = await PATCH(req('PATCH', { displayName: 'Anna' }) as never, ctx as never);
    expect(res.status).toBe(404);
  });

  it('rejects an empty change', async () => {
    const res = await PATCH(req('PATCH', {}) as never, ctx as never);
    // ValidationError: 422, come ogni corpo che non passa lo schema.
    expect(res.status).toBe(422);
  });
});

describe('DELETE registration', () => {
  it('erases it with its contributions and logs the deletion without personal data', async () => {
    const res = await DELETE(req('DELETE') as never, ctx as never);
    expect(res.status).toBe(200);
    expect(eraseRegistrations).toHaveBeenCalledWith([REG], expect.any(String));
    const audit = db.gdprAuditLog.create.mock.calls[0]![0] as {
      data: { action: string; details: string };
    };
    expect(audit.data.action).toBe('DATA_DELETED');
    expect(audit.data.details).toContain('admin-registration-delete');
  });
});
