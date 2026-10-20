// @vitest-environment node
/**
 * Il giro intero, con un motore di prova al posto di quello vero: il server
 * chiede la traduzione dopo il salvataggio, il worker consegna attraverso la
 * rotta interna, e il wizard salva mentre la traduzione e' in corso. Le rotte
 * e le librerie sono quelle vere; la banca dati e' in memoria.
 */
import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Riga = Record<string, unknown>;

const db = vi.hoisted(() => ({
  eventi: new Map<string, Record<string, unknown>>(),
  lavori: [] as Array<Record<string, unknown>>,
  impostazioni: {} as Record<string, unknown>,
}));

vi.mock('@/lib/db', () => {
  const scegli = (riga: Riga | undefined, select?: Record<string, boolean>) => {
    if (!riga) return null;
    if (!select) return { ...riga };
    return Object.fromEntries(Object.keys(select).map((k) => [k, riga[k] ?? null]));
  };
  const corrisponde = (lavoro: Riga, where: Riga) =>
    Object.entries(where).every(([k, v]) =>
      v && typeof v === 'object' && 'in' in (v as Riga)
        ? ((v as { in: unknown[] }).in as unknown[]).includes(lavoro[k])
        : lavoro[k] === v
    );
  const prisma = {
    $executeRaw: async () => 0,
    $queryRaw: async () => [],
    $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
    event: {
      findUnique: async ({
        where,
        select,
      }: {
        where: { id: string };
        select?: Record<string, boolean>;
      }) => scegli(db.eventi.get(where.id), select),
      update: async ({ where, data }: { where: { id: string }; data: Riga }) => {
        const riga = { ...db.eventi.get(where.id)!, ...data };
        db.eventi.set(where.id, riga);
        return { ...riga };
      },
    },
    siteSetting: {
      findUnique: async ({ select }: { select?: Record<string, boolean> }) =>
        scegli(db.impostazioni, select),
    },
    postprodJob: {
      findFirst: async ({
        where,
        select,
      }: {
        where: Riga;
        select?: Record<string, boolean>;
      }) => {
        const trovati = db.lavori
          .filter((l) => corrisponde(l, where))
          .sort(
            (a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime()
          );
        return scegli(trovati[0], select);
      },
      findUnique: async ({
        where,
        select,
      }: {
        where: { id: string };
        select?: Record<string, boolean>;
      }) =>
        scegli(
          db.lavori.find((l) => l.id === where.id),
          select
        ),
      create: async ({ data }: { data: Riga }) => {
        const lavoro = {
          id: `00000000-0000-4000-8000-${String(db.lavori.length + 1).padStart(12, '0')}`,
          attempts: 1,
          startedAt: null,
          lastError: null,
          completedAt: null,
          createdAt: new Date(Date.now() + db.lavori.length),
          ...data,
        };
        db.lavori.push(lavoro);
        return { id: lavoro.id };
      },
    },
  };
  return { prisma };
});
vi.mock('@/lib/report/job', () => ({
  // Chiude il lavoro del claim corrente, come l'UPDATE vero.
  consegnaLavoroEvento: async (jobId: string) => {
    const lavoro = db.lavori.find((l) => l.id === jobId);
    if (!lavoro || !['PENDING', 'CLAIMED', 'RUNNING'].includes(lavoro.status as string))
      return null;
    lavoro.status = 'DONE';
    return lavoro.payload;
  },
  statoLavoroEvento: async () => ({ status: 'DONE', superseded: false }),
}));
vi.mock('@/lib/auth/cron', () => ({ assertCronApiKey: () => {} }));
vi.mock('@/lib/audit/admin-audit', () => ({ logAdminAction: async () => undefined }));
vi.mock('@/lib/settings', () => ({ getSettings: async () => ({ defaultLocale: 'it' }) }));
vi.mock('@/lib/auth/moderator', () => ({
  extractModeratorToken: () => 'token',
  verifyModeratorToken: async (id: string) => ({ ...db.eventi.get(id)! }),
  isEventModerator: async () => true,
  constantTimeEqual: () => true,
}));
vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('@/lib/auth/staff-session', () => ({
  requireEventManager: async () => ({ role: 'admin' }),
  isEventManager: async () => true,
}));
vi.mock('@/lib/live-state/publish', () => ({
  publishEventStatus: async () => undefined,
  publishFlagsIfChanged: async () => undefined,
}));
vi.mock('@/lib/live/actions', () => ({
  recordLiveAction: async () => {},
  recordLiveActions: async () => {},
}));
vi.mock('@/lib/email/moderator-link', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  sendPrimaryModeratorLink: async () => true,
  sendGrantModeratorLinks: async () => 0,
}));

