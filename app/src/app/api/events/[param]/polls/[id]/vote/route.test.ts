import type { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Il voto, dal confine HTTP.
 *
 * Qui vive la seconda metà del difetto: il pannello mandava SEMPRE il token di
 * sala come `accessToken`, e il server lo cerca fra le registrazioni. Per un
 * moderatore — che una registrazione non ce l'ha — era un 403 secco: «nessuno
 * che vede il sondaggio può votare». L'identità di chi non è iscritto è
 * l'identificativo stabile del browser, e questi test la fissano.
 */
vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn() },
    poll: { findUnique: vi.fn() },
    pollVote: { findUnique: vi.fn(), create: vi.fn() },
    registration: { findUnique: vi.fn() },
    eventModerator: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/live-state/publish', () => ({ pokeLivePanel: vi.fn() }));
vi.mock('@/lib/events/join-grant', () => ({ hasJoinGrant: vi.fn() }));

import { prisma } from '@/lib/db';
import { hasJoinGrant } from '@/lib/events/join-grant';

import { POST } from './route';

const mockedEvent = prisma.event.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedPoll = prisma.poll.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedExisting = prisma.pollVote.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedCreate = prisma.pollVote.create as unknown as ReturnType<typeof vi.fn>;
const mockedRegistration = prisma.registration
  .findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedGrant = prisma.eventModerator
  .findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedJoinGrant = hasJoinGrant as unknown as ReturnType<typeof vi.fn>;

const EVENT_ID = '33333333-3333-4333-8333-333333333333';
const SLUG = 'evento-di-prova';
const POLL_ID = 'poll-1';
const PRIMARY_TOKEN = 'PRIMARY_MOD_TOKEN';

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

const ctx = () => ({ params: Promise.resolve({ param: SLUG, id: POLL_ID }) });

/** La riga di voto davvero persistita: è lì che si legge con quale identità. */
function votoPersistito(): Record<string, unknown> {
  const call = mockedCreate.mock.calls[0]?.[0] as
    | { data: Record<string, unknown> }
    | undefined;
  expect(call, 'nessun voto persistito').toBeDefined();
  return call!.data;
}

/** Un identificativo diverso per test: il freno anti-abuso è in memoria e
 *  vive per tutto il file. */
let seq = 0;
const nextGuest = () => `guest_${(seq += 1).toString().padStart(6, '0')}`;

function vote(body: Record<string, unknown>, bearer?: string): NextRequest {
  return new Request(
    `https://webinar.gov.it/api/events/${SLUG}/polls/${POLL_ID}/vote`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.9',
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify(body),
    },
  ) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedEvent.mockResolvedValue(eventRow());
  mockedPoll.mockResolvedValue({
    id: POLL_ID,
    eventId: EVENT_ID,
    status: 'OPEN',
    options: ['Sì', 'No'],
  });
  mockedExisting.mockResolvedValue(null);
  mockedCreate.mockResolvedValue({ id: 'vote-1' });
  mockedRegistration.mockResolvedValue(null);
  mockedGrant.mockResolvedValue(null);
  mockedJoinGrant.mockResolvedValue(false);
});

describe('POST .../polls/[id]/vote — con quale identità si vota', () => {
  it('chi non è iscritto vota con l’identificativo del browser', async () => {
    const guestId = nextGuest();
    const res = await POST(vote({ optionIndex: 1, guestId }), ctx());
    expect(res.status).toBe(201);
    expect(votoPersistito()).toMatchObject({
      pollId: POLL_ID,
      registrationId: null,
      guestId,
      optionIndex: 1,
    });
  });

  it('il token di sala NON è un’identità di voto', async () => {
    // Documenta il 403 che il pannello si prendeva: il server cerca quel
    // valore fra le registrazioni, e un token moderatore non c'è.
    const res = await POST(
      vote({ optionIndex: 0, accessToken: PRIMARY_TOKEN }),
      ctx(),
    );
    expect(res.status).toBe(403);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('l’iscritto vota con la propria registrazione', async () => {
    mockedRegistration.mockResolvedValue({ id: 'reg-1', eventId: EVENT_ID });
    const res = await POST(vote({ optionIndex: 0, accessToken: 'ALICE' }), ctx());
    expect(res.status).toBe(201);
    expect(votoPersistito()).toMatchObject({
      registrationId: 'reg-1',
      guestId: null,
    });
  });

  it('due voti dallo stesso browser: il secondo è un conflitto', async () => {
    mockedExisting.mockResolvedValue({ id: 'vote-1' });
    const res = await POST(vote({ optionIndex: 0, guestId: nextGuest() }), ctx());
    expect(res.status).toBe(409);
  });

  it('fuori dalla finestra della sala un anonimo non vota', async () => {
    // Senza questo, chi conosce lo slug voterebbe su un sondaggio rimasto
    // aperto in un evento che non è più in diretta.
    mockedEvent.mockResolvedValue(eventRow({ status: 'ENDED' }));
    const res = await POST(vote({ optionIndex: 0, guestId: nextGuest() }), ctx());
    expect(res.status).toBe(401);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('chi conduce vota anche prima della diretta, mostrando il token di sala', async () => {
    // Un evento in pre-riscaldamento non è ancora "in diretta": l'ospite non
    // entra, ma moderatori e relatori ci sono già — e votano con
    // l'identificativo del browser, non col token.
    mockedEvent.mockResolvedValue(eventRow({ status: 'PROVISIONING' }));
    const senzaToken = await POST(vote({ optionIndex: 0, guestId: nextGuest() }), ctx());
    expect(senzaToken.status).toBe(401);

    const conToken = await POST(
      vote({ optionIndex: 0, guestId: nextGuest() }, PRIMARY_TOKEN),
      ctx(),
    );
    expect(conToken.status).toBe(201);
    expect(votoPersistito()).toMatchObject({ registrationId: null });
  });

  it('con la password, serve il cookie di accesso', async () => {
    mockedEvent.mockResolvedValue(eventRow({ joinPasswordHash: 'hash' }));
    const negato = await POST(vote({ optionIndex: 0, guestId: nextGuest() }), ctx());
    expect(negato.status).toBe(401);

    mockedJoinGrant.mockResolvedValue(true);
    const ok = await POST(vote({ optionIndex: 0, guestId: nextGuest() }), ctx());
    expect(ok.status).toBe(201);
  });

  it('un sondaggio chiuso non accetta voti', async () => {
    mockedPoll.mockResolvedValue({
      id: POLL_ID,
      eventId: EVENT_ID,
      status: 'CLOSED',
      options: ['Sì', 'No'],
    });
    const res = await POST(vote({ optionIndex: 0, guestId: nextGuest() }), ctx());
    expect(res.status).toBe(409);
  });
});
