/**
 * Contratto della duplicazione di un evento.
 *
 * Nasce da un difetto reale: il bottone "Duplica come prossima occorrenza"
 * creava davvero la copia, ma il client navigava alla pagina di modifica SENZA
 * il token e quella pagina risponde notFound(). L'operatore vedeva un 404 e
 * pensava che la duplicazione fosse fallita, mentre l'evento era stato creato.
 *
 * Il pezzo che il client non può indovinare è il `moderatorToken` nella
 * risposta: qui si verifica che ci sia sempre. Nel progetto non esistono test
 * di componenti, quindi il lato client non è coperto direttamente — questa è la
 * metà che si può proteggere, ed è quella che, se sparisce, rompe l'altra.
 */

import type { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => ({ value: 'admin-session' }) })),
}));

vi.mock('@/lib/auth/admin-session', () => ({
  isAdminAuthenticated: vi.fn(async () => true),
}));

vi.mock('@/lib/audit/admin-audit', () => ({
  logAdminAction: vi.fn(async () => undefined),
}));

vi.mock('@/lib/utils/slug', () => ({
  generateUniqueSlug: vi.fn(async () => 'copia-evento'),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn(), create: vi.fn() },
    eventReminder: { findMany: vi.fn() },
  },
}));

import { prisma } from '@/lib/db';

import { POST } from './route';

/** La rotta valida l'id come UUID: un identificativo finto la ferma con un 400. */
const SOURCE_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

const mocked = prisma as unknown as {
  event: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  eventReminder: { findMany: ReturnType<typeof vi.fn> };
};

/** Sorgente minima: i campi che la rotta legge davvero. */
function sourceEvent() {
  return {
    id: SOURCE_ID,
    slug: 'evento-originale',
    title: { it: 'Evento originale', en: 'Original event' },
    startsAt: new Date('2026-09-01T09:00:00.000Z'),
    endsAt: new Date('2026-09-01T10:00:00.000Z'),
    // La proiezione della data lavora sull'orologio dell'evento: senza un fuso
    // esplicito il risultato dipenderebbe da quello della macchina.
    timezone: 'Europe/Rome',
    recurrenceRule: null,
    moderatorToken: 'token-di-origine',
    jitsiRoomName: 'stanza-origine',
    status: 'PUBLISHED',
    // Le relazioni arrivano dall'include della rotta: il costruttore le legge
    // e se mancano fallisce, invece di perderle in silenzio. Qui una sorgente
    // "spoglia" verifica proprio quel caso.
    tagLinks: [{ tagId: 'tag-1' }],
    organizers: [],
    additionalMods: [{ name: 'cifrato', email: null, role: 'MODERATOR' }],
    agendaItems: [],
    reminders: [],
    questionnaires: [],
  };
}

