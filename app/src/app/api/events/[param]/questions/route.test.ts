import type { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Chi vede le domande.
 *
 * La POST aveva da sempre un ramo ospite esplicito — si può fare una domanda
 * senza essere iscritti — mentre la GET pretendeva un token: un ospite poteva
 * scrivere una domanda e poi non vederla, e in una chiamata istantanea il
 * pannello era vuoto per tutti. Stessa regola dei sondaggi, stesso cancello.
 */
vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn() },
    question: { findMany: vi.fn(), create: vi.fn() },
    questionUpvote: { findMany: vi.fn() },
    registration: { findUnique: vi.fn() },
    eventModerator: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/redis', () => ({ getRedis: () => null }));
vi.mock('@/lib/cache', () => ({
  getCached: vi.fn(() => null),
  setCache: vi.fn(),
  deleteCacheByPrefix: vi.fn(),
}));
vi.mock('@/lib/live-state/publish', () => ({ pokeLivePanel: vi.fn() }));
vi.mock('@/lib/events/join-grant', () => ({ hasJoinGrant: vi.fn(() => false) }));
vi.mock('@/lib/crypto/pii', () => ({ tryDecryptPII: (v: string) => v }));

import { prisma } from '@/lib/db';

import { GET, POST } from './route';

const mockedEvent = prisma.event.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedQuestions = prisma.question.findMany as unknown as ReturnType<typeof vi.fn>;
const mockedUpvotes = prisma.questionUpvote
  .findMany as unknown as ReturnType<typeof vi.fn>;
const mockedRegistration = prisma.registration
  .findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedGrant = prisma.eventModerator
  .findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedCreate = prisma.question.create as unknown as ReturnType<typeof vi.fn>;

const EVENT_ID = '44444444-4444-4444-8444-444444444444';
const SLUG = 'evento-di-prova';
const PRIMARY_TOKEN = 'PRIMARY_MOD_TOKEN';

const ctx = () => ({ params: Promise.resolve({ param: SLUG }) });

/** Il `where` con cui la rotta ha davvero interrogato il DB. */
function whereInterrogato(): Record<string, unknown> {
  const call = mockedQuestions.mock.calls[0]?.[0] as
    | { where: Record<string, unknown> }
    | undefined;
  expect(call, 'nessuna interrogazione alle domande').toBeDefined();
  return call!.where;
}

function get(headers: HeadersInit = {}): NextRequest {
  return new Request(`https://webinar.gov.it/api/events/${SLUG}/questions`, {
    headers,
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedEvent.mockResolvedValue({
    id: EVENT_ID,
    status: 'LIVE',
    eventType: 'INSTANT',
    moderatorToken: PRIMARY_TOKEN,
    joinPasswordHash: null,
    qaEnabled: true,
  });
  mockedQuestions.mockResolvedValue([
    {
      id: 'q-1',
      authorName: 'Anna',
      text: 'Ci sarà la registrazione?',
      status: 'PENDING',
      upvoteCount: 0,
      createdAt: new Date('2026-09-22T10:00:00.000Z'),
      highlightedAt: null,
      answeredAt: null,
    },
  ]);
  mockedUpvotes.mockResolvedValue([]);
  mockedCreate.mockResolvedValue({
    id: 'q-new',
    authorName: 'Relatrice',
    text: 'Una domanda',
    status: 'PENDING',
    upvoteCount: 0,
    createdAt: new Date('2026-09-22T10:05:00.000Z'),
    highlightedAt: null,
    answeredAt: null,
  });
  mockedRegistration.mockResolvedValue(null);
  mockedGrant.mockResolvedValue(null);
});

describe('GET /api/events/[slug]/questions — chi vede le domande', () => {
  it('un ospite le vede, anche col «Bearer » vuoto che manda la sala', async () => {
    const casi: HeadersInit[] = [{}, { Authorization: 'Bearer ' }];
    for (const headers of casi) {
      const res = await GET(get(headers), ctx());
      expect(res.status).toBe(200);
      expect((await res.json()).questions).toHaveLength(1);
    }
  });

  it('al pubblico arrivano solo gli stati pubblicabili', async () => {
    await GET(get(), ctx());
    expect(whereInterrogato()).toMatchObject({
      status: { in: ['PENDING', 'HIGHLIGHTED', 'ANSWERED'] },
    });
  });

  it('il relatore legge come il pubblico invece di prendersi un 403', async () => {
    mockedGrant.mockResolvedValue({ eventId: EVENT_ID, revokedAt: null });
    const res = await GET(get({ Authorization: 'Bearer TOKEN_RELATORE' }), ctx());
    expect(res.status).toBe(200);
    expect(whereInterrogato()).toMatchObject({
      status: { in: ['PENDING', 'HIGHLIGHTED', 'ANSWERED'] },
    });
  });

  it('il moderatore vede anche ciò che il pubblico non vede', async () => {
    const res = await GET(get({ Authorization: `Bearer ${PRIMARY_TOKEN}` }), ctx());
    expect(res.status).toBe(200);
    expect(whereInterrogato()).toEqual({ eventId: EVENT_ID });
  });

  it('senza una registrazione il pollice in su non si può dare', async () => {
    // Il pannello si regola su questo campo: prima mostrava a ospiti e
    // relatori un pulsante che rispondeva 401 senza dirlo a nessuno.
    const ospite = await (await GET(get(), ctx())).json();
    expect(ospite.canUpvote).toBe(false);

    mockedRegistration.mockResolvedValue({ id: 'reg-1', eventId: EVENT_ID });
    const iscritto = await (
      await GET(get({ Authorization: 'Bearer ALICE' }), ctx())
    ).json();
    expect(iscritto.canUpvote).toBe(true);
  });

  it('un token che non risolve resta un 403', async () => {
    expect((await GET(get({ Authorization: 'Bearer SCADUTO' }), ctx())).status).toBe(403);
  });
});

describe('POST /api/events/[slug]/questions — chi puo\u2019 chiedere', () => {
  function ask(body: Record<string, unknown>): NextRequest {
    return new Request(`https://webinar.gov.it/api/events/${SLUG}/questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.11' },
      body: JSON.stringify(body),
    }) as unknown as NextRequest;
  }

  it('il relatore fa una domanda col proprio grant, non con una registrazione', async () => {
    // Il pannello gli mostra il modulo; cercare quel token solo fra gli
    // iscritti glielo faceva rifiutare con un errore generico.
    mockedGrant.mockResolvedValue({
      eventId: EVENT_ID,
      revokedAt: null,
      name: 'Relatrice',
    });
    const res = await POST(
      ask({ text: 'Una domanda dal relatore', accessToken: 'TOKEN_RELATORE' }),
      ctx(),
    );
    expect(res.status).toBe(201);
    const data = mockedCreate.mock.calls[0]?.[0] as
      | { data: Record<string, unknown> }
      | undefined;
    expect(data?.data).toMatchObject({ authorName: 'Relatrice', registrationId: undefined });
  });

  it('un grant revocato non fa piu\u2019 domande', async () => {
    mockedGrant.mockResolvedValue({
      eventId: EVENT_ID,
      revokedAt: new Date(),
      name: 'Relatrice',
    });
    const res = await POST(
      ask({ text: 'Una domanda dal relatore', accessToken: 'TOKEN_RELATORE' }),
      ctx(),
    );
    expect(res.status).toBe(403);
    expect(mockedCreate).not.toHaveBeenCalled();
  });
});