import { POST as consegna } from '@/app/api/internal/event-text-translation/route';
import { PUT } from '@/app/api/events/[param]/route';

import { riconciliaTraduzioni } from './auto';
import { improntaSorgente, testoSorgente } from './source';

const ID = '7c6d5e4f-3a2b-4c1d-8e9f-0a1b2c3d4e5f';
const ambiente = { ...process.env };

/** Il motore di prova: una traduzione riconoscibile, senza GPU ne' rete. */
const motore = (testo: string, lingua: string) => `[${lingua}] ${testo}`;

/** Il worker: prende il lavoro aperto e consegna con il motore di prova. */
async function lavoraEConsegna() {
  const lavoro = db.lavori.find((l) => l.status === 'PENDING')!;
  lavoro.status = 'RUNNING';
  const p = lavoro.payload as {
    targetLanguages: string[];
    title: string;
    description: string;
  };
  const title = Object.fromEntries(p.targetLanguages.map((l) => [l, motore(p.title, l)]));
  const description = Object.fromEntries(
    p.targetLanguages.map((l) => [l, motore(p.description, l)])
  );
  const res = await consegna(
    new Request('http://x/api/internal/event-text-translation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jobId: lavoro.id,
        attempt: 1,
        title,
        description,
        modelId: 'prova',
      }),
    }) as never,
    { params: Promise.resolve({}) } as never
  );
  return (await res.json()) as Record<string, unknown>;
}

