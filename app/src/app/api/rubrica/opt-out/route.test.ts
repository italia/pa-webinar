// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
/**
 * La revoca dal link delle email: un solo consenso copre rubrica e
 * informazioni sui prossimi eventi, quindi la revoca li toglie entrambi.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    person: { findUnique: vi.fn(), update: vi.fn() },
    registration: { count: vi.fn() },
  },
}));
vi.mock('@/lib/live/consent-withdrawal', () => ({ ritiraComunicazioni: vi.fn() }));
vi.mock('@/lib/persons/opt-out-token', () => ({
  verifyRubricaOptOutToken: (token: string) => (token === 'buono' ? { personId: 'p-1' } : null),
}));

import { prisma } from '@/lib/db';
import { ritiraComunicazioni } from '@/lib/live/consent-withdrawal';

import { GET, POST } from './route';

function revoca(token: string): Promise<Response> {
  const request = new Request(`http://localhost:3000/api/rubrica/opt-out?token=${token}`, {
    method: 'POST',
    headers: { 'x-forwarded-for': '10.9.0.1' },
  });
  return POST(request as never, { params: Promise.resolve({}) } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.person.findUnique).mockResolvedValue({
    id: 'p-1',
    emailHash: 'impronta',
    displayName: 'x',
    organization: null,
    optedInToAddressBook: true,
    optedOutAt: null,
  } as never);
});

describe('GET /api/rubrica/opt-out', () => {
  const anteprima = async () =>
    (
      await GET(
        new Request('http://localhost:3000/api/rubrica/opt-out?token=buono') as never,
        { params: Promise.resolve({}) } as never
      )
    ).json();
  const uscita = {
    id: 'p-1',
    emailHash: 'impronta',
    displayName: 'x',
    organization: null,
    optedInToAddressBook: false,
    optedOutAt: new Date(),
  };

  it('chi e’ gia’ uscito, senza spunte in attesa, ha finito', async () => {
    vi.mocked(prisma.person.findUnique).mockResolvedValue(uscita as never);
    vi.mocked(prisma.registration.count).mockResolvedValue(0);
    expect(await anteprima()).toMatchObject({ alreadyOptedOut: true });
  });

  it('con una spunta in attesa il link propone ancora il ritiro', async () => {
    vi.mocked(prisma.person.findUnique).mockResolvedValue(uscita as never);
    vi.mocked(prisma.registration.count).mockResolvedValue(1);
    expect(await anteprima()).toMatchObject({ alreadyOptedOut: false });
    expect(prisma.registration.count).toHaveBeenCalledWith({
      where: { emailHash: 'impronta', addressBookPending: true },
    });
  });
});

describe('POST /api/rubrica/opt-out', () => {
  it('toglie la persona dalla rubrica e revoca le informazioni sui prossimi eventi', async () => {
    const res = await revoca('buono');
    expect(res.status).toBe(200);
    // Lo stesso ritiro della pagina dei propri dati, con la sua riga di audit.
    expect(ritiraComunicazioni).toHaveBeenCalledWith('impronta');
  });

  it('un token non valido non tocca niente', async () => {
    const res = await revoca('cattivo');
    expect(res.status).toBe(401);
    expect(ritiraComunicazioni).not.toHaveBeenCalled();
  });
});
