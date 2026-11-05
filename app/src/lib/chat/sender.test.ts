import { describe, it, expect, vi, beforeEach } from 'vitest';

// resolveTokenSender pulls the grant resolver, the registration row, the PII
// decryptor, and the cookie-ownership reader. Mock all four so the test is a
// pure check of the identity gate: an owning registrant is named from their DB
// name; a forwarded-link opener is named from the typed override — never the
// registrant's DB name — while keeping the pre-existing reg-<id> seat.
vi.mock('@/lib/auth/moderator', () => ({
  resolveGrantForEvent: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  prisma: { registration: { findUnique: vi.fn() } },
}));
vi.mock('@/lib/crypto/pii', () => ({
  tryDecryptPII: (v: string) => v, // pass-through: stored name treated as plaintext
}));
vi.mock('@/lib/event-session', () => ({
  readOwnedEventAccessToken: vi.fn(),
}));
const staff = vi.hoisted(() => ({ valore: null as { accountId: string; nome: string } | null }));
vi.mock('@/lib/auth/staff-seat', () => ({ staffDietroIlPrimario: vi.fn(async () => staff.valore) }));
vi.mock('@/lib/live/pseudonym', () => ({ pseudonimo: vi.fn(async (_e: string, posto: string) => `Pseudo ${posto}`) }));

import { resolveGrantForEvent } from '@/lib/auth/moderator';
import { prisma } from '@/lib/db';
import { readOwnedEventAccessToken } from '@/lib/event-session';

import { resolveTokenSender } from './sender';

const mockedGrant = resolveGrantForEvent as unknown as ReturnType<typeof vi.fn>;
const mockedReg = prisma.registration.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedOwned = readOwnedEventAccessToken as unknown as ReturnType<typeof vi.fn>;

const EVENT = { id: 'evt-1', moderatorToken: 'MOD_TOKEN', moderatorName: 'Org' };

describe('resolveTokenSender — registration name gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGrant.mockResolvedValue(null); // participant token: never a grant
    mockedReg.mockResolvedValue({
      id: 'reg-99',
      displayName: 'Alice',
      eventId: 'evt-1',
    });
  });

  it('owner (cookie matches token): real DB name on the reg-<id> seat', async () => {
    mockedOwned.mockResolvedValue('ALICE_TOKEN');
    const sender = await resolveTokenSender(EVENT, 'ALICE_TOKEN', 'Whatever Typed');
    expect(sender).toEqual({
      eventId: 'evt-1',
      senderId: 'reg-reg-99',
      senderName: 'Alice', // DB name wins for the owner; typed override ignored
      isModerator: false,
      // Solo il browser che si è registrato è provabilmente questa persona.
      isPerPersonIdentity: true,
    });
  });

  it('forwarded opener (no matching cookie): typed name, NOT the DB name', async () => {
    mockedOwned.mockResolvedValue(null); // this browser owns no token for the event
    const sender = await resolveTokenSender(EVENT, 'ALICE_TOKEN', 'Bob');
    // Same reg-<id> seat as the owner (so analytics/rate-limit identity is unchanged),
    // but named from what Bob typed — never Alice's decrypted DB name.
    expect(sender).toEqual({
      eventId: 'evt-1',
      senderId: 'reg-reg-99',
      senderName: 'Bob',
      isModerator: false,
      // Link inoltrato: stesso posto, persona diversa — non può spacciarsi
      // per l'autore (di qui il divieto di modificare i messaggi).
      isPerPersonIdentity: false,
    });
    expect(sender?.senderName).not.toBe('Alice');
  });

  it('forwarded opener holding a DIFFERENT token is still not the owner', async () => {
    mockedOwned.mockResolvedValue('SOMEONE_ELSE_TOKEN');
    const sender = await resolveTokenSender(EVENT, 'ALICE_TOKEN', 'Bob');
    expect(sender?.senderName).toBe('Bob');
    expect(sender?.senderName).not.toBe('Alice');
  });

  it('forwarded opener with no typed name falls back to a generic label (never the DB name)', async () => {
    mockedOwned.mockResolvedValue(null);
    const sender = await resolveTokenSender(EVENT, 'ALICE_TOKEN');
    expect(sender?.senderName).toBe('Partecipante');
    expect(sender?.senderName).not.toBe('Alice');
  });

  it('never reads the ownership cookie for a grant (magic-link) token', async () => {
    // A moderator/co-mod/speaker magic link carries no event_access cookie: the
    // registration must not be looked up and the cookie must not be read.
    mockedGrant.mockResolvedValue({
      role: 'MODERATOR',
      displayName: 'Mara Mod',
      isPrimaryShared: false,
      grantId: 'g-1',
    });
    const sender = await resolveTokenSender(EVENT, 'CO_MOD_TOKEN');
    expect(sender?.isModerator).toBe(true);
    expect(sender?.senderName).toBe('Mara Mod');
    expect(mockedReg).not.toHaveBeenCalled();
    expect(mockedOwned).not.toHaveBeenCalled();
  });

  it('returns null for a token that matches no grant and no registration', async () => {
    mockedReg.mockResolvedValue(null);
    const sender = await resolveTokenSender(EVENT, 'BOGUS');
    expect(sender).toBeNull();
    expect(mockedOwned).not.toHaveBeenCalled(); // no registration → no cookie read
  });
});

describe('resolveTokenSender — il link primario aperto dallo staff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    staff.valore = null;
    mockedGrant.mockResolvedValue({ role: 'MODERATOR', displayName: null, isPrimaryShared: true, grantId: null });
  });

  it('senza sessione dello staff resta il posto condiviso', async () => {
    const sender = await resolveTokenSender(EVENT, 'MOD_TOKEN', 'Chi scrive');
    expect(sender).toMatchObject({ senderId: 'mod-evt-1-primary', senderName: 'Chi scrive', isPerPersonIdentity: false });
  });

  it('con la sessione di chi gestisce l\'evento: un posto suo, con il suo nome', async () => {
    staff.valore = { accountId: 'acc-7', nome: 'Ada Rossi' };
    // Il nome scritto in sala d'attesa non cambia quello garantito dall'account.
    const sender = await resolveTokenSender(EVENT, 'MOD_TOKEN', 'Un altro nome');
    expect(sender).toMatchObject({
      senderId: 'mod-evt-1-staff-acc-7',
      senderName: 'Ada Rossi',
      isModerator: true,
      isPerPersonIdentity: true,
    });
  });
});

describe('resolveTokenSender — pubblico anonimo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGrant.mockResolvedValue(null);
    mockedReg.mockResolvedValue({ id: 'reg-99', displayName: 'Alice', eventId: 'evt-1' });
  });

  it("l'iscritto scrive con lo pseudonimo del posto, anche dal suo browser", async () => {
    mockedOwned.mockResolvedValue('ACCESS');
    const sender = await resolveTokenSender({ ...EVENT, audienceAnonymous: true }, 'ACCESS');
    expect(sender).toMatchObject({ senderId: 'reg-reg-99', senderName: 'Pseudo reg-reg-99' });
    expect(sender?.senderName).not.toContain('Alice');
  });
});

