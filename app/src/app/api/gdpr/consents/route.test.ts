import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  ritiraConsensi: vi.fn(async () => ({ registrazione: true, trascrizione: true })),
  ritiraComunicazioni: vi.fn(async () => true),
  verifyGdprToken: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: { registration: { findFirst: mocks.findFirst } } }));
vi.mock('@/lib/gdpr/request-token', () => ({ verifyGdprToken: mocks.verifyGdprToken }));
vi.mock('@/lib/live/consent-withdrawal', () => ({
  ritiraConsensi: mocks.ritiraConsensi,
  ritiraComunicazioni: mocks.ritiraComunicazioni,
}));

import { POST } from './route';

const ISCRIZIONE = '11111111-1111-4111-8111-111111111111';
let ip = 0;

function richiesta(
  corpo: Record<string, unknown>,
  token: string | null = 'token-valido'
) {
  ip += 1;
  return POST(
    new Request('http://localhost/api/gdpr/consents', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': `198.51.100.${ip}`,
      },
      body: JSON.stringify({ ...corpo, ...(token ? { token } : {}) }),
    }) as unknown as NextRequest,
    { params: Promise.resolve({}) } as never
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyGdprToken.mockReturnValue({ emailHash: 'impronta' });
  mocks.findFirst.mockResolvedValue({ id: ISCRIZIONE, eventId: 'evento-1' });
});

describe('POST /api/gdpr/consents', () => {
  it('senza link firmato non si tocca niente', async () => {
    expect(
      (await richiesta({ registrationId: ISCRIZIONE, consent: 'recording' }, null)).status
    ).toBe(422);
    mocks.verifyGdprToken.mockReturnValue(null);
    expect(
      (await richiesta({ registrationId: ISCRIZIONE, consent: 'recording' })).status
    ).toBe(401);
    expect(mocks.ritiraConsensi).not.toHaveBeenCalled();
  });

  it("i link dell'email non valgono qui: serve il token della pagina", async () => {
    await richiesta({ registrationId: ISCRIZIONE, consent: 'recording' });
    expect(mocks.verifyGdprToken).toHaveBeenCalledWith('token-valido', 'consents');
  });

  it("si tocca solo un'iscrizione dello stesso indirizzo", async () => {
    mocks.findFirst.mockResolvedValue(null);
    const res = await richiesta({ registrationId: ISCRIZIONE, consent: 'recording' });
    expect(res.status).toBe(404);
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ISCRIZIONE, emailHash: 'impronta' } })
    );
    expect(mocks.ritiraConsensi).not.toHaveBeenCalled();
  });

  it('ritira la registrazione, con la trascrizione che ne dipende', async () => {
    const res = await richiesta({ registrationId: ISCRIZIONE, consent: 'recording' });
    expect(res.status).toBe(200);
    expect(mocks.ritiraConsensi).toHaveBeenCalledWith(
      'evento-1',
      [],
      { registrazione: true },
      expect.any(Date),
      { iscrizioni: [ISCRIZIONE], origine: 'self-service' }
    );
  });

  it('ritira la sola trascrizione', async () => {
    await richiesta({ registrationId: ISCRIZIONE, consent: 'transcription' });
    expect(mocks.ritiraConsensi).toHaveBeenCalledWith(
      'evento-1',
      [],
      { registrazione: false },
      expect.any(Date),
      { iscrizioni: [ISCRIZIONE], origine: 'self-service' }
    );
  });

  it('ritira le comunicazioni future', async () => {
    await richiesta({ registrationId: ISCRIZIONE, consent: 'futureCommunications' });
    expect(mocks.ritiraComunicazioni).toHaveBeenCalledWith('impronta');
    expect(mocks.ritiraConsensi).not.toHaveBeenCalled();
  });

  it("un consenso che non esiste e' un errore", async () => {
    const res = await richiesta({ registrationId: ISCRIZIONE, consent: 'tutto' });
    expect(res.status).toBe(422);
  });
});
