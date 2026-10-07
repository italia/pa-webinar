// @vitest-environment node
import type { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * La presentazione di un PDF nella sala: chi la legge, chi la comanda, cosa
 * annuncia e cosa scrive nella cronologia.
 *
 * Leggere: chi sta nella stanza (regola dei pannelli). Comandare: il link
 * principale e le concessioni nominali, moderatori e relatori, con un PDF
 * dell'evento. Ogni cambio fa crescere la versione, va
 * sul canale della sala come puntatore e finisce nella cronologia; un cambio
 * di pagina su un documento che nel frattempo è cambiato non vale.
 *
 * Le autorizzazioni girano davvero; database, canale e cronologia sono finti.
 */
vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findFirst: vi.fn() },
    eventMaterial: { findFirst: vi.fn() },
    eventPresentation: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    eventModerator: { findUnique: vi.fn() },
    registration: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/live-state/publish', () => ({ publishPresentation: vi.fn() }));
vi.mock('@/lib/live/actions', () => ({ recordLiveAction: vi.fn(async () => undefined) }));
vi.mock('@/lib/cache', () => ({
  getCached: vi.fn(() => null),
  setCache: vi.fn(),
  deleteCache: vi.fn(),
}));
vi.mock('@/lib/crypto/pii', () => ({ tryDecryptPII: (v: string | null) => v }));
vi.mock('@/lib/events/join-grant', () => ({ hasJoinGrant: vi.fn(async () => false) }));
vi.mock('@/lib/event-session', () => ({ readOwnedEventAccessToken: vi.fn(async () => null) }));
const { siteSettings } = vi.hoisted(() => ({ siteSettings: { guestAccessEnabled: true } }));
vi.mock('@/lib/settings', () => ({ getSettings: async () => siteSettings }));
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof RateLimitModule>()),
  rateLimit: () => ({ allowed: true, remaining: 1, resetAt: Date.now() + 60_000 }),
}));

import { prisma } from '@/lib/db';
import { recordLiveAction } from '@/lib/live/actions';
import { publishPresentation } from '@/lib/live-state/publish';
import type * as RateLimitModule from '@/lib/rate-limit';

import { DELETE, GET, PATCH, POST } from './route';

const mockedEvent = prisma.event.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockedMaterial = prisma.eventMaterial.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockedRow = prisma.eventPresentation.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedUpsert = prisma.eventPresentation.upsert as unknown as ReturnType<typeof vi.fn>;
const mockedUpdate = prisma.eventPresentation.update as unknown as ReturnType<typeof vi.fn>;
const mockedGrant = prisma.eventModerator.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedRegistration = prisma.registration.findUnique as unknown as ReturnType<typeof vi.fn>;
const publish = publishPresentation as unknown as ReturnType<typeof vi.fn>;
const journal = recordLiveAction as unknown as ReturnType<typeof vi.fn>;

const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const MATERIAL_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_ID = '66666666-6666-4666-8666-666666666666';
const SLUG = 'evento-di-prova';
const PRIMARY_TOKEN = 'PRIMARY_MOD_TOKEN';
const KEY = 'assets/document/2026/10/77777777-7777-4777-8777-777777777777-slide.pdf';
const ORIGIN = 'https://webinar.example.gov.it';

const ctx = () => ({ params: Promise.resolve({ param: SLUG }) });

function req(method: string, opts: { token?: string | null; body?: unknown; query?: string } = {}): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' });
  const token = opts.token === undefined ? PRIMARY_TOKEN : opts.token;
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request(`${ORIGIN}/api/events/${SLUG}/presentation${opts.query ?? ''}`, {
    method,
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  }) as unknown as NextRequest;
}

function evento(over: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    slug: SLUG,
    status: 'LIVE',
    eventType: 'SCHEDULED',
    moderatorToken: PRIMARY_TOKEN,
    joinPasswordHash: null,
    startsAt: new Date('2026-10-08T09:00:00.000Z'),
    endsAt: new Date('2026-10-08T11:00:00.000Z'),
    moderatorName: 'Conduzione',
    ...over,
  };
}

function pdf(over: Record<string, unknown> = {}) {
  return {
    id: MATERIAL_ID,
    title: 'Slide della sessione',
    type: 'FILE',
    mimeType: 'application/pdf',
    fileName: 'slide.pdf',
    url: `${ORIGIN}/api/${KEY}`,
    blobPath: KEY,
    ...over,
  };
}

