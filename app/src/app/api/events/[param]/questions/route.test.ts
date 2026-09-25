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
    questionGuestUpvote: { findMany: vi.fn() },
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
vi.mock('@/lib/events/join-grant', () => ({ hasJoinGrant: vi.fn(async () => false) }));
vi.mock('@/lib/crypto/pii', () => ({ tryDecryptPII: (v: string) => v }));
const { siteSettings } = vi.hoisted(() => ({ siteSettings: { guestAccessEnabled: true } }));
vi.mock('@/lib/settings', () => ({ getSettings: async () => siteSettings }));

import { prisma } from '@/lib/db';
import { hasJoinGrant } from '@/lib/events/join-grant';

import { GET, POST } from './route';

const mockedEvent = prisma.event.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedQuestions = prisma.question.findMany as unknown as ReturnType<typeof vi.fn>;
const mockedUpvotes = prisma.questionUpvote
  .findMany as unknown as ReturnType<typeof vi.fn>;
const mockedGuestUpvotes = prisma.questionGuestUpvote
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

/** Una domanda pubblicabile con il numero di voti dato. */
function domanda(id: string, upvoteCount: number) {
  return {
    id,
    authorName: 'Anna',
    text: `Domanda ${id}`,
    status: 'PENDING',
    upvoteCount,
    createdAt: new Date('2026-09-22T10:00:00.000Z'),
    highlightedAt: null,
    answeredAt: null,
  };
}

