// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  ritiraConsensi: vi.fn(async () => ({ registrazione: true, trascrizione: true })),
  ritiraComunicazioni: vi.fn(async () => true),
  ritiraProvaConservata: vi.fn(async () => true),
  applicaSpuntaInAttesa: vi.fn(async () => true),
  verifyGdprToken: vi.fn(),
  daiConsenso: vi.fn(async (): Promise<string> => 'dato'),
}));

vi.mock('@/lib/db', () => ({ prisma: { registration: { findFirst: mocks.findFirst } } }));
vi.mock('@/lib/persons/spunta-in-attesa', () => ({
  applicaSpuntaInAttesa: mocks.applicaSpuntaInAttesa,
}));
vi.mock('@/lib/gdpr/request-token', () => ({ verifyGdprToken: mocks.verifyGdprToken }));
vi.mock('@/lib/gdpr/consent-giving', () => ({ daiConsenso: mocks.daiConsenso }));
vi.mock('@/lib/gdpr/retained-consent-proofs', () => ({
  ritiraProvaConservata: mocks.ritiraProvaConservata,
}));
vi.mock('@/lib/live/consent-withdrawal', () => ({
  ritiraConsensi: mocks.ritiraConsensi,
  ritiraComunicazioni: mocks.ritiraComunicazioni,
}));

import { POST } from './route';

