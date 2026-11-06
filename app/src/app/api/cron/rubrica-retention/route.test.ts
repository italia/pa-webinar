// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * La conservazione della rubrica: i mesi si contano dal consenso, chi ha
 * ritirato esce alla prima corsa e una voce senza data non sparisce.
 */
const db = vi.hoisted(() => ({
  person: { findMany: vi.fn(), deleteMany: vi.fn() },
  eventInvitation: { deleteMany: vi.fn(), updateMany: vi.fn() },
}));
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

function corsa(
  ritirati: { id: string; emailHash: string }[],
  candidati: ReturnType<typeof riga>[]
) {
  db.person.findMany.mockResolvedValueOnce(ritirati).mockResolvedValueOnce(candidati);
  return GET(
    new Request('https://portale.example.test/api/cron/rubrica-retention') as never,
    { params: Promise.resolve({}) } as never
  );
}

beforeEach(() => {
  vi.useFakeTimers({ now: ADESSO });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  db.person.findMany.mockReset();
  db.person.deleteMany.mockReset();
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

  it('senza niente da cancellare non scrive', async () => {
    await corsa([], [riga('recente', '2026-10-01T10:00:00Z')]);
    expect(db.eventInvitation.deleteMany).not.toHaveBeenCalled();
    expect(db.eventInvitation.updateMany).not.toHaveBeenCalled();
    expect(db.person.deleteMany).not.toHaveBeenCalled();
  });
});
