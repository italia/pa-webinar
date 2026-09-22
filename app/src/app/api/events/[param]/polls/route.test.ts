import type { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * I sondaggi visti dal confine HTTP.
 *
 * Il difetto che questi test tengono chiuso è vissuto TUTTO nel cablaggio, non
 * dentro un helper: la sala passa `token=""` a chi entra dal link, il pannello
 * mandava `Authorization: Bearer ` e la rotta leggeva quella stringa vuota come
 * «token mancante» → 401 a tutta la sala di una chiamata istantanea. Il
 * moderatore apriva un sondaggio e non lo vedeva nessuno.
 *
 * Per questo l'autorizzazione NON è mockata: gira davvero. Si stubbano solo il
 * DB e l'avviso al canale live.
 */
vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn() },
    poll: { findMany: vi.fn() },
    pollVote: { groupBy: vi.fn(), findMany: vi.fn() },
    registration: { findUnique: vi.fn() },
    eventModerator: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/live-state/publish', () => ({ pokeLivePanel: vi.fn() }));
vi.mock('@/lib/events/join-grant', () => ({ hasJoinGrant: vi.fn() }));
// Senza Redis il pubblico passa dalla cache a TTL breve: qui la si tiene
// spenta, altrimenti una risposta scavalcherebbe il test successivo.
vi.mock('@/lib/redis', () => ({ getRedis: () => null }));
vi.mock('@/lib/cache', () => ({
  getCached: vi.fn(() => null),
  setCache: vi.fn(),
  deleteCacheByPrefix: vi.fn(),
}));

import { prisma } from '@/lib/db';
import { hasJoinGrant } from '@/lib/events/join-grant';

import { GET } from './route';

const mockedEvent = prisma.event.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedPolls = prisma.poll.findMany as unknown as ReturnType<typeof vi.fn>;
const mockedTally = prisma.pollVote.groupBy as unknown as ReturnType<typeof vi.fn>;
const mockedMyVotes = prisma.pollVote.findMany as unknown as ReturnType<typeof vi.fn>;
const mockedRegistration = prisma.registration
  .findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedGrant = prisma.eventModerator
  .findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedJoinGrant = hasJoinGrant as unknown as ReturnType<typeof vi.fn>;

const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const SLUG = 'evento-di-prova';
const PRIMARY_TOKEN = 'PRIMARY_MOD_TOKEN';
const ACCESS_TOKEN = 'ALICE_ACCESS_TOKEN';
const GUEST_ID = 'guest_ab12cd34';

function eventRow(over: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    status: 'LIVE',
    eventType: 'SCHEDULED',
    moderatorToken: PRIMARY_TOKEN,
    joinPasswordHash: null,
    ...over,
  };
}

function pollRow(over: Record<string, unknown> = {}) {
  return {
    id: 'poll-1',
    question: 'Ti è stato utile?',
    options: ['Sì', 'No'],
    status: 'OPEN',
    createdAt: new Date('2026-09-22T10:00:00.000Z'),
    closedAt: null,
    ...over,
  };
}

/** Due voti sul sondaggio: uno dell'iscritta, uno di un ospite. I conteggi
 *  arrivano aggregati dal DB, la riga propria con una lettura mirata. */
const VOTI = [
  { pollId: 'poll-1', optionIndex: 0, registrationId: 'reg-1', guestId: null },
  { pollId: 'poll-1', optionIndex: 1, registrationId: null, guestId: GUEST_ID },
];

/** Il `where` con cui la rotta ha davvero interrogato il DB: è lì che si vede
 *  quali sondaggi il chiamante poteva vedere. */
function whereInterrogato(): Record<string, unknown> {
  const call = mockedPolls.mock.calls[0]?.[0] as
    | { where: Record<string, unknown> }
    | undefined;
  expect(call, 'nessuna interrogazione ai sondaggi').toBeDefined();
  return call!.where;
}

/** Il param di rotta arriva come Promise: è la firma di Next 15. */
const ctx = (param = SLUG) => ({ params: Promise.resolve({ param }) });