function riga(over: Record<string, unknown> = {}) {
  return {
    materialId: MATERIAL_ID,
    page: 3,
    pageCount: 12,
    presenterRole: 'MODERATOR',
    startedAt: new Date('2026-10-08T09:10:00.000Z'),
    version: 7,
    material: { title: 'Slide della sessione' },
    presenter: null,
    ...over,
  };
}

/** Una concessione nominale di questo evento. */
function concessione(role: 'MODERATOR' | 'SPEAKER', over: Record<string, unknown> = {}) {
  return {
    id: `grant-${role.toLowerCase()}`,
    eventId: EVENT_ID,
    revokedAt: null,
    role,
    name: role === 'SPEAKER' ? 'Relatrice di prova' : 'Comoderatore di prova',
    email: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  siteSettings.guestAccessEnabled = true;
  mockedEvent.mockResolvedValue(evento());
  mockedMaterial.mockResolvedValue(pdf());
  mockedRow.mockResolvedValue(riga());
  mockedGrant.mockResolvedValue(null);
  mockedRegistration.mockResolvedValue(null);
  mockedUpsert.mockImplementation(async ({ update }: { update: Record<string, unknown> }) =>
    riga({ ...update, page: update.page, version: 8 }),
  );
  mockedUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
    riga({ ...data, version: 8 }),
  );
});

describe('GET /api/events/[slug]/presentation', () => {
  it('chi sta nella stanza legge lo stato completo, con il file dietro la rotta della presentazione', async () => {
    const res = await GET(req('GET', { token: null }), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const body = await res.json();
    expect(body).toEqual({
      version: 7,
      presentation: {
        materialId: MATERIAL_ID,
        page: 3,
        pageCount: 12,
        title: 'Slide della sessione',
        // Link principale: il nome del conduttore scritto sull'evento.
        presenterName: 'Conduzione',
        presenterRole: 'MODERATOR',
        startedAt: '2026-10-08T09:10:00.000Z',
        fileUrl: `/api/events/${SLUG}/presentation/file?m=${MATERIAL_ID}`,
      },
    });
    // Mai l'indirizzo pubblico del file.
    expect(JSON.stringify(body)).not.toContain('/api/assets');
  });

  it('nessuno presenta: presentation null, con la versione', async () => {
    mockedRow.mockResolvedValue(riga({ materialId: null, material: null, version: 9 }));
    const res = await GET(req('GET', { token: null }), ctx());
    expect(await res.json()).toEqual({ version: 9, presentation: null });
  });

  it('mai presentato nulla: versione zero', async () => {
    mockedRow.mockResolvedValue(null);
    const res = await GET(req('GET', { token: null }), ctx());
    expect(await res.json()).toEqual({ version: 0, presentation: null });
  });

  it('un relatore che presenta: il nome della sua concessione', async () => {
    mockedRow.mockResolvedValue(riga({ presenterRole: 'SPEAKER', presenter: { name: 'Relatrice di prova' } }));
    const res = await GET(req('GET', { token: null }), ctx());
    const body = await res.json();
    expect(body.presentation).toMatchObject({ presenterName: 'Relatrice di prova', presenterRole: 'SPEAKER' });
  });

  it('ospite con la stanza non aperta a chi arriva col link: 401', async () => {
    mockedEvent.mockResolvedValue(evento({ status: 'PUBLISHED' }));
    const res = await GET(req('GET', { token: null }), ctx());
    expect(res.status).toBe(401);
    expect(mockedRow).not.toHaveBeenCalled();
  });

  it('evento protetto da password, ospite senza la password: 401', async () => {
    mockedEvent.mockResolvedValue(evento({ joinPasswordHash: 'hash' }));
    const res = await GET(req('GET', { token: null }), ctx());
    expect(res.status).toBe(401);
  });

  it('un token che non è di questo evento: 403', async () => {
    const res = await GET(req('GET', { token: 'TOKEN_SCONOSCIUTO' }), ctx());
    expect(res.status).toBe(403);
  });

  it('un iscritto legge anche prima della diretta', async () => {
    mockedEvent.mockResolvedValue(evento({ status: 'PUBLISHED' }));
    mockedRegistration.mockResolvedValue({ id: 'reg-1', eventId: EVENT_ID });
    const res = await GET(req('GET', { token: 'TOKEN_ISCRITTO' }), ctx());
    expect(res.status).toBe(200);
  });

  it('evento inesistente: 404', async () => {
    mockedEvent.mockResolvedValue(null);
    const res = await GET(req('GET', { token: null }), ctx());
    expect(res.status).toBe(404);
  });

  it('evento concluso: la presentazione rimasta aperta non si mostra più', async () => {
    mockedEvent.mockResolvedValue(evento({ status: 'ENDED' }));
    mockedRegistration.mockResolvedValue({ id: 'reg-1', eventId: EVENT_ID });
    const res = await GET(req('GET', { token: 'TOKEN_ISCRITTO' }), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: 7, presentation: null });
  });
});

