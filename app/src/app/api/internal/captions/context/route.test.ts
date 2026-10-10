/**
 * GET /api/internal/captions/context — il contesto di una stanza per il
 * servizio dei sottotitoli live: lingua, vocabolario, correzioni.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  occupante: vi.fn(),
  glossaryForEvent: vi.fn(),
  listGlossary: vi.fn(),
  settings: { liveCaptionsEnabled: true, defaultLocale: 'it' } as Record<string, unknown>,
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    // La stanza trova l'evento (findFirst), poi se ne leggono i dettagli (findUnique).
    event: { findFirst: mocks.findFirst, findUnique: mocks.findFirst },
    roomOccupant: { findFirst: mocks.occupante },
  },
}));
vi.mock('@/lib/ai/glossary', () => ({
  glossaryForEvent: mocks.glossaryForEvent,
  listGlossary: mocks.listGlossary,
}));
vi.mock('@/lib/settings', () => ({ getSettings: vi.fn(async () => mocks.settings) }));
vi.mock('@/lib/crypto/pii', () => ({ tryDecryptPII: (v: string) => `chiaro:${v}` }));

import { GET } from './route';

const KEY = 'chiave-cron';

function chiama(query = '', key = KEY) {
  const req = new Request(`http://localhost/api/internal/captions/context${query}`, {
    headers: { 'x-api-key': key },
  });
  return GET(req as unknown as Parameters<typeof GET>[0], { params: Promise.resolve({}) });
}

const voce = (term: string, aliases: string[] = [], eventId: string | null = null) => ({ term, aliases, eventId });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_API_KEY = KEY;
  mocks.settings = { liveCaptionsEnabled: true, defaultLocale: 'it' };
  mocks.listGlossary.mockResolvedValue([voce('PagoPA', ['pago pa'])]);
  mocks.glossaryForEvent.mockResolvedValue([voce('SPID', ['spit'], 'e1'), voce('PagoPA', ['pago pa'])]);
});

describe('GET /api/internal/captions/context', () => {
  it('senza la chiave interna: 401', async () => {
    expect((await chiama('', 'sbagliata')).status).toBe(401);
  });

  it("spenti nell'istanza: enabled false, senza leggere eventi", async () => {
    mocks.settings = { liveCaptionsEnabled: false, defaultLocale: 'it' };
    const body = await (await chiama('?room=stanza')).json();
    expect(body).toMatchObject({ enabled: false, language: 'it-IT' });
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("stanza sconosciuta o assente: l'istanza e il suo glossario", async () => {
    mocks.findFirst.mockResolvedValue(null);
    for (const q of ['?room=ignota', '']) {
      const body = await (await chiama(q)).json();
      expect(body).toEqual({
        enabled: true,
        language: 'it-IT',
        phrases: ['PagoPA'],
        aliases: [{ term: 'PagoPA', aliases: ['pago pa'] }],
      });
    }
  });

  it("senza stanza l'evento si trova dall'id della riunione", async () => {
    mocks.occupante.mockResolvedValue({ event: { id: 'e1', liveCaptionsEnabled: true, captionsTranscriptEnabled: true } });
    mocks.findFirst.mockResolvedValue({
      id: 'e1',
      liveCaptionsEnabled: true,
      captionsTranscriptEnabled: true,
      organizerName: null,
      moderatorName: null,
      organizers: [],
      additionalMods: [],
    });
    const body = await (await chiama('?meetingId=riunione-1')).json();
    expect(mocks.occupante).toHaveBeenCalledWith(expect.objectContaining({ where: { meetingId: 'riunione-1' } }));
    expect(body).toMatchObject({ enabled: true, transcript: true });
  });

  it("con la trascrizione dai sottotitoli il servizio manda le frasi al portale", async () => {
    mocks.findFirst.mockResolvedValue({
      id: 'e1',
      liveCaptionsEnabled: true,
      captionsTranscriptEnabled: true,
      organizerName: null,
      moderatorName: null,
      organizers: [],
      additionalMods: [],
    });
    const body = await (await chiama('?room=stanza')).json();
    expect(body).toMatchObject({ enabled: true, transcript: true });
  });

  it("stanza di un evento: glossario dell'evento, enti e persone, e il suo interruttore", async () => {
    mocks.findFirst.mockResolvedValue({
      id: 'e1',
      liveCaptionsEnabled: false,
      organizerName: 'Ente di prova',
      moderatorName: 'Relatore 1',
      organizers: [{ name: 'Ente di prova' }, { name: 'Ente partner' }],
      additionalMods: [{ name: 'cifrato' }],
    });
    const body = await (await chiama('?room=Stanza-UUID')).json();
    // Prima il nome esatto, sull'indice unico.
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { jitsiRoomName: 'Stanza-UUID' } }),
    );
    expect(body).toEqual({
      enabled: false,
      transcript: false,
      language: 'it-IT',
      phrases: ['SPID', 'PagoPA', 'Ente di prova', 'Ente partner', 'Relatore 1', 'chiaro:cifrato'],
      aliases: [
        { term: 'SPID', aliases: ['spit'] },
        { term: 'PagoPA', aliases: ['pago pa'] },
      ],
    });
  });

  it("la lingua segue quella predefinita dell'istanza", async () => {
    mocks.settings = { liveCaptionsEnabled: true, defaultLocale: 'sl' };
    mocks.findFirst.mockResolvedValue(null);
    expect((await (await chiama()).json()).language).toBe('auto');
  });
});
