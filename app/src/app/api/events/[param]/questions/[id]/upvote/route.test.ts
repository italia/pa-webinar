import type { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Chi può sostenere una domanda col pollice in su.
 *
 * Il voto pretendeva una registrazione: in una chiamata rapida, dove sono
 * tutti ospiti, nessuno poteva sostenere una domanda, e relatori e moderatori
 * nemmeno negli eventi a calendario. Ora chi non è iscritto vota con
 * l'identificativo stabile del browser, come nei sondaggi e nella nuvola di
 * parole, e passa lo stesso cancello della lettura del pannello. I due voti
 * stanno in tabelle diverse: `question_upvotes` per la registrazione,
 * `question_guest_upvotes` per l'identificativo del browser.
 */
vi.mock('@/lib/db', () => {
  const tx = {
    questionUpvote: { deleteMany: vi.fn(), createMany: vi.fn() },
    questionGuestUpvote: { deleteMany: vi.fn(), createMany: vi.fn() },
    question: { update: vi.fn() },
  };
  return {
    prisma: {
      event: { findUnique: vi.fn() },
      registration: { findUnique: vi.fn() },
      eventModerator: { findUnique: vi.fn() },
      question: { findUnique: vi.fn() },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      __tx: tx,
    },
  };
});
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

type Mock = ReturnType<typeof vi.fn>;
const db = prisma as unknown as {
  event: { findUnique: Mock };
  registration: { findUnique: Mock };
  eventModerator: { findUnique: Mock };
  question: { findUnique: Mock };
  $transaction: Mock;
  __tx: {
    questionUpvote: { deleteMany: Mock; createMany: Mock };
    questionGuestUpvote: { deleteMany: Mock; createMany: Mock };
    question: { update: Mock };
  };
};
const tx = db.__tx;

const EVENT_ID = '77777777-7777-4777-8777-777777777777';
const QUESTION_ID = '88888888-8888-4888-8888-888888888888';
const SLUG = 'chiamata-di-prova';
const PRIMARY_TOKEN = 'PRIMARY_MOD_TOKEN';

const ctx = () => ({ params: Promise.resolve({ param: SLUG, id: QUESTION_ID }) });

let ipSeq = 0;
function upvote(
  body: Record<string, unknown> | null,
  { bearer, ip, query = '' }: { bearer?: string; ip?: string; query?: string } = {},
): NextRequest {
  // Un indirizzo diverso per richiesta, se non lo si fissa: il tetto per IP
  // è l'oggetto di un solo test.
  ipSeq += 1;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-forwarded-for': ip ?? `192.0.2.${ipSeq % 250}`,
  };
  if (bearer !== undefined) headers.Authorization = `Bearer ${bearer}`;
  return new Request(
    `https://webinar.gov.it/api/events/${SLUG}/questions/${QUESTION_ID}/upvote${query}`,
    { method: 'POST', headers, body: body === null ? undefined : JSON.stringify(body) },
  ) as unknown as NextRequest;
}

let guestSeq = 0;
/** Un identificativo nuovo per test: il limite per persona è in memoria. */
const nuovoOspite = () => `guest_up_${++guestSeq}`;

function eventoInDiretta(over: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    status: 'LIVE',
    eventType: 'INSTANT',
    moderatorToken: PRIMARY_TOKEN,
    joinPasswordHash: null,
    ...over,
  };
}

