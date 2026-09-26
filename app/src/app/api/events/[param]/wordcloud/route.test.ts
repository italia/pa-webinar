import type { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * La lettura della nuvola chiude il giro scaduto: nessun lavoro periodico lo
 * fa al posto suo. Allo scadere del conto alla rovescia il pannello rilegge,
 * quindi la sala intera arriva nello stesso secondo: scrive solo la prima
 * lettura che trova il giro ancora aperto.
 */
vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn() },
    wordCloudRound: { findFirst: vi.fn(), updateMany: vi.fn() },
    registration: { findUnique: vi.fn() },
    eventModerator: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/cache', () => ({
  getCached: vi.fn(() => null),
  setCache: vi.fn(),
  deleteCacheByPrefix: vi.fn(),
}));
vi.mock('@/lib/live-state/publish', () => ({ pokeLivePanel: vi.fn() }));
vi.mock('@/lib/events/join-grant', () => ({ hasJoinGrant: vi.fn(async () => false) }));
const { siteSettings } = vi.hoisted(() => ({ siteSettings: { guestAccessEnabled: true } }));
vi.mock('@/lib/settings', () => ({ getSettings: async () => siteSettings }));

import { prisma } from '@/lib/db';
import { hasJoinGrant } from '@/lib/events/join-grant';
import { pokeLivePanel } from '@/lib/live-state/publish';

import { GET } from './route';

const mockedEvent = prisma.event.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedRound = prisma.wordCloudRound.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockedUpdateMany = prisma.wordCloudRound
  .updateMany as unknown as ReturnType<typeof vi.fn>;
const mockedRegistration = prisma.registration
  .findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedGrant = prisma.eventModerator
  .findUnique as unknown as ReturnType<typeof vi.fn>;

const EVENT_ID = '77777777-7777-4777-8777-777777777777';
const SLUG = 'chiamata-di-prova';
const PRIMARY_TOKEN = 'PRIMARY_MOD_TOKEN';
const ctx = () => ({ params: Promise.resolve({ param: SLUG }) });
const get = (headers: HeadersInit = {}) =>
  new Request(`https://webinar.gov.it/api/events/${SLUG}/wordcloud`, {
    headers,
  }) as unknown as NextRequest;

function evento(campi: Record<string, unknown> = {}) {
  mockedEvent.mockResolvedValue({
    id: EVENT_ID,
    status: 'LIVE',
    eventType: 'INSTANT',
    moderatorToken: PRIMARY_TOKEN,
    joinPasswordHash: null,
    ...campi,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  siteSettings.guestAccessEnabled = true;
  evento();
  mockedUpdateMany.mockResolvedValue({ count: 1 });
  mockedRegistration.mockResolvedValue(null);
  mockedGrant.mockResolvedValue(null);
  mockedRound.mockResolvedValue({
    id: 'round-0',
    prompt: 'Una parola',
    status: 'OPEN',
    duration: 60,
    createdAt: new Date(Date.now() - 10_000),
    closedAt: null,
    submissions: [{ word: 'riuso' }],
  });
});

describe('GET /api/events/[slug]/wordcloud — chi legge la nuvola', () => {
  /**
   * La lettura non aveva cancello: prompt e parole arrivavano a chiunque
   * avesse l'indirizzo, anche a un evento protetto da password, dove le
   * domande e i sondaggi rispondevano 401. Stessa regola degli altri pannelli.
   */
  it('un ospite in sala la legge, anche col «Bearer » vuoto che manda la sala', async () => {
    for (const headers of [{}, { Authorization: 'Bearer ' }] as HeadersInit[]) {
      const res = await GET(get(headers), ctx());
      expect(res.status).toBe(200);
      expect((await res.json()).words).toEqual([{ word: 'riuso', count: 1 }]);
    }
  });

  it('a un evento protetto da password chi non la conosce non legge', async () => {
    evento({ joinPasswordHash: 'hash' });
    const res = await GET(get(), ctx());
    expect(res.status).toBe(401);
    expect(mockedRound).not.toHaveBeenCalled();

    vi.mocked(hasJoinGrant).mockResolvedValueOnce(true);
    expect((await GET(get(), ctx())).status).toBe(200);
  });

  it("fuori dalla finestra degli ospiti legge solo chi mostra un token di sala", async () => {
    siteSettings.guestAccessEnabled = false;
    evento({ eventType: 'SCHEDULED' });
    expect((await GET(get(), ctx())).status).toBe(401);
    expect(
      (await GET(get({ Authorization: `Bearer ${PRIMARY_TOKEN}` }), ctx())).status,
    ).toBe(200);
    mockedGrant.mockResolvedValue({ eventId: EVENT_ID, revokedAt: null });
    expect((await GET(get({ Authorization: 'Bearer TOKEN_RELATORE' }), ctx())).status).toBe(200);
  });

  it('un token che non risolve resta un 403', async () => {
    expect((await GET(get({ Authorization: 'Bearer SCADUTO' }), ctx())).status).toBe(403);
  });
});

describe('GET /api/events/[slug]/wordcloud — giro scaduto', () => {
  it('lo chiude con una scrittura condizionata allo stato aperto', async () => {
    mockedRound.mockResolvedValue({
      id: 'round-1',
      prompt: 'Una parola',
      status: 'OPEN',
      duration: 60,
      createdAt: new Date(Date.now() - 61_000),
      closedAt: null,
      submissions: [{ word: 'Futuro' }, { word: 'futuro ' }, { word: 'dati' }],
    });
    const res = await GET(get(), ctx());
    const body = await res.json();
    expect(body.active).toBe(false);
    expect(body.words).toEqual([
      { word: 'futuro', count: 2 },
      { word: 'dati', count: 1 },
    ]);
    expect(mockedUpdateMany).toHaveBeenCalledWith({
      where: { id: 'round-1', status: 'OPEN' },
      data: expect.objectContaining({ status: 'CLOSED' }),
    });
    // La risposta dice quando si è chiuso, come la lettura successiva.
    const scritto = mockedUpdateMany.mock.calls[0]?.[0] as { data: { closedAt: Date } };
    expect(body.status).toBe('CLOSED');
    expect(body.closedAt).toBe(scritto.data.closedAt.toISOString());
  });

  it('chi lo chiude lo dice alla sala; chi arriva dopo no', async () => {
    // Con l'orologio avanti un pannello rilegge prima della fine vera e trova
    // il giro aperto: senza l'avviso lo vedrebbe aperto fino al giro
    // periodico successivo, con le parole respinte.
    mockedRound.mockResolvedValue({
      id: 'round-3',
      prompt: 'Una parola',
      status: 'OPEN',
      duration: 60,
      createdAt: new Date(Date.now() - 61_000),
      closedAt: null,
      submissions: [],
    });
    await GET(get(), ctx());
    expect(pokeLivePanel).toHaveBeenCalledWith(EVENT_ID, 'wordcloud');

    vi.mocked(pokeLivePanel).mockClear();
    mockedUpdateMany.mockResolvedValue({ count: 0 });
    await GET(get(), ctx());
    expect(pokeLivePanel).not.toHaveBeenCalled();
  });

  it('un giro ancora in corso non si tocca', async () => {
    mockedRound.mockResolvedValue({
      id: 'round-2',
      prompt: 'Una parola',
      status: 'OPEN',
      duration: 60,
      createdAt: new Date(Date.now() - 10_000),
      closedAt: null,
      submissions: [],
    });
    const body = await (await GET(get(), ctx())).json();
    expect(body.active).toBe(true);
    expect(mockedUpdateMany).not.toHaveBeenCalled();
  });
});
