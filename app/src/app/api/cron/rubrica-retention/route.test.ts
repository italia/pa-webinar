// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * La conservazione della rubrica: i mesi si contano dal consenso, chi ha
 * ritirato esce alla prima corsa e una voce senza data non sparisce.
 */
const db = vi.hoisted(() => {
  const db = {
    person: { findMany: vi.fn(), deleteMany: vi.fn() },
    eventInvitation: { findMany: vi.fn(), deleteMany: vi.fn(), updateMany: vi.fn() },
    emailOutbox: { deleteMany: vi.fn() },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $transaction: (fn: (tx: unknown) => unknown) => fn(db),
  };
  return db;
});
vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/auth/cron', () => ({ assertCronApiKey: vi.fn() }));
vi.mock('@/lib/settings', () => ({
  getSettings: async () => ({ publicRegistrationEnabled: true }),
}));

import { GET } from './route';

const ADESSO = new Date('2026-11-06T10:00:00Z');
const riga = (id: string, optedInAt: string | null, retentionMonths = 24) => ({
  id,
  optedInAt: optedInAt ? new Date(optedInAt) : null,
  retentionMonths,
});

/** Le voci che, riletti, non sono piu' nello stato letto. */
let cambiate: string[] = [];

function corsa(
  ritirati: { id: string; emailHash: string }[],
  candidati: ReturnType<typeof riga>[]
) {
  const impronte = new Map(ritirati.map((p) => [p.id, p.emailHash]));
  db.person.findMany.mockImplementation(
    async ({
      where,
    }: {
      where: { AND?: [{ id: { in: string[] } }]; optedOutAt?: unknown };
    }) => {
      if (where.AND) {
        return where.AND[0].id.in
          .filter((id) => !cambiate.includes(id))
          .map((id) => ({ id, emailHash: impronte.get(id) ?? 'senza' }));
      }
      return where.optedOutAt ? ritirati : candidati;
    }
  );
  return GET(
    new Request('https://portale.example.test/api/cron/rubrica-retention') as never,
    { params: Promise.resolve({}) } as never
  );
}

beforeEach(() => {
  vi.useFakeTimers({ now: ADESSO });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  cambiate = [];
  db.person.findMany.mockReset();
  db.person.deleteMany.mockReset();
  db.eventInvitation.findMany.mockReset();
  db.eventInvitation.findMany.mockResolvedValue([]);
  db.$queryRaw.mockReset();
  db.$executeRaw.mockReset();
  db.$executeRaw.mockResolvedValue(0);
  db.eventInvitation.deleteMany.mockReset();
  db.eventInvitation.updateMany.mockReset();
  db.person.deleteMany.mockImplementation(async ({ where }) => ({
    count: where.id.in.length,
  }));
  db.eventInvitation.deleteMany.mockResolvedValue({ count: 0 });
  db.eventInvitation.updateMany.mockResolvedValue({ count: 0 });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('GET /api/cron/rubrica-retention', () => {
  it('legge le voci per data del consenso, le piu vecchie per prime', async () => {
    await corsa([], []);
    expect(db.person.findMany.mock.calls[1]![0]).toMatchObject({
      where: { optedInToAddressBook: true, optedInAt: { not: null } },
      select: { id: true, optedInAt: true, retentionMonths: true },
      orderBy: { optedInAt: 'asc' },
    });
  });

  it('cancella chi ha superato i mesi dal consenso, non chi e ancora dentro', async () => {
    const res = await corsa(
      [],
      [
        riga('scaduta', '2024-11-05T10:00:00Z'),
        riga('al-limite', '2024-11-06T10:00:01Z'),
        riga('breve', '2026-09-01T10:00:00Z', 1),
        riga('recente', '2026-10-01T10:00:00Z'),
      ]
    );
    expect(db.person.deleteMany).toHaveBeenCalledTimes(1);
    expect(db.person.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['scaduta', 'breve'] } },
    });
    expect(await res.json()).toEqual({
      ok: true,
      expiredDeleted: 2,
      optedOutDeleted: 0,
      scanned: 4,
      emailsFilled: 0,
    });
  });

  it('una voce senza data di consenso non e scaduta: niente 1970', async () => {
    const res = await corsa([], [riga('senza-data', null)]);
    expect(db.person.deleteMany).not.toHaveBeenCalled();
    expect((await res.json()).expiredDeleted).toBe(0);
  });

  it('chi ha ritirato esce subito, a qualunque data', async () => {
    const res = await corsa([{ id: 'ritirata', emailHash: 'impronta' }], []);
    expect(db.person.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['ritirata'] } },
    });
    expect((await res.json()).optedOutDeleted).toBe(1);
  });

  it('chi ha ritirato ferma anche gli inviti scritti a mano, per impronta', async () => {
    await corsa([{ id: 'ritirata', emailHash: 'impronta' }], []);
    expect(db.eventInvitation.deleteMany.mock.calls[0]![0].where.AND).toEqual([
      {
        OR: [{ personId: { in: ['ritirata'] } }, { emailHash: { in: ['impronta'] } }],
      },
    ]);
  });

  it('prima della voce scaduta ferma gli inviti nati dalla rubrica, e solo quelli', async () => {
    const ordine: string[] = [];
    db.eventInvitation.updateMany.mockImplementation(async () => {
      ordine.push('inviti');
      return { count: 1 };
    });
    db.person.deleteMany.mockImplementation(async () => {
      ordine.push('voce');
      return { count: 1 };
    });
    await corsa([], [riga('scaduta', '2020-01-01T00:00:00Z')]);
    expect(db.eventInvitation.updateMany).toHaveBeenCalledWith({
      where: { AND: [{ personId: { in: ['scaduta'] } }], declinedAt: null },
      data: { declinedAt: ADESSO },
    });
    expect(ordine).toEqual(['inviti', 'voce']);
  });

  it('una voce rinnovata tra la lettura e la cancellazione resta, con i suoi inviti', async () => {
    cambiate = ['rinnovata'];
    const res = await corsa(
      [{ id: 'rinnovata', emailHash: 'impronta' }],
      [riga('scaduta', '2020-01-01T00:00:00Z')]
    );
    expect(db.person.deleteMany).toHaveBeenCalledTimes(1);
    expect(db.person.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['scaduta'] } },
    });
    expect(await res.json()).toMatchObject({ optedOutDeleted: 0, expiredDeleted: 1 });
  });

  it('una voce scaduta si ricontrolla sulla data del consenso letta', async () => {
    const letta = riga('scaduta', '2020-01-01T00:00:00Z');
    await corsa([], [letta]);
    const [, stato] = db.person.findMany.mock.calls[2]![0].where.AND;
    expect(stato).toEqual({
      OR: [{ id: 'scaduta', optedInToAddressBook: true, optedInAt: letta.optedInAt }],
    });
  });

  it('completa le voci arrivate senza email e lo dice', async () => {
    db.$executeRaw.mockResolvedValue(3);
    const res = await corsa([], []);
    expect((await res.json()).emailsFilled).toBe(3);
  });

  it('senza niente da cancellare non scrive', async () => {
    await corsa([], [riga('recente', '2026-10-01T10:00:00Z')]);
    expect(db.eventInvitation.deleteMany).not.toHaveBeenCalled();
    expect(db.eventInvitation.updateMany).not.toHaveBeenCalled();
    expect(db.person.deleteMany).not.toHaveBeenCalled();
  });
});