function get(headers: HeadersInit = {}, query = ''): NextRequest {
  return new Request(`https://webinar.gov.it/api/events/${SLUG}/polls${query}`, {
    headers,
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedEvent.mockResolvedValue(eventRow());
  mockedPolls.mockResolvedValue([pollRow()]);
  mockedTally.mockResolvedValue(
    VOTI.map((v) => ({
      pollId: v.pollId,
      optionIndex: v.optionIndex,
      _count: { _all: 1 },
    })),
  );
  mockedMyVotes.mockImplementation(
    async (args: { where: { registrationId?: string; guestId?: string } }) =>
      VOTI.filter((v) =>
        args.where.registrationId
          ? v.registrationId === args.where.registrationId
          : v.guestId === args.where.guestId,
      ).map((v) => ({ pollId: v.pollId, optionIndex: v.optionIndex })),
  );
  mockedRegistration.mockResolvedValue(null);
  mockedGrant.mockResolvedValue(null);
  mockedJoinGrant.mockResolvedValue(false);
});

describe('GET /api/events/[slug]/polls — chi vede il sondaggio', () => {
  it('un ospite senza alcun header lo vede', async () => {
    const res = await GET(get(), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.polls).toHaveLength(1);
  });

  it('un «Bearer » vuoto è assenza di token, non un token sbagliato', async () => {
    // È esattamente ciò che il pannello manda a un ospite: prima valeva 401 e
    // la sala restava senza sondaggi.
    const res = await GET(get({ Authorization: 'Bearer ' }), ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).polls).toHaveLength(1);
  });

  it('al pubblico i risultati di un voto APERTO restano nascosti', async () => {
    const body = await (await GET(get(), ctx())).json();
    expect(body.polls[0].optionCounts).toBeNull();
    expect(body.polls[0].totalVotes).toBe(2);
    // …e chiede al DB solo i sondaggi che il pubblico può vedere.
    expect(whereInterrogato()).toMatchObject({
      status: { in: ['OPEN', 'PUBLISHED'] },
    });
  });

  it('il moderatore vede tutto, conteggi compresi', async () => {
    const res = await GET(get({ Authorization: `Bearer ${PRIMARY_TOKEN}` }), ctx());
    const body = await res.json();
    expect(body.polls[0].optionCounts).toEqual([1, 1]);
    expect(whereInterrogato()).toEqual({ eventId: EVENT_ID });
  });

  it('l’ospite si ricorda il proprio voto dall’identificativo del browser', async () => {
    const anonimo = await (await GET(get(), ctx())).json();
    expect(anonimo.polls[0].hasVoted, 'senza guestId non è nessuno').toBe(false);
    expect(anonimo.polls[0].votedOptionIndex).toBeNull();

    const conId = await (
      await GET(get({}, `?guestId=${GUEST_ID}`), ctx())
    ).json();
    expect(conId.polls[0].hasVoted).toBe(true);
    expect(conId.polls[0].votedOptionIndex).toBe(1);
  });

  it('il partecipante iscritto si ricorda il voto dalla registrazione', async () => {
    mockedRegistration.mockResolvedValue({ id: 'reg-1', eventId: EVENT_ID });
    const body = await (
      await GET(get({ Authorization: `Bearer ${ACCESS_TOKEN}` }), ctx())
    ).json();
    expect(body.polls[0].hasVoted).toBe(true);
    expect(body.polls[0].votedOptionIndex).toBe(0);
  });

  it('fuori dalla finestra della sala, senza token, è 401', async () => {
    mockedEvent.mockResolvedValue(eventRow({ status: 'ENDED' }));
    expect((await GET(get(), ctx())).status).toBe(401);
  });

  it('un token che non risolve resta un errore, non un declassamento', async () => {
    const res = await GET(get({ Authorization: 'Bearer TOKEN_SCADUTO' }), ctx());
    expect(res.status).toBe(403);
  });
});