function request(body: unknown = {}): NextRequest {
  // L'id che conta è quello nei params (la rotta legge quello, non l'URL):
  // qui l'URL serve solo perché Request ne pretende uno valido.
  return new Request(`http://localhost/api/admin/events/${SOURCE_ID}/duplicate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    // Stesso cast del test di rotta della chat: qui serve solo il boundary HTTP,
    // non le estensioni di NextRequest.
  }) as unknown as NextRequest;
}

const context = { params: Promise.resolve({ id: SOURCE_ID }) };

describe('POST /api/admin/events/[id]/duplicate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // `resolveSchedule` legge l'ora corrente: senza congelarla, i casi sulla
    // proiezione cambierebbero esito col passare del tempo.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T08:00:00.000Z'));
    mocked.event.findUnique.mockResolvedValue(sourceEvent());
    mocked.eventReminder.findMany.mockResolvedValue([]);
    mocked.event.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: '6f1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d',
      slug: data.slug,
      moderatorToken: data.moderatorToken,
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rifiuta un corpo malformato invece di programmare la copia a caso', async () => {
    // `{ startsAt: 1 }` finiva in `new Date(1)`: una copia datata 1970 creata
    // con 201. E `nextOccurrence: 'false'` è una stringa vera, quindi
    // riprogrammava la copia pur dicendo il contrario.
    for (const corpo of [
      { startsAt: 1 },
      { startsAt: 'domani' },
      { nextOccurrence: 'false' },
      { chiaveSconosciuta: true },
      // Una fine da sola veniva accettata e poi ignorata: 201 con le date
      // dell'originale, cioe' una copia programmata dove nessuno ha chiesto.
      { endsAt: '2026-09-01T12:00:00Z' },
      // Fine prima dell'inizio: veniva assorbita ricalcolando la durata.
      { startsAt: '2026-09-01T12:00:00Z', endsAt: '2026-09-01T10:00:00Z' },
    ]) {
      // 422 come le altre rotte del progetto quando il corpo non passa lo schema.
      const res = await POST(request(corpo), context as never);
      expect(res.status, JSON.stringify(corpo)).toBe(422);
      expect(mocked.event.create).not.toHaveBeenCalled();
    }
  });

  it('riprogramma sulle date indicate, anche in ISO senza fuso', async () => {
    const res = await POST(
      request({ startsAt: '2026-09-01T10:00:00', endsAt: '2026-09-01T12:00:00' }),
      context as never,
    );
    expect(res.status).toBe(201);
    const data = mocked.event.create.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(data.startsAt).toEqual(new Date('2026-09-01T10:00:00'));
    expect(data.endsAt).toEqual(new Date('2026-09-01T12:00:00'));
  });

  it('senza fine indicata conserva la durata dell’originale', async () => {
    const res = await POST(request({ startsAt: '2026-09-01T10:00:00Z' }), context as never);
    expect(res.status).toBe(201);
    const data = mocked.event.create.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    const source = sourceEvent();
    const durata = source.endsAt.getTime() - source.startsAt.getTime();
    expect((data.endsAt as Date).getTime() - (data.startsAt as Date).getTime()).toBe(durata);
  });

  it('un corpo assente o vuoto mantiene le date dell’originale', async () => {
    const res = await POST(request(), context as never);
    expect(res.status).toBe(201);
    const data = mocked.event.create.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(data.startsAt).toEqual(sourceEvent().startsAt);
    expect(data.endsAt).toEqual(sourceEvent().endsAt);
  });

  it('restituisce il moderatorToken: senza, la pagina di modifica risponde 404', async () => {
    const res = await POST(request(), context as never);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; slug: string; moderatorToken?: string };
    expect(body.id).toBe('6f1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d');
    expect(typeof body.moderatorToken).toBe('string');
    expect(body.moderatorToken).toBeTruthy();
  });

  it('la copia NON eredita il token dell’originale: è una credenziale, non configurazione', async () => {
    const res = await POST(request(), context as never);
    const body = (await res.json()) as { moderatorToken?: string };
    expect(body.moderatorToken).not.toBe('token-di-origine');
    const created = mocked.event.create.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(created.moderatorToken).not.toBe('token-di-origine');
  });

  it('copia le relazioni di configurazione, con credenziali NUOVE per i co-moderatori', async () => {
    await POST(request(), context as never);
    const created = mocked.event.create.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(created.tagLinks).toEqual({ create: [{ tagId: 'tag-1' }] });
    const mods = (created.additionalMods as { create: { token: string }[] }).create;
    expect(mods).toHaveLength(1);
    expect(mods[0]?.token).toBeTruthy();
    expect(mods[0]?.token).not.toBe('token-di-origine');
  });

  it('la copia nasce in BOZZA: un clone non deve andare pubblico da solo', async () => {
    await POST(request(), context as never);
    const created = mocked.event.create.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(created.status).toBe('DRAFT');
  });

  // ── Proiezione della data sulla prossima occorrenza ──────────────────────

  /** Sorgente FUTURA con cadenza settimanale: il caso normale della rotta. */
  function sorgenteRicorrente(rule: string, startsAt = '2026-10-21T09:00:00.000Z') {
    const inizio = new Date(startsAt);
    return {
      ...sourceEvent(),
      startsAt: inizio,
      endsAt: new Date(inizio.getTime() + 60 * 60 * 1000),
      recurrenceRule: rule,
    };
  }

  function dateScritte(): { startsAt: Date; endsAt: Date } {
    const data = mocked.event.create.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    return { startsAt: data.startsAt as Date, endsAt: data.endsAt as Date };
  }

  it('su una sorgente futura proietta OLTRE la sorgente, non su di essa', async () => {
    // È il difetto: l'ancora era l'ora corrente, e la prima occorrenza
    // successiva a "adesso" di un evento futuro è l'evento stesso. La copia
    // nasceva con le stesse date dell'originale, con un 201 e nessun segnale.
    // Qui si verifica anche il fuso: le 11:00 di Roma restano le 11:00 dopo
    // il cambio d'ora del 25 ottobre, cioè le 10:00 UTC.
    mocked.event.findUnique.mockResolvedValue(sorgenteRicorrente('FREQ=WEEKLY;BYDAY=WE'));

    const res = await POST(request({ nextOccurrence: true }), context as never);

    expect(res.status).toBe(201);
    const { startsAt } = dateScritte();
    expect(startsAt).not.toEqual(new Date('2026-10-21T09:00:00.000Z'));
    expect(startsAt.toISOString()).toBe('2026-10-28T10:00:00.000Z');
  });

  it("conserva la durata anche attraversando il cambio d'ora", async () => {
    mocked.event.findUnique.mockResolvedValue(sorgenteRicorrente('FREQ=WEEKLY;BYDAY=WE'));

    await POST(request({ nextOccurrence: true }), context as never);

    const { startsAt, endsAt } = dateScritte();
    expect(endsAt.getTime() - startsAt.getTime()).toBe(60 * 60 * 1000);
  });

  it('dichiara nella risposta che la data è stata proiettata', async () => {
    mocked.event.findUnique.mockResolvedValue(sorgenteRicorrente('FREQ=WEEKLY;BYDAY=WE'));

    const res = await POST(request({ nextOccurrence: true }), context as never);

    const body = (await res.json()) as {
      startsAt?: string;
      endsAt?: string;
      scheduleProjected?: boolean;
    };
    expect(body.scheduleProjected).toBe(true);
    expect(body.startsAt).toBe('2026-10-28T10:00:00.000Z');
    expect(body.endsAt).toBe('2026-10-28T11:00:00.000Z');
  });

  it('con una regola esaurita ripiega sulle date della sorgente, e lo dice', async () => {
    // Prima, una regola esaurita e una proiezione riuscita erano
    // indistinguibili: stesso 201, stesse date della sorgente.
    mocked.event.findUnique.mockResolvedValue(sorgenteRicorrente('FREQ=WEEKLY;COUNT=1'));

    const res = await POST(request({ nextOccurrence: true }), context as never);

    const body = (await res.json()) as { scheduleProjected?: boolean };
    expect(body.scheduleProjected).toBe(false);
    expect(dateScritte().startsAt).toEqual(new Date('2026-10-21T09:00:00.000Z'));
  });

  it('senza cadenza tiene le date della sorgente senza inventarne una', async () => {
    const res = await POST(request({ nextOccurrence: true }), context as never);

    const body = (await res.json()) as { scheduleProjected?: boolean };
    expect(body.scheduleProjected).toBe(false);
    expect(dateScritte().startsAt).toEqual(sourceEvent().startsAt);
  });

  it('su una serie che va avanti da mesi proietta comunque nel futuro', async () => {
    // L'estremo opposto: qui l'occorrenza subito dopo la sorgente è passata,
    // ed è il motivo per cui l'ancora è il massimo fra sorgente e adesso.
    mocked.event.findUnique.mockResolvedValue(
      sorgenteRicorrente('FREQ=DAILY', '2026-08-05T09:00:00.000Z'),
    );

    await POST(request({ nextOccurrence: true }), context as never);

    expect(dateScritte().startsAt.getTime()).toBeGreaterThan(Date.now());
  });
});