const ISCRIZIONE = '11111111-1111-4111-8111-111111111111';
const PROVA = '22222222-2222-4222-8222-222222222222';
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
  mocks.ritiraProvaConservata.mockResolvedValue(true);
  mocks.applicaSpuntaInAttesa.mockResolvedValue(true);
  mocks.daiConsenso.mockResolvedValue('dato');
});
afterEach(() => vi.unstubAllEnvs());

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
      { registrazione: true, trascrizione: true },
      expect.any(Date),
      { iscrizioni: [ISCRIZIONE], origine: 'self-service' }
    );
  });

  it('dove chi partecipa non entra nel video la registrazione si ritira da sola', async () => {
    vi.stubEnv('RECORDING_VOICE_EXCLUSION', 'true');
    vi.stubEnv('RECORDING_PARTICIPANT_VOICE', '');
    await richiesta({ registrationId: ISCRIZIONE, consent: 'recording' });
    expect(mocks.ritiraConsensi).toHaveBeenCalledWith(
      'evento-1',
      [],
      { registrazione: true, trascrizione: false },
      expect.any(Date),
      { iscrizioni: [ISCRIZIONE], origine: 'self-service' }
    );
    await richiesta({ proofId: PROVA, consent: 'recording' });
    expect(mocks.ritiraProvaConservata).toHaveBeenCalledWith(
      'impronta',
      PROVA,
      'recording',
      expect.any(Date),
      { trascrizione: false }
    );
  });

  it('ritira la sola trascrizione', async () => {
    await richiesta({ registrationId: ISCRIZIONE, consent: 'transcription' });
    expect(mocks.ritiraConsensi).toHaveBeenCalledWith(
      'evento-1',
      [],
      { registrazione: false, trascrizione: true },
      expect.any(Date),
      { iscrizioni: [ISCRIZIONE], origine: 'self-service' }
    );
  });

  it('ritira le comunicazioni future', async () => {
    await richiesta({ registrationId: ISCRIZIONE, consent: 'futureCommunications' });
    expect(mocks.ritiraComunicazioni).toHaveBeenCalledWith('impronta');
    expect(mocks.ritiraConsensi).not.toHaveBeenCalled();
  });

  it('conferma la spunta della rubrica in attesa', async () => {
    const res = await richiesta({ registrationId: ISCRIZIONE, confirmAddressBook: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ confirmed: 'addressBook' });
    expect(mocks.applicaSpuntaInAttesa).toHaveBeenCalledWith(ISCRIZIONE, 'self-service');
    expect(mocks.ritiraComunicazioni).not.toHaveBeenCalled();
  });

  it('non conferma la spunta di un altro indirizzo, né senza link firmato', async () => {
    mocks.findFirst.mockResolvedValue(null);
    expect(
      (await richiesta({ registrationId: ISCRIZIONE, confirmAddressBook: true })).status
    ).toBe(404);
    mocks.verifyGdprToken.mockReturnValue(null);
    expect(
      (await richiesta({ registrationId: ISCRIZIONE, confirmAddressBook: true })).status
    ).toBe(401);
    expect(mocks.applicaSpuntaInAttesa).not.toHaveBeenCalled();
  });

  it('una spunta che non aspetta piu’ non risulta confermata', async () => {
    mocks.applicaSpuntaInAttesa.mockResolvedValue(false);
    const res = await richiesta({ registrationId: ISCRIZIONE, confirmAddressBook: true });
    expect(res.status).toBe(404);
  });

  it('`confirmAddressBook` vale solo vero, e mai insieme a un ritiro', async () => {
    expect(
      (await richiesta({ registrationId: ISCRIZIONE, confirmAddressBook: false })).status
    ).toBe(422);
    expect(
      (
        await richiesta({
          registrationId: ISCRIZIONE,
          consent: 'recording',
          confirmAddressBook: true,
        })
      ).status
    ).toBe(422);
  });

  it("un consenso che non esiste e' un errore", async () => {
    const res = await richiesta({ registrationId: ISCRIZIONE, consent: 'tutto' });
    expect(res.status).toBe(422);
  });

  it('una prova conservata si ritira con il suo id, per lo stesso indirizzo', async () => {
    const res = await richiesta({ proofId: PROVA, consent: 'recording' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ withdrawn: 'recording' });
    expect(mocks.ritiraProvaConservata).toHaveBeenCalledWith(
      'impronta',
      PROVA,
      'recording',
      expect.any(Date),
      { trascrizione: true }
    );
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.ritiraConsensi).not.toHaveBeenCalled();
  });

  it('una prova di un altro indirizzo risponde 404', async () => {
    mocks.ritiraProvaConservata.mockResolvedValue(false);
    const res = await richiesta({ proofId: PROVA, consent: 'transcription' });
    expect(res.status).toBe(404);
  });

  it('il link scaduto non ritira neanche una prova', async () => {
    mocks.verifyGdprToken.mockReturnValue(null);
    const res = await richiesta({ proofId: PROVA, consent: 'recording' });
    expect(res.status).toBe(401);
    expect(mocks.ritiraProvaConservata).not.toHaveBeenCalled();
  });

  it('accetta esattamente uno tra iscrizione e prova', async () => {
    expect(
      (await richiesta({ registrationId: ISCRIZIONE, proofId: PROVA, consent: 'recording' }))
        .status
    ).toBe(422);
    expect((await richiesta({ consent: 'recording' })).status).toBe(422);
    expect(mocks.ritiraProvaConservata).not.toHaveBeenCalled();
    expect(mocks.ritiraConsensi).not.toHaveBeenCalled();
  });

  it('le comunicazioni future non si ritirano da una prova', async () => {
    const res = await richiesta({ proofId: PROVA, consent: 'futureCommunications' });
    expect(res.status).toBe(422);
    expect(mocks.ritiraComunicazioni).not.toHaveBeenCalled();
  });

  describe('un consenso dato di nuovo', () => {
    it('con il token della pagina, per la registrazione con il testo letto', async () => {
      const res = await richiesta({
        registrationId: ISCRIZIONE,
        consent: 'recording',
        give: true,
        recordingDestination: 'PUBLIC',
        recordingVersion: 2,
        locale: 'de',
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ given: 'recording' });
      expect(mocks.verifyGdprToken).toHaveBeenCalledWith('token-valido', 'consents');
      expect(mocks.daiConsenso).toHaveBeenCalledWith('impronta', ISCRIZIONE, 'recording', {
        letto: { destinazione: 'PUBLIC', versione: 2, trascrizione: undefined },
        locale: 'de',
      });
      expect(mocks.ritiraConsensi).not.toHaveBeenCalled();
    });

    it('senza il testo letto non vale; una lingua sconosciuta si ignora', async () => {
      expect(
        (await richiesta({ registrationId: ISCRIZIONE, consent: 'recording', give: true })).status
      ).toBe(422);
      // La destinazione senza la versione del testo non basta.
      expect(
        (
          await richiesta({
            registrationId: ISCRIZIONE,
            consent: 'recording',
            give: true,
            recordingDestination: null,
          })
        ).status
      ).toBe(422);
      // Senza la casella letta decide la libreria: «testo cambiato», si ricarica.
      await richiesta({ registrationId: ISCRIZIONE, consent: 'transcription', give: true });
      expect(mocks.daiConsenso).toHaveBeenLastCalledWith('impronta', ISCRIZIONE, 'transcription', {
        letto: { destinazione: null, versione: undefined, trascrizione: undefined },
        locale: null,
      });
      await richiesta({
        registrationId: ISCRIZIONE,
        consent: 'transcription',
        give: true,
        transcriptionText: 'multitrackRetained',
        locale: 'xx',
      });
      expect(mocks.daiConsenso).toHaveBeenCalledWith('impronta', ISCRIZIONE, 'transcription', {
        letto: { destinazione: null, versione: undefined, trascrizione: 'multitrackRetained' },
        locale: null,
      });
    });

    it('senza link valido, o per un altro indirizzo, non si da niente', async () => {
      mocks.verifyGdprToken.mockReturnValue(null);
      const corpo = {
        registrationId: ISCRIZIONE,
        consent: 'transcription',
        give: true,
        transcriptionText: 'multitrack',
      };
      expect((await richiesta(corpo)).status).toBe(401);
      expect(mocks.daiConsenso).not.toHaveBeenCalled();
      mocks.verifyGdprToken.mockReturnValue({ emailHash: 'impronta' });
      mocks.daiConsenso.mockResolvedValue('nonTrovata');
      expect((await richiesta(corpo)).status).toBe(404);
    });

    it.each([
      ['nonOfferto', 'CONSENT_NOT_OFFERED'],
      ['serveRegistrazione', 'RECORDING_CONSENT_REQUIRED'],
      ['testoCambiato', 'CONSENT_TEXT_CHANGED'],
    ])('%s risponde 409 con il suo codice', async (esito, codice) => {
      mocks.daiConsenso.mockResolvedValue(esito);
      const res = await richiesta({
        registrationId: ISCRIZIONE,
        consent: 'transcription',
        give: true,
        transcriptionText: 'multitrack',
      });
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe(codice);
    });

    it('un consenso che vale gia risponde come uno dato', async () => {
      mocks.daiConsenso.mockResolvedValue('gia');
      const res = await richiesta({
        registrationId: ISCRIZIONE,
        consent: 'futureCommunications',
        give: true,
      });
      expect(res.status).toBe(200);
    });

    it('non si da da una prova conservata', async () => {
      const res = await richiesta({ proofId: PROVA, consent: 'recording', give: true });
      expect(res.status).toBe(422);
      expect(mocks.daiConsenso).not.toHaveBeenCalled();
    });
  });
});