/** Il voto che la rotta ha provato a scrivere, e in quale tabella. */
function votoScritto(): Record<string, unknown> | undefined {
  const perRegistrazione = tx.questionUpvote.createMany.mock.calls[0]?.[0] as
    | { data: Record<string, unknown>[] }
    | undefined;
  const perBrowser = tx.questionGuestUpvote.createMany.mock.calls[0]?.[0] as
    | { data: Record<string, unknown>[] }
    | undefined;
  // Mai tutte e due: un voto è di una sola identità.
  expect(perRegistrazione && perBrowser).toBeFalsy();
  if (perRegistrazione) return { tabella: 'question_upvotes', ...perRegistrazione.data[0] };
  if (perBrowser) return { tabella: 'question_guest_upvotes', ...perBrowser.data[0] };
  return undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  siteSettings.guestAccessEnabled = true;
  db.event.findUnique.mockResolvedValue(eventoInDiretta());
  db.registration.findUnique.mockResolvedValue(null);
  db.eventModerator.findUnique.mockResolvedValue(null);
  db.question.findUnique.mockResolvedValue({ id: QUESTION_ID, eventId: EVENT_ID });
  db.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
  tx.questionUpvote.deleteMany.mockResolvedValue({ count: 0 });
  tx.questionUpvote.createMany.mockResolvedValue({ count: 1 });
  tx.questionGuestUpvote.deleteMany.mockResolvedValue({ count: 0 });
  tx.questionGuestUpvote.createMany.mockResolvedValue({ count: 1 });
  tx.question.update.mockResolvedValue({ upvoteCount: 3 });
});