function get(headers: HeadersInit = {}, query = ''): NextRequest {
  return new Request(`https://webinar.gov.it/api/events/${SLUG}/questions${query}`, {
    headers,
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  siteSettings.guestAccessEnabled = true;
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
  mockedGuestUpvotes.mockResolvedValue([]);
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

  it('senza nessuna identità di voto il pollice in su non si può dare', async () => {
    // Il pannello si regola su questo campo: senza, mostrerebbe un pulsante
    // che risponde 401 senza dirlo a nessuno.
    const anonimo = await (await GET(get(), ctx())).json();
    expect(anonimo.canUpvote).toBe(false);
    expect(mockedUpvotes).not.toHaveBeenCalled();
    expect(mockedGuestUpvotes).not.toHaveBeenCalled();

    mockedRegistration.mockResolvedValue({ id: 'reg-1', eventId: EVENT_ID });
    const iscritto = await (
      await GET(get({ Authorization: 'Bearer ALICE' }), ctx())
    ).json();
    expect(iscritto.canUpvote).toBe(true);
  });

  it("l'ospite vota con l'identificativo del browser e ritrova i propri voti", async () => {
    mockedQuestions.mockResolvedValue([domanda('q-1', 2), domanda('q-2', 0)]);
    mockedGuestUpvotes.mockResolvedValue([{ questionId: 'q-1' }]);
    const res = await GET(get({}, '?guestId=guest_abc'), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.canUpvote).toBe(true);
    expect(body.questions.find((q: { id: string }) => q.id === 'q-1').hasUpvoted).toBe(true);
    // Si cercano solo le domande che hanno almeno un voto, e nella tabella
    // dei voti dal browser.
    expect(mockedGuestUpvotes.mock.calls[0]?.[0]?.where).toEqual({
      guestId: 'guest_abc',
      questionId: { in: ['q-1'] },
    });
    expect(mockedUpvotes).not.toHaveBeenCalled();
  });

  it('finché nessuna domanda ha voti, la lettura non cerca i voti di chi legge', async () => {
    // Una sala piena che interroga il pannello ogni pochi secondi: senza
    // questa scorciatoia ogni lettura costerebbe una query in più anche
    // quando la risposta è per forza vuota.
    const body = await (await GET(get({}, '?guestId=guest_abc'), ctx())).json();
    expect(body.canUpvote).toBe(true);
    expect(body.questions[0].hasUpvoted).toBe(false);
    expect(mockedGuestUpvotes).not.toHaveBeenCalled();
    expect(mockedUpvotes).not.toHaveBeenCalled();
  });

  it('anche il relatore vota col browser, mostrando il token di sala', async () => {
    mockedQuestions.mockResolvedValue([domanda('q-1', 1)]);
    mockedGrant.mockResolvedValue({ eventId: EVENT_ID, revokedAt: null });
    const body = await (
      await GET(get({ Authorization: 'Bearer TOKEN_RELATORE' }, '?guestId=guest_rel'), ctx())
    ).json();
    expect(body.canUpvote).toBe(true);
    expect(mockedGuestUpvotes.mock.calls[0]?.[0]?.where).toMatchObject({ guestId: 'guest_rel' });
  });

  it("l'iscritto conta per la registrazione anche se manda l'identificativo", async () => {
    mockedQuestions.mockResolvedValue([domanda('q-1', 1)]);
    mockedRegistration.mockResolvedValue({ id: 'reg-1', eventId: EVENT_ID });
    await GET(get({ Authorization: 'Bearer ALICE' }, '?guestId=guest_abc'), ctx());
    const where = mockedUpvotes.mock.calls[0]?.[0]?.where;
    expect(where).toMatchObject({ registrationId: 'reg-1' });
    expect(where).not.toHaveProperty('guestId');
    expect(mockedGuestUpvotes).not.toHaveBeenCalled();
  });

  it('un identificativo vuoto o troppo lungo non è un’identità', async () => {
    mockedQuestions.mockResolvedValue([domanda('q-1', 1)]);
    for (const q of ['?guestId=', '?guestId=%20%20', `?guestId=${'x'.repeat(101)}`]) {
      const body = await (await GET(get({}, q), ctx())).json();
      expect(body.canUpvote, q).toBe(false);
    }
    expect(mockedUpvotes).not.toHaveBeenCalled();
    expect(mockedGuestUpvotes).not.toHaveBeenCalled();
  });

  it('fuori dalla finestra degli ospiti l’identificativo non apre il pannello', async () => {
    mockedEvent.mockResolvedValue({
      id: EVENT_ID,
      status: 'PUBLISHED',
      eventType: 'SCHEDULED',
      moderatorToken: PRIMARY_TOKEN,
      joinPasswordHash: null,
      qaEnabled: true,
    });
    expect((await GET(get({}, '?guestId=guest_abc'), ctx())).status).toBe(401);
  });

  it('un token che non risolve resta un 403', async () => {
    expect((await GET(get({ Authorization: 'Bearer SCADUTO' }), ctx())).status).toBe(403);
  });

  it("con l'accesso ospiti spento un evento a calendario non si legge senza token", async () => {
    siteSettings.guestAccessEnabled = false;
    mockedEvent.mockResolvedValue({
      id: EVENT_ID,
      status: 'LIVE',
      eventType: 'SCHEDULED',
      moderatorToken: PRIMARY_TOKEN,
      joinPasswordHash: null,
      qaEnabled: true,
    });
    expect((await GET(get(), ctx())).status).toBe(401);
    // Chi ha un token legge come prima.
    expect((await GET(get({ Authorization: `Bearer ${PRIMARY_TOKEN}` }), ctx())).status).toBe(200);
  });
});

describe('POST /api/events/[slug]/questions — chi puo\u2019 chiedere', () => {
  function ask(body: Record<string, unknown>, ip = '203.0.113.11'): NextRequest {
    return new Request(`https://webinar.gov.it/api/events/${SLUG}/questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify(body),
    }) as unknown as NextRequest;
  }

  function scheduled(status: string) {
    mockedEvent.mockResolvedValue({
      id: EVENT_ID,
      status,
      eventType: 'SCHEDULED',
      moderatorToken: PRIMARY_TOKEN,
      joinPasswordHash: null,
      qaEnabled: true,
    });
  }

  it('un ospite in sala chiede col solo nome', async () => {
    scheduled('LIVE');
    const res = await POST(
      ask({ text: 'Una domanda da ospite', guestName: 'Ospite' }, '203.0.113.21'),
      ctx(),
    );
    expect(res.status).toBe(201);
  });

  it('senza token, fuori dalla diretta non si chiede', async () => {
    // Un ospite in sala non c'è prima dell'avvio né dopo la fine: una
    // domanda anonima arriverebbe da chi alla sala non può entrare.
    for (const [i, status] of ['PUBLISHED', 'ENDED'].entries()) {
      scheduled(status);
      const res = await POST(
        ask({ text: 'Una domanda da ospite', guestName: 'Ospite' }, `203.0.113.3${i}`),
        ctx(),
      );
      expect(res.status, status).toBe(401);
    }
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("con l'accesso ospiti spento un evento a calendario non accetta domande anonime", async () => {
    siteSettings.guestAccessEnabled = false;
    scheduled('LIVE');
    const res = await POST(
      ask({ text: 'Una domanda da ospite', guestName: 'Ospite' }, '203.0.113.41'),
      ctx(),
    );
    expect(res.status).toBe(401);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('a un evento protetto da password chiede solo chi la password la conosce', async () => {
    // Chi ha solo il link non legge le domande (GET 401): non deve nemmeno
    // poterne riempire il pannello, che tutta la sala vede.
    mockedEvent.mockResolvedValue({
      id: EVENT_ID,
      status: 'LIVE',
      eventType: 'INSTANT',
      moderatorToken: PRIMARY_TOKEN,
      joinPasswordHash: 'hash',
      qaEnabled: true,
    });
    const estraneo = await POST(
      ask({ text: 'Una domanda da fuori', guestName: 'Estraneo', guestId: 'guest_fuori' }, '203.0.113.61'),
      ctx(),
    );
    expect(estraneo.status).toBe(401);
    expect(mockedCreate).not.toHaveBeenCalled();

    vi.mocked(hasJoinGrant).mockResolvedValueOnce(true);
    const ospite = await POST(
      ask({ text: 'Una domanda da dentro', guestName: 'Ospite', guestId: 'guest_dentro' }, '203.0.113.62'),
      ctx(),
    );
    expect(ospite.status).toBe(201);
  });

  it("con l'accesso ospiti spento il relatore chiede come prima", async () => {
    siteSettings.guestAccessEnabled = false;
    scheduled('LIVE');
    mockedGrant.mockResolvedValue({ eventId: EVENT_ID, revokedAt: null, name: 'Relatrice' });
    const res = await POST(
      ask({ text: 'Una domanda dal relatore', accessToken: 'TOKEN_RELATORE' }, '203.0.113.51'),
      ctx(),
    );
    expect(res.status).toBe(201);
  });

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

describe('POST /api/events/[slug]/questions — una domanda ogni trenta secondi a persona', () => {
  /**
   * Il limite era per indirizzo IP, e l'indirizzo lo condivide chiunque stia
   * dietro lo stesso NAT: in una chiamata rapida, dove sono tutti ospiti, la
   * prima domanda di un ufficio bloccava quelle dei colleghi per mezzo minuto,
   * e il pannello diceva loro di aspettare prima di inviarne "un'altra". I
   * test qui sopra usano un indirizzo diverso per caso proprio per non
   * inciamparci: questi lo tengono fisso di proposito.
   */
  function ask(body: Record<string, unknown>, ip: string): NextRequest {
    return new Request(`https://webinar.gov.it/api/events/${SLUG}/questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify(body),
    }) as unknown as NextRequest;
  }

  it('due ospiti dietro lo stesso indirizzo chiedono entrambi', async () => {
    const ip = '198.51.100.10';
    const a = await POST(
      ask({ text: 'Prima domanda', guestName: 'Anna', guestId: 'guest_nat_a' }, ip),
      ctx(),
    );
    const b = await POST(
      ask({ text: 'Seconda domanda', guestName: 'Bruno', guestId: 'guest_nat_b' }, ip),
      ctx(),
    );
    expect([a.status, b.status]).toEqual([201, 201]);
  });

  it('lo stesso ospite aspetta trenta secondi fra una domanda e l’altra', async () => {
    const ip = '198.51.100.11';
    const body = { text: 'Una domanda', guestName: 'Carla', guestId: 'guest_ripete' };
    expect((await POST(ask(body, ip), ctx())).status).toBe(201);
    const seconda = await POST(ask(body, '198.51.100.12'), ctx());
    expect(seconda.status).toBe(429);
    expect(((await seconda.json()) as { code: string }).code).toBe('RATE_LIMIT');
  });

  it('relatore e ospite dietro lo stesso indirizzo non si bloccano a vicenda', async () => {
    const ip = '198.51.100.13';
    mockedGrant.mockResolvedValue({
      id: 'grant-relatore',
      eventId: EVENT_ID,
      revokedAt: null,
      name: 'Relatrice',
    });
    const relatore = await POST(
      ask({ text: 'Domanda del relatore', accessToken: 'TOKEN_RELATORE' }, ip),
      ctx(),
    );
    const ospite = await POST(
      ask({ text: 'Domanda di un ospite', guestName: 'Dario', guestId: 'guest_accanto' }, ip),
      ctx(),
    );
    expect([relatore.status, ospite.status]).toEqual([201, 201]);
  });

  it('una sala di colleghi dietro lo stesso indirizzo chiede nello stesso minuto', async () => {
    // Con un tetto di venti il ventunesimo collega, che non aveva mai chiesto
    // nulla, si sentiva dire di aspettare prima di un'«altra» domanda.
    const ip = '198.51.100.17';
    for (let i = 0; i < 40; i++) {
      const res = await POST(
        ask({ text: `Domanda del collega ${i}`, guestName: 'Collega', guestId: `guest_ufficio_${i}` }, ip),
        ctx(),
      );
      expect(res.status, `collega ${i}`).toBe(201);
    }
  });

  it('chi cambia identificativo a ogni domanda si ferma al tetto per indirizzo', async () => {
    const ip = '198.51.100.14';
    const esiti: Response[] = [];
    for (let i = 0; i < 61; i++) {
      esiti.push(
        await POST(
          ask({ text: `Domanda numero ${i}`, guestName: 'Eva', guestId: `guest_ruota_${i}` }, ip),
          ctx(),
        ),
      );
    }
    expect(esiti.slice(0, 60).every((r) => r.status === 201)).toBe(true);
    expect(esiti[60]!.status).toBe(429);
    // Un codice suo: il pannello non deve parlare di un'«altra» domanda.
    expect(((await esiti[60]!.json()) as { code: string }).code).toBe('NETWORK_RATE_LIMIT');
  });

  it('chi il tetto ha respinto non si trova consumato anche il proprio mezzo minuto', async () => {
    // Il tetto viene prima del limite personale: registrare prima la chiave
    // personale — scelta dal client — aggiungeva una voce in memoria per
    // ogni identificativo inventato, anche quando il tetto poi respingeva.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-25T10:00:00.000Z'));
      const ip = '198.51.100.16';
      for (let i = 0; i < 60; i++) {
        const res = await POST(
          ask({ text: `Domanda numero ${i}`, guestName: 'Ivo', guestId: `guest_pieno_${i}` }, ip),
          ctx(),
        );
        expect(res.status).toBe(201);
      }
      // Tetto pieno: la domanda di Lia è respinta a 50 s dall'inizio.
      vi.setSystemTime(new Date('2026-09-25T10:00:50.000Z'));
      const lia = { text: 'La mia domanda', guestName: 'Lia', guestId: 'guest_lia' };
      expect((await POST(ask(lia, ip), ctx())).status).toBe(429);
      // Appena il tetto si svuota Lia chiede, senza aspettare altri trenta
      // secondi per una domanda che non è mai entrata.
      vi.setSystemTime(new Date('2026-09-25T10:01:01.000Z'));
      expect((await POST(ask(lia, ip), ctx())).status).toBe(201);
    } finally {
      vi.useRealTimers();
    }
  });

  it('senza identificativo resta il limite per indirizzo di prima', async () => {
    const ip = '198.51.100.15';
    const a = await POST(ask({ text: 'Prima domanda', guestName: 'Franco' }, ip), ctx());
    const b = await POST(ask({ text: 'Seconda domanda', guestName: 'Gina' }, ip), ctx());
    expect([a.status, b.status]).toEqual([201, 429]);
  });
});