describe('POST /api/events/[slug]/presentation — presenta', () => {
  it('chi modera presenta un PDF: versione nuova, puntatore sul canale, cronologia', async () => {
    const res = await POST(req('POST', { body: { materialId: MATERIAL_ID } }), ctx());
    expect(res.status).toBe(200);
    // Chi modera sceglie fra tutti i materiali dell'evento.
    expect(mockedMaterial.mock.calls[0]![0].where).toEqual({ eventId: EVENT_ID, id: MATERIAL_ID });
    const upsert = mockedUpsert.mock.calls[0]![0];
    expect(upsert.where).toEqual({ eventId: EVENT_ID });
    expect(upsert.create).toMatchObject({
      eventId: EVENT_ID,
      materialId: MATERIAL_ID,
      page: 1,
      pageCount: null,
      presenterRole: 'MODERATOR',
      presenterGrantId: null,
      version: 1,
    });
    expect(upsert.update).toMatchObject({ materialId: MATERIAL_ID, page: 1, version: { increment: 1 } });
    expect(publish).toHaveBeenCalledWith(EVENT_ID, { materialId: MATERIAL_ID, page: 1, version: 8 });
    expect(journal).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      kind: 'presentation.started',
      actor: 'moderator',
      data: { materialId: MATERIAL_ID, title: 'Slide della sessione', page: 1 },
    });
    expect((await res.json()).presentation).toMatchObject({ materialId: MATERIAL_ID, page: 1 });
  });

  it('un relatore presenta un PDF dell’evento, anche fuori dalla fase che vede il pubblico', async () => {
    // Una prova prima dell'inizio: il pubblico vede solo i materiali «prima»,
    // ma il relatore deve poter presentare il PDF che ha appena caricato.
    mockedEvent.mockResolvedValue(evento({ status: 'PROVISIONING', startsAt: new Date(Date.now() + 3600_000) }));
    mockedGrant.mockResolvedValue(concessione('SPEAKER'));
    const res = await POST(req('POST', { token: 'TOKEN_RELATORE', body: { materialId: MATERIAL_ID } }), ctx());
    expect(res.status).toBe(200);
    expect(mockedMaterial.mock.calls[0]![0].where).toEqual({ eventId: EVENT_ID, id: MATERIAL_ID });
    expect(mockedUpsert.mock.calls[0]![0].create).toMatchObject({
      presenterRole: 'SPEAKER',
      presenterGrantId: 'grant-speaker',
    });
    expect(journal.mock.calls[0]![0]).toMatchObject({ kind: 'presentation.started', actor: 'speaker' });
  });

  it('un co-moderatore presenta con la sua concessione', async () => {
    mockedGrant.mockResolvedValue(concessione('MODERATOR'));
    const res = await POST(req('POST', { token: 'TOKEN_COMOD', body: { materialId: MATERIAL_ID } }), ctx());
    expect(res.status).toBe(200);
    expect(mockedUpsert.mock.calls[0]![0].create).toMatchObject({ presenterGrantId: 'grant-moderator' });
  });

  it('un iscritto non presenta: 403', async () => {
    mockedRegistration.mockResolvedValue({ id: 'reg-1', eventId: EVENT_ID });
    const res = await POST(req('POST', { token: 'TOKEN_ISCRITTO', body: { materialId: MATERIAL_ID } }), ctx());
    expect(res.status).toBe(403);
    expect(mockedUpsert).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('una concessione revocata: 403', async () => {
    mockedGrant.mockResolvedValue(concessione('SPEAKER', { revokedAt: new Date() }));
    const res = await POST(req('POST', { token: 'TOKEN_RELATORE', body: { materialId: MATERIAL_ID } }), ctx());
    expect(res.status).toBe(403);
  });

  it('senza token: 401', async () => {
    const res = await POST(req('POST', { token: null, body: { materialId: MATERIAL_ID } }), ctx());
    expect(res.status).toBe(401);
  });

  it('un link non si presenta: 422', async () => {
    mockedMaterial.mockResolvedValue(pdf({ type: 'LINK', blobPath: null, mimeType: null, fileName: null }));
    const res = await POST(req('POST', { body: { materialId: MATERIAL_ID } }), ctx());
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('NOT_PRESENTABLE');
    expect(mockedUpsert).not.toHaveBeenCalled();
  });

  it('un documento che non è un PDF: 422', async () => {
    mockedMaterial.mockResolvedValue(
      pdf({
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        fileName: 'testo.docx',
      }),
    );
    const res = await POST(req('POST', { body: { materialId: MATERIAL_ID } }), ctx());
    expect(res.status).toBe(422);
  });

  it('un PDF il cui file non è un materiale dell’evento: 422', async () => {
    mockedMaterial.mockResolvedValue(
      pdf({ blobPath: 'assets/image/2026/10/77777777-7777-4777-8777-777777777777-logo.png' }),
    );
    const res = await POST(req('POST', { body: { materialId: MATERIAL_ID } }), ctx());
    expect(res.status).toBe(422);
  });

  it('un materiale di un altro evento, o che non c’è più: 404', async () => {
    mockedMaterial.mockResolvedValue(null);
    const res = await POST(req('POST', { body: { materialId: MATERIAL_ID } }), ctx());
    expect(res.status).toBe(404);
  });

  it('evento concluso o archiviato: 409', async () => {
    for (const status of ['ENDED', 'ARCHIVED']) {
      mockedEvent.mockResolvedValue(evento({ status }));
      const res = await POST(req('POST', { body: { materialId: MATERIAL_ID } }), ctx());
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('EVENT_CLOSED');
    }
    expect(mockedUpsert).not.toHaveBeenCalled();
  });

  it('un id che non è un UUID: 422', async () => {
    const res = await POST(req('POST', { body: { materialId: 'nope' } }), ctx());
    expect(res.status).toBe(422);
  });
});

