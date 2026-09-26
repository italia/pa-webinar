import type { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Chi scrive una parola nella nuvola.
 *
 * Il pannello mandava il token di sala come `accessToken` e, a chi non ne
 * aveva uno, la sola parola: il server cerca l'`accessToken` fra le
 * registrazioni e pretende un'identità, quindi scrivevano soltanto gli
 * iscritti. In una chiamata rapida — tutti ospiti più il moderatore — la
 * nuvola restava vuota, e il campo si svuotava come se la parola fosse
 * entrata. L'identità di chi non è iscritto è l'identificativo del browser,
 * come nei sondaggi; il token di sala resta una prova di presenza.
 */
vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn() },
    wordCloudRound: { findUnique: vi.fn(), updateMany: vi.fn() },
    wordCloudSubmission: { count: vi.fn(), create: vi.fn() },
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

import { POST } from './route';

const mockedEvent = prisma.event.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedRound = prisma.wordCloudRound.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedCount = prisma.wordCloudSubmission.count as unknown as ReturnType<typeof vi.fn>;
const mockedCloseRound = prisma.wordCloudRound
  .updateMany as unknown as ReturnType<typeof vi.fn>;
const mockedCreate = prisma.wordCloudSubmission.create as unknown as ReturnType<typeof vi.fn>;
const mockedRegistration = prisma.registration
  .findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedGrant = prisma.eventModerator
  .findUnique as unknown as ReturnType<typeof vi.fn>;

const EVENT_ID = '55555555-5555-4555-8555-555555555555';
const ROUND_ID = '66666666-6666-4666-8666-666666666666';
const SLUG = 'chiamata-di-prova';
const PRIMARY_TOKEN = 'PRIMARY_MOD_TOKEN';

const ctx = () => ({ params: Promise.resolve({ param: SLUG, id: ROUND_ID }) });

let ipSeq = 0;
function submit(body: Record<string, unknown>, bearer?: string, ip?: string): NextRequest {
  // Un indirizzo diverso per richiesta, se non lo si fissa: il tetto per IP
  // è l'oggetto di un solo gruppo di test.
  ipSeq += 1;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-forwarded-for': ip ?? `192.0.2.${ipSeq % 250}`,
  };
  if (bearer !== undefined) headers.Authorization = `Bearer ${bearer}`;
  return new Request(
    `https://webinar.gov.it/api/events/${SLUG}/wordcloud/${ROUND_ID}/submit`,
    { method: 'POST', headers, body: JSON.stringify(body) },
  ) as unknown as NextRequest;
}

function scritto(): Record<string, unknown> | undefined {
  return (mockedCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> } | undefined)
    ?.data;
}

let guestSeq = 0;
/** Un identificativo nuovo per test: il limite per persona è in memoria. */
const nuovoOspite = () => `guest_wc_${++guestSeq}`;

beforeEach(() => {
  vi.clearAllMocks();
  siteSettings.guestAccessEnabled = true;
  mockedEvent.mockResolvedValue({
    id: EVENT_ID,
    status: 'LIVE',
    eventType: 'INSTANT',
    moderatorToken: PRIMARY_TOKEN,
    joinPasswordHash: null,
  });
  mockedRound.mockResolvedValue({
    id: ROUND_ID,
    eventId: EVENT_ID,
    status: 'OPEN',
    duration: 120,
    createdAt: new Date(Date.now() - 10_000),
  });
  mockedCount.mockResolvedValue(0);
  mockedCloseRound.mockResolvedValue({ count: 1 });
  mockedCreate.mockResolvedValue({});
  mockedRegistration.mockResolvedValue(null);
  mockedGrant.mockResolvedValue(null);
});

