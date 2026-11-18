// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    callSession: { findFirst: vi.fn() },
    registration: { findFirst: vi.fn() },
  },
}));
vi.mock('@/lib/db', () => ({ prisma }));

import { domandaDestinazione } from './destination-question';

const evento = (status: string) => ({ id: 'evt-1', status });

beforeEach(() => {
  vi.clearAllMocks();
  prisma.callSession.findFirst.mockResolvedValue(null);
  prisma.registration.findFirst.mockResolvedValue(null);
});

describe('domandaDestinazione', () => {
  it('mai aperto e senza iscrizioni: si chiede', async () => {
    expect(await domandaDestinazione(evento('DRAFT'))).toEqual({
      salaGiaAperta: false,
      daChiedere: true,
    });
  });

  it('con un iscritto no', async () => {
    prisma.registration.findFirst.mockResolvedValue({ id: 'r-1' });
    expect(await domandaDestinazione(evento('PUBLISHED'))).toEqual({
      salaGiaAperta: false,
      daChiedere: false,
    });
  });

  it('gia aperto no, senza contare gli iscritti', async () => {
    expect(await domandaDestinazione(evento('LIVE'))).toEqual({
      salaGiaAperta: true,
      daChiedere: false,
    });
    expect(prisma.registration.findFirst).not.toHaveBeenCalled();
  });
});