describe('PATCH /api/events/[slug]/presentation — gira pagina', () => {
  it('va alla pagina: versione nuova, puntatore sul canale, pagina in cronologia', async () => {
    const res = await PATCH(req('PATCH', { body: { materialId: MATERIAL_ID, page: 4, pageCount: 12 } }), ctx());
    expect(res.status).toBe(200);
    const update = mockedUpdate.mock.calls[0]![0];
    // Il materiale fa parte della condizione.
    expect(update.where).toEqual({ eventId: EVENT_ID, materialId: MATERIAL_ID });
    expect(update.data).toEqual({ page: 4, pageCount: 12, version: { increment: 1 } });
    expect(publish).toHaveBeenCalledWith(EVENT_ID, { materialId: MATERIAL_ID, page: 4, version: 8 });
    expect(journal).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      kind: 'presentation.page',
      actor: 'moderator',
      data: { materialId: MATERIAL_ID, title: 'Slide della sessione', page: 4, pageCount: 12 },
    });
  });

  it('un relatore gira pagina', async () => {
    mockedGrant.mockResolvedValue(concessione('SPEAKER'));
    const res = await PATCH(
      req('PATCH', { token: 'TOKEN_RELATORE', body: { materialId: MATERIAL_ID, page: 5 } }),
      ctx(),
    );
    expect(res.status).toBe(200);
    expect(journal.mock.calls[0]![0]).toMatchObject({ actor: 'speaker' });
  });

  it('un altro documento è stato presentato nel frattempo: 409, niente scritto', async () => {
    const res = await PATCH(req('PATCH', { body: { materialId: OTHER_ID, page: 4 } }), ctx());
    expect(res.status).toBe(409);
    expect(mockedUpdate).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('presentazione chiusa nel frattempo: 409', async () => {
    mockedRow.mockResolvedValue(riga({ materialId: null, material: null }));
    const res = await PATCH(req('PATCH', { body: { materialId: MATERIAL_ID, page: 4 } }), ctx());
    expect(res.status).toBe(409);
  });

  it('la stessa pagina: nessuna versione nuova, nessun annuncio', async () => {
    const res = await PATCH(req('PATCH', { body: { materialId: MATERIAL_ID, page: 3, pageCount: 12 } }), ctx());
    expect(res.status).toBe(200);
    expect(mockedUpdate).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(journal).not.toHaveBeenCalled();
  });

  it('oltre l’ultima pagina: resta sull’ultima', async () => {
    const res = await PATCH(req('PATCH', { body: { materialId: MATERIAL_ID, page: 99 } }), ctx());
    expect(res.status).toBe(200);
    expect(mockedUpdate.mock.calls[0]![0].data).toMatchObject({ page: 12 });
  });

  it('solo il numero di pagine nuovo: si salva, ma la cronologia non registra una pagina', async () => {
    mockedRow.mockResolvedValue(riga({ pageCount: null }));
    const res = await PATCH(req('PATCH', { body: { materialId: MATERIAL_ID, page: 3, pageCount: 12 } }), ctx());
    expect(res.status).toBe(200);
    expect(mockedUpdate.mock.calls[0]![0].data).toEqual({ page: 3, pageCount: 12, version: { increment: 1 } });
    expect(journal).not.toHaveBeenCalled();
  });

  it('la presentazione cambia fra la lettura e la scrittura: 409', async () => {
    mockedUpdate.mockRejectedValue(Object.assign(new Error('not found'), { code: 'P2025' }));
    const res = await PATCH(req('PATCH', { body: { materialId: MATERIAL_ID, page: 4 } }), ctx());
    expect(res.status).toBe(409);
    expect(publish).not.toHaveBeenCalled();
  });

  it('un iscritto non gira pagina: 403', async () => {
    mockedRegistration.mockResolvedValue({ id: 'reg-1', eventId: EVENT_ID });
    const res = await PATCH(
      req('PATCH', { token: 'TOKEN_ISCRITTO', body: { materialId: MATERIAL_ID, page: 4 } }),
      ctx(),
    );
    expect(res.status).toBe(403);
  });

  it('una pagina non valida: 422', async () => {
    const res = await PATCH(req('PATCH', { body: { materialId: MATERIAL_ID, page: 0 } }), ctx());
    expect(res.status).toBe(422);
  });
});