describe('POST /api/events/[slug]/wordcloud/[id]/submit — chi scrive', () => {
  it("un ospite in sala scrive con l'identificativo del browser", async () => {
    const guestId = nuovoOspite();
    const res = await POST(submit({ word: 'Futuro', guestId }), ctx());
    expect(res.status).toBe(201);
    expect(scritto()).toMatchObject({ guestId, registrationId: null, word: 'futuro' });
  });

  it('la sola parola, senza identità, non entra', async () => {
    // Era la richiesta che il pannello mandava a ogni ospite.
    const res = await POST(submit({ word: 'futuro' }), ctx());
    expect(res.status).toBe(422);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('il relatore scrive col browser e mostra il token di sala come prova', async () => {
    mockedGrant.mockResolvedValue({ eventId: EVENT_ID, revokedAt: null });
    const res = await POST(
      submit({ word: 'dati', guestId: nuovoOspite() }, 'TOKEN_RELATORE'),
      ctx(),
    );
    expect(res.status).toBe(201);
  });

  it('il token di sala non è un’identità: come accessToken è un 403', async () => {
    // Il difetto del pannello: il grant del relatore non è una registrazione.
    mockedGrant.mockResolvedValue({ eventId: EVENT_ID, revokedAt: null });
    const res = await POST(submit({ word: 'dati', accessToken: 'TOKEN_RELATORE' }), ctx());
    expect(res.status).toBe(403);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('anche il moderatore scrive, col proprio token di sala', async () => {
    const res = await POST(
      submit({ word: 'riuso', guestId: nuovoOspite() }, PRIMARY_TOKEN),
      ctx(),
    );
    expect(res.status).toBe(201);
  });

  it("l'iscritto scrive con la propria registrazione", async () => {
    mockedRegistration.mockResolvedValue({ id: 'reg-1', eventId: EVENT_ID });
    const res = await POST(submit({ word: 'Apertura', accessToken: 'ALICE' }), ctx());
    expect(res.status).toBe(201);
    expect(scritto()).toMatchObject({ registrationId: 'reg-1', guestId: null });
  });

  it("fuori dalla finestra degli ospiti l'identificativo del browser non basta", async () => {
    siteSettings.guestAccessEnabled = false;
    mockedEvent.mockResolvedValue({
      id: EVENT_ID,
      status: 'LIVE',
      eventType: 'SCHEDULED',
      moderatorToken: PRIMARY_TOKEN,
      joinPasswordHash: null,
    });
    const res = await POST(submit({ word: 'intruso', guestId: nuovoOspite() }), ctx());
    expect(res.status).toBe(401);
    expect(mockedCreate).not.toHaveBeenCalled();

    // Chi conduce resta dentro: il suo token di sala lo dice.
    const mod = await POST(
      submit({ word: 'moderazione', guestId: nuovoOspite() }, PRIMARY_TOKEN),
      ctx(),
    );
    expect(mod.status).toBe(201);
  });

  it('un token di sala che non risolve resta un 403', async () => {
    const res = await POST(submit({ word: 'scaduto', guestId: nuovoOspite() }, 'SCADUTO'), ctx());
    expect(res.status).toBe(403);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('a un evento protetto da password scrive solo chi la password la conosce', async () => {
    mockedEvent.mockResolvedValue({
      id: EVENT_ID,
      status: 'LIVE',
      eventType: 'INSTANT',
      moderatorToken: PRIMARY_TOKEN,
      joinPasswordHash: 'hash',
    });
    const estraneo = await POST(submit({ word: 'intruso', guestId: nuovoOspite() }), ctx());
    expect(estraneo.status).toBe(401);
    expect(mockedCreate).not.toHaveBeenCalled();

    vi.mocked(hasJoinGrant).mockResolvedValueOnce(true);
    const ospite = await POST(submit({ word: 'benvenuti', guestId: nuovoOspite() }), ctx());
    expect(ospite.status).toBe(201);
  });
});

describe('POST /api/events/[slug]/wordcloud/[id]/submit — una sala dietro un solo indirizzo', () => {
  /**
   * Dietro l'uscita di un ente sta una sala intera, e ognuno scrive fino a
   * cinque parole appena il giro si apre. Con un tetto di sessanta al minuto
   * dodici colleghi lo esaurivano, e le parole dei successivi si perdevano.
   */
  it('sessanta persone da cinque parole entrano tutte; oltre, il tetto ferma chi ruota', async () => {
    const ip = '198.51.100.40';
    const esiti = new Map<number, number>();
    for (let persona = 0; persona < 60; persona++) {
      const guestId = `guest_nat_wc_${persona}`;
      for (let parola = 0; parola < 5; parola++) {
        const res = await POST(submit({ word: `p${persona}w${parola}`, guestId }, undefined, ip), ctx());
        esiti.set(res.status, (esiti.get(res.status) ?? 0) + 1);
      }
    }
    expect(Object.fromEntries(esiti)).toEqual({ 201: 300 });

    const oltre = await POST(submit({ word: 'ancora', guestId: nuovoOspite() }, undefined, ip), ctx());
    expect(oltre.status).toBe(429);
  });
});

describe('POST /api/events/[slug]/wordcloud/[id]/submit — perché una parola non entra', () => {
  it('oltre la quinta parola il codice lo dice, distinto dal giro chiuso', async () => {
    mockedCount.mockResolvedValue(5);
    const res = await POST(submit({ word: 'sesta', guestId: nuovoOspite() }), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('WORD_LIMIT_REACHED');
  });

  it('a giro chiuso la 409 è un conflitto generico', async () => {
    mockedRound.mockResolvedValue({
      id: ROUND_ID,
      eventId: EVENT_ID,
      status: 'CLOSED',
      duration: 120,
      createdAt: new Date(Date.now() - 10_000),
    });
    const res = await POST(submit({ word: 'tardi', guestId: nuovoOspite() }), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('CONFLICT');
  });

  it('una parola fatta di soli spazi non entra', async () => {
    const res = await POST(submit({ word: '   ', guestId: nuovoOspite() }), ctx());
    expect(res.status).toBe(422);
    expect(mockedCreate).not.toHaveBeenCalled();
  });
});

describe('POST /api/events/[slug]/wordcloud/[id]/submit — giro scaduto', () => {
  beforeEach(() => {
    mockedRound.mockResolvedValue({
      id: ROUND_ID,
      eventId: EVENT_ID,
      status: 'OPEN',
      duration: 60,
      createdAt: new Date(Date.now() - 61_000),
    });
  });

  it('lo chiude, respinge la parola e lo dice alla sala', async () => {
    const res = await POST(submit({ word: 'tardi', guestId: nuovoOspite() }), ctx());
    expect(res.status).toBe(409);
    expect(mockedCloseRound).toHaveBeenCalledWith({
      where: { id: ROUND_ID, status: 'OPEN' },
      data: expect.objectContaining({ status: 'CLOSED' }),
    });
    expect(pokeLivePanel).toHaveBeenCalledWith(EVENT_ID, 'wordcloud');
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('se un altro l’ha già chiuso, nessun secondo avviso', async () => {
    mockedCloseRound.mockResolvedValue({ count: 0 });
    const res = await POST(submit({ word: 'tardi', guestId: nuovoOspite() }), ctx());
    expect(res.status).toBe(409);
    expect(pokeLivePanel).not.toHaveBeenCalled();
  });
});