describe('POST /api/events/[slug]/questions/[id]/upvote — chi vota', () => {
  it("un ospite in sala vota con l'identificativo del browser", async () => {
    const guestId = nuovoOspite();
    const res = await POST(upvote({ guestId }), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ upvoted: true, upvoteCount: 3 });
    expect(votoScritto()).toEqual({ tabella: 'question_guest_upvotes', questionId: QUESTION_ID, guestId });
    expect(tx.question.update.mock.calls[0]?.[0]?.data).toEqual({ upvoteCount: { increment: 1 } });
    expect(pokeLivePanel).toHaveBeenCalledWith(EVENT_ID, 'qa');
  });

  it("l'iscritto vota con la propria registrazione, nel corpo o come ?token=", async () => {
    db.registration.findUnique.mockResolvedValue({ id: 'reg-1', eventId: EVENT_ID });

    const corpo = await POST(upvote({ accessToken: 'ALICE' }), ctx());
    expect(corpo.status).toBe(200);
    expect(votoScritto()).toEqual({ tabella: 'question_upvotes', questionId: QUESTION_ID, registrationId: 'reg-1' });

    vi.clearAllMocks();
    db.registration.findUnique.mockResolvedValue({ id: 'reg-2', eventId: EVENT_ID });
    db.event.findUnique.mockResolvedValue(eventoInDiretta());
    db.question.findUnique.mockResolvedValue({ id: QUESTION_ID, eventId: EVENT_ID });
    tx.questionUpvote.deleteMany.mockResolvedValue({ count: 0 });
    tx.questionUpvote.createMany.mockResolvedValue({ count: 1 });
    tx.questionGuestUpvote.deleteMany.mockResolvedValue({ count: 0 });
    tx.questionGuestUpvote.createMany.mockResolvedValue({ count: 1 });
    tx.question.update.mockResolvedValue({ upvoteCount: 4 });
    const query = await POST(upvote(null, { query: '?token=BOB' }), ctx());
    expect(query.status).toBe(200);
    expect(votoScritto()).toEqual({ tabella: 'question_upvotes', questionId: QUESTION_ID, registrationId: 'reg-2' });
  });

  it('il relatore vota col browser, mostrando il token di sala come prova di presenza', async () => {
    db.eventModerator.findUnique.mockResolvedValue({ eventId: EVENT_ID, revokedAt: null });
    const guestId = nuovoOspite();
    const res = await POST(upvote({ guestId }, { bearer: 'TOKEN_RELATORE' }), ctx());
    expect(res.status).toBe(200);
    expect(votoScritto()).toEqual({ tabella: 'question_guest_upvotes', questionId: QUESTION_ID, guestId });
  });

  it('il moderatore vota anche fuori dalla finestra degli ospiti', async () => {
    siteSettings.guestAccessEnabled = false;
    db.event.findUnique.mockResolvedValue(eventoInDiretta({ eventType: 'SCHEDULED' }));
    const res = await POST(upvote({ guestId: nuovoOspite() }, { bearer: PRIMARY_TOKEN }), ctx());
    expect(res.status).toBe(200);
  });

  it("l'iscritto che manda anche l'identificativo conta una volta sola, per la registrazione", async () => {
    db.registration.findUnique.mockResolvedValue({ id: 'reg-1', eventId: EVENT_ID });
    const res = await POST(upvote({ guestId: nuovoOspite() }, { bearer: 'ALICE' }), ctx());
    expect(res.status).toBe(200);
    expect(votoScritto()).toEqual({ tabella: 'question_upvotes', questionId: QUESTION_ID, registrationId: 'reg-1' });
  });

  it('senza nessuna identità è un 401, e non si tocca il DB', async () => {
    expect((await POST(upvote({}), ctx())).status).toBe(401);
    expect((await POST(upvote(null), ctx())).status).toBe(401);
    expect(db.event.findUnique).not.toHaveBeenCalled();
  });

  it('un token che non risolve resta un errore, non un voto da ospite', async () => {
    const conBearer = await POST(upvote({ guestId: nuovoOspite() }, { bearer: 'SCADUTO' }), ctx());
    expect(conBearer.status).toBe(403);
    const conCorpo = await POST(upvote({ accessToken: 'SCADUTO' }), ctx());
    expect(conCorpo.status).toBe(403);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('un identificativo oltre i cento caratteri è rifiutato', async () => {
    const res = await POST(upvote({ guestId: 'x'.repeat(101) }), ctx());
    expect(res.status).toBe(422);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('un identificativo che non è un UUID è una domanda che non esiste, non un errore interno', async () => {
    const res = await POST(upvote({ guestId: nuovoOspite() }), {
      params: Promise.resolve({ param: SLUG, id: 'null' }),
    });
    expect(res.status).toBe(404);
    expect(db.question.findUnique).not.toHaveBeenCalled();
  });

  it('una domanda di un altro evento non esiste', async () => {
    db.question.findUnique.mockResolvedValue({ id: QUESTION_ID, eventId: 'altro' });
    expect((await POST(upvote({ guestId: nuovoOspite() }), ctx())).status).toBe(404);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe('POST /api/events/[slug]/questions/[id]/upvote — la finestra degli ospiti', () => {
  it('prima della diretta un evento a calendario non si vota senza token', async () => {
    db.event.findUnique.mockResolvedValue(
      eventoInDiretta({ status: 'PUBLISHED', eventType: 'SCHEDULED' }),
    );
    expect((await POST(upvote({ guestId: nuovoOspite() }), ctx())).status).toBe(401);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("con l'accesso ospiti spento un evento a calendario si vota solo con un token", async () => {
    siteSettings.guestAccessEnabled = false;
    db.event.findUnique.mockResolvedValue(eventoInDiretta({ eventType: 'SCHEDULED' }));
    expect((await POST(upvote({ guestId: nuovoOspite() }), ctx())).status).toBe(401);
  });

  it('a un evento protetto da password vota solo chi la password la conosce', async () => {
    db.event.findUnique.mockResolvedValue(eventoInDiretta({ joinPasswordHash: 'hash' }));
    expect((await POST(upvote({ guestId: nuovoOspite() }), ctx())).status).toBe(401);

    vi.mocked(hasJoinGrant).mockResolvedValueOnce(true);
    expect((await POST(upvote({ guestId: nuovoOspite() }), ctx())).status).toBe(200);
  });
});

describe('POST /api/events/[slug]/questions/[id]/upvote — il contatore segue le righe', () => {
  it('il secondo clic ritira il voto, e solo quello di chi clicca', async () => {
    const guestId = nuovoOspite();
    tx.questionGuestUpvote.deleteMany.mockResolvedValue({ count: 1 });
    tx.question.update.mockResolvedValue({ upvoteCount: 2 });
    const res = await POST(upvote({ guestId }), ctx());
    expect(await res.json()).toEqual({ upvoted: false, upvoteCount: 2 });
    // Il filtro porta sempre l'identità: senza, il ritiro toglierebbe i voti
    // di tutti.
    expect(tx.questionGuestUpvote.deleteMany.mock.calls[0]?.[0]).toEqual({
      where: { questionId: QUESTION_ID, guestId },
    });
    expect(tx.question.update.mock.calls[0]?.[0]?.data).toEqual({ upvoteCount: { decrement: 1 } });
    expect(tx.questionGuestUpvote.createMany).not.toHaveBeenCalled();
    // La tabella delle registrazioni non si tocca per un voto dal browser.
    expect(tx.questionUpvote.deleteMany).not.toHaveBeenCalled();
  });

  it("l'iscritto ritira il proprio voto dalla tabella delle registrazioni", async () => {
    db.registration.findUnique.mockResolvedValue({ id: 'reg-1', eventId: EVENT_ID });
    tx.questionUpvote.deleteMany.mockResolvedValue({ count: 1 });
    tx.question.update.mockResolvedValue({ upvoteCount: 0 });
    const res = await POST(upvote({ accessToken: 'ALICE' }), ctx());
    expect(await res.json()).toEqual({ upvoted: false, upvoteCount: 0 });
    expect(tx.questionUpvote.deleteMany.mock.calls[0]?.[0]).toEqual({
      where: { questionId: QUESTION_ID, registrationId: 'reg-1' },
    });
    expect(tx.questionGuestUpvote.deleteMany).not.toHaveBeenCalled();
  });

  it('un doppio clic che trova il voto già scritto non è un errore e non conta due volte', async () => {
    tx.questionGuestUpvote.createMany.mockResolvedValue({ count: 0 });
    const res = await POST(upvote({ guestId: nuovoOspite() }), ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).upvoted).toBe(true);
    expect(tx.questionGuestUpvote.createMany.mock.calls[0]?.[0]?.skipDuplicates).toBe(true);
    expect(tx.question.update.mock.calls[0]?.[0]?.data).toEqual({ upvoteCount: { increment: 0 } });
  });

  it('il contatore non scende mai sotto zero nella risposta', async () => {
    tx.questionGuestUpvote.deleteMany.mockResolvedValue({ count: 1 });
    tx.question.update.mockResolvedValue({ upvoteCount: -1 });
    const res = await POST(upvote({ guestId: nuovoOspite() }), ctx());
    expect((await res.json()).upvoteCount).toBe(0);
  });
});

describe('POST /api/events/[slug]/questions/[id]/upvote — limiti', () => {
  it('dieci voti al minuto a persona', async () => {
    const guestId = nuovoOspite();
    const esiti: number[] = [];
    for (let i = 0; i < 11; i++) {
      esiti.push((await POST(upvote({ guestId }), ctx())).status);
    }
    expect(esiti.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(esiti[10]).toBe(429);
  });

  it('sessanta persone da cinque voti dietro un solo indirizzo passano; oltre, il tetto ferma chi ruota', async () => {
    const ip = '198.51.100.77';
    const esiti = new Map<number, number>();
    for (let persona = 0; persona < 60; persona++) {
      const guestId = `guest_nat_up_${persona}`;
      for (let voto = 0; voto < 5; voto++) {
        const res = await POST(upvote({ guestId }, { ip }), ctx());
        esiti.set(res.status, (esiti.get(res.status) ?? 0) + 1);
      }
    }
    expect(Object.fromEntries(esiti)).toEqual({ 200: 300 });

    const oltre = await POST(upvote({ guestId: nuovoOspite() }, { ip }), ctx());
    expect(oltre.status).toBe(429);
    expect((await oltre.json()).code).toBe('NETWORK_RATE_LIMIT');
  });
});