describe('DELETE /api/events/[slug]/presentation — chiude', () => {
  it('chiude: versione nuova, puntatore vuoto, cronologia con il documento chiuso', async () => {
    const res = await DELETE(req('DELETE', { query: `?materialId=${MATERIAL_ID}` }), ctx());
    expect(res.status).toBe(200);
    const update = mockedUpdate.mock.calls[0]![0];
    expect(update.where).toEqual({ eventId: EVENT_ID, materialId: MATERIAL_ID });
    expect(update.data).toMatchObject({ materialId: null, presenterGrantId: null, version: { increment: 1 } });
    expect(publish).toHaveBeenCalledWith(EVENT_ID, { materialId: null, page: 1, version: 8 });
    expect(journal).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      kind: 'presentation.stopped',
      actor: 'moderator',
      data: { materialId: MATERIAL_ID, title: 'Slide della sessione' },
    });
    expect(await res.json()).toEqual({ version: 8, presentation: null });
  });

  it('già chiusa: 200, nulla da scrivere', async () => {
    mockedRow.mockResolvedValue(riga({ materialId: null, material: null, version: 5 }));
    const res = await DELETE(req('DELETE'), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: 5, presentation: null });
    expect(mockedUpdate).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('chi chiude la presentazione che vedeva non chiude quella di un altro: 409', async () => {
    const res = await DELETE(req('DELETE', { query: `?materialId=${OTHER_ID}` }), ctx());
    expect(res.status).toBe(409);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('anche a evento concluso si può chiudere', async () => {
    mockedEvent.mockResolvedValue(evento({ status: 'ENDED' }));
    const res = await DELETE(req('DELETE'), ctx());
    expect(res.status).toBe(200);
    expect(mockedUpdate).toHaveBeenCalled();
  });

  it('anche chiudere si può solo con un link di chi conduce o di un relatore', async () => {
    const res = await DELETE(req('DELETE', { token: 'TOKEN_SCONOSCIUTO' }), ctx());
    expect(res.status).toBe(403);
  });
});
