// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ callSession: { findFirst: vi.fn() } }));
vi.mock('@/lib/db', () => ({ prisma: db }));

import { salaForseAperta, salaGiaAperta } from './room-open';

beforeEach(() => db.callSession.findFirst.mockReset());

describe('salaForseAperta', () => {
  it('in diretta o mentre si prepara, si', async () => {
    for (const status of ['LIVE', 'PROVISIONING', 'IDLE']) {
      expect(await salaForseAperta({ id: 'e1', status })).toBe(true);
    }
    expect(db.callSession.findFirst).not.toHaveBeenCalled();
  });

  it('pubblicato: solo con una sessione aperta di recente (chi conduce entra prima)', async () => {
    db.callSession.findFirst.mockResolvedValueOnce({ id: 's1' });
    expect(await salaForseAperta({ id: 'e1', status: 'PUBLISHED' })).toBe(true);
    db.callSession.findFirst.mockResolvedValueOnce(null);
    expect(await salaForseAperta({ id: 'e1', status: 'PUBLISHED' })).toBe(false);
  });

  it('bozza o concluso, no', async () => {
    expect(await salaForseAperta({ id: 'e1', status: 'DRAFT' })).toBe(false);
    expect(await salaForseAperta({ id: 'e1', status: 'ENDED' })).toBe(false);
  });
});

describe('salaGiaAperta', () => {
  it('a evento concluso si, anche senza una sessione registrata', async () => {
    for (const status of ['ENDED', 'ARCHIVED']) {
      expect(await salaGiaAperta({ id: 'e1', status })).toBe(true);
    }
    expect(db.callSession.findFirst).not.toHaveBeenCalled();
  });

  it('con la sala aperta adesso si', async () => {
    expect(await salaGiaAperta({ id: 'e1', status: 'LIVE' })).toBe(true);
  });

  it('pubblicato, con una sessione già chiusa: si', async () => {
    db.callSession.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'chiusa' });
    expect(await salaGiaAperta({ id: 'e1', status: 'PUBLISHED' })).toBe(true);
    expect(db.callSession.findFirst).toHaveBeenLastCalledWith({
      where: { eventId: 'e1' },
      select: { id: true },
    });
  });

  it('mai aperta: no', async () => {
    db.callSession.findFirst.mockResolvedValue(null);
    expect(await salaGiaAperta({ id: 'e1', status: 'PUBLISHED' })).toBe(false);
    expect(await salaGiaAperta({ id: 'e1', status: 'DRAFT' })).toBe(false);
  });
});