/** Il wizard salva: il modulo come l'aveva caricato, con le lingue toccate. */
async function salva(corpo: Record<string, unknown>) {
  const res = await PUT(
    new Request(`http://x/api/events/${ID}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: 'Bearer token' },
      body: JSON.stringify(corpo),
    }) as unknown as NextRequest,
    { params: Promise.resolve({ param: ID }) } as never
  );
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

const evento = () =>
  db.eventi.get(ID)! as {
    title: Record<string, string>;
    description: Record<string, string>;
    textLocaleState: Record<string, { origin: string; sourceHash: string }>;
  };

beforeEach(() => {
  process.env.AI_MT_BASE_URL = 'http://mt:8080/v1';
  db.lavori.length = 0;
  db.impostazioni = {
    aiPipelineEnabled: true,
    defaultLocale: 'it',
    availableLocales: ['it', 'en', 'de'],
    aiDefaultTargetLocales: 'en',
  };
  const titoli = { it: 'Ciclo | Titolo', de: 'Zyklus | Titel' };
  const descrizioni = { it: 'Descrizione', de: 'Beschreibung' };
  db.eventi.set(ID, {
    id: ID,
    slug: 'evento',
    status: 'DRAFT',
    eventType: 'SCHEDULED',
    moderatorToken: 'token',
    title: titoli,
    description: descrizioni,
    aiTargetLocales: 'en,de',
    textTranslations: null,
    textLocaleState: {
      de: {
        origin: 'HUMAN',
        sourceHash: improntaSorgente(testoSorgente('it', titoli, descrizioni)),
        at: '2026-10-20T09:00:00.000Z',
      },
    },
    startsAt: new Date('2030-01-10T09:00:00.000Z'),
    endsAt: new Date('2030-01-10T11:00:00.000Z'),
    maxParticipants: 100,
    recordingEnabled: false,
    participantsCanUnmute: false,
    participantsCanStartVideo: false,
    participantsCanShareScreen: false,
    expectedSenderRatioPct: null,
    accessMode: null,
    recordingFileSize: null,
  });
});
afterEach(() => {
  process.env = { ...ambiente };
});

describe('traduzione automatica: dal salvataggio alla consegna', () => {
  it('la traduzione arrivata a wizard aperto non si cancella salvando il modulo caricato prima', async () => {
    expect(await riconciliaTraduzioni(ID)).toEqual({ avviata: true, lingue: ['en'] });
    // Il wizard era aperto con l'inglese vuoto; la traduzione arriva.
    expect(await lavoraEConsegna()).toMatchObject({ ok: true, applied: ['en'] });
    expect(evento().title.en).toBe('[en] Ciclo | Titolo');
    expect(evento().textLocaleState.en!.origin).toBe('MACHINE');

    // Il wizard salva il modulo di prima, senza toccare l'inglese.
    const risposta = await salva({
      title: { it: 'Ciclo | Titolo', en: '', de: 'Zyklus | Titel' },
      description: { it: 'Descrizione', en: '', de: 'Beschreibung' },
      aiTargetLocales: 'en,de',
      textEdits: { touched: [] },
    });
    expect(evento().title.en).toBe('[en] Ciclo | Titolo');
    expect(evento().textLocaleState.en!.origin).toBe('MACHINE');
    // Niente da tradurre: lo stesso testo, l'inglese gia' tradotto.
    expect(risposta.traduzione).toEqual({ avviata: false, lingue: [] });
  });

  it('una lingua scritta da una persona mentre si traduce non si sostituisce', async () => {
    await riconciliaTraduzioni(ID);
    await salva({
      title: { it: 'Ciclo | Titolo', en: 'My title', de: 'Zyklus | Titel' },
      description: { it: 'Descrizione', en: 'My text', de: 'Beschreibung' },
      textEdits: { touched: ['en'] },
    });
    expect(await lavoraEConsegna()).toMatchObject({ ok: true, applied: [] });
    expect(evento().title.en).toBe('My title');
    expect(evento().textLocaleState.en!.origin).toBe('HUMAN');
    // Il tedesco, di una persona, non e' mai stato chiesto.
    expect(evento().title.de).toBe('Zyklus | Titel');
  });

  it('il testo principale cambiato mentre si traduce: la consegna non si applica, e si chiede di nuovo', async () => {
    await riconciliaTraduzioni(ID);
    await salva({
      title: { it: 'Un altro titolo', de: 'Zyklus | Titel' },
      description: { it: 'Descrizione', de: 'Beschreibung' },
      textEdits: { touched: [] },
    });
    const esito = await lavoraEConsegna();
    expect(esito).toMatchObject({ ok: true, applied: [], stale: true });
    expect(evento().title.en).toBeUndefined();
    // Il tedesco ora e' da aggiornare: resta di una persona, non si traduce.
    expect(evento().textLocaleState.de!.origin).toBe('HUMAN');
    const nuovo = db.lavori.find((l) => l.status === 'PENDING')!;
    expect(nuovo.payload).toMatchObject({
      title: 'Un altro titolo',
      targetLanguages: ['en'],
    });
    expect(await lavoraEConsegna()).toMatchObject({ applied: ['en'] });
    expect(evento().title.en).toBe('[en] Un altro titolo');
  });

  it('un testo automatico diventato vecchio si ritraduce al salvataggio; una lingua tolta perde il testo', async () => {
    await riconciliaTraduzioni(ID);
    await lavoraEConsegna();
    const risposta = await salva({
      title: { it: 'Titolo nuovo', en: '[en] Ciclo | Titolo', de: 'Zyklus | Titel' },
      description: { it: 'Descrizione', en: '[en] Descrizione', de: 'Beschreibung' },
      aiTargetLocales: 'en',
      textEdits: { touched: [] },
    });
    expect(evento().title).toEqual({ it: 'Titolo nuovo', en: '[en] Ciclo | Titolo' });
    expect(evento().textLocaleState).not.toHaveProperty('de');
    expect(risposta.traduzione).toEqual({ avviata: true, lingue: ['en'] });
    await lavoraEConsegna();
    expect(evento().title.en).toBe('[en] Titolo nuovo');
  });

  it('a motore spento nessun lavoro', async () => {
    delete process.env.AI_MT_BASE_URL;
    const risposta = await salva({
      title: { it: 'Ciclo | Titolo', de: 'Zyklus | Titel' },
      description: { it: 'Descrizione', de: 'Beschreibung' },
      textEdits: { touched: [] },
    });
    expect(risposta.traduzione).toEqual({ avviata: false, lingue: [] });
    expect(db.lavori).toHaveLength(0);
  });
});
