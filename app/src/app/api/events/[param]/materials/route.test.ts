import type { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * L'elenco dei materiali visto dal confine HTTP.
 *
 * La `visibility` di un materiale (prima/durante/dopo l'evento) vale solo se la
 * applica il server: la risposta di questa rotta la legge chiunque abbia lo
 * slug. Il pubblico riceve i materiali della fase in corso; chi ha un token
 * moderatore (primario o co-moderatore) li riceve tutti.
 *
 * L'autorizzazione del moderatore gira davvero. La sessione staff è stubbata
 * per dimostrare che NON conta: un amministratore che apre la sala da iscritto
 * o da ospite deve vedere ciò che vede il pubblico.
 */
const { staffSession, filesStorage, joinGrant } = vi.hoisted(() => ({
  staffSession: { current: null as null | { role: 'admin' | 'organizer'; accountId: string | null } },
  filesStorage: { current: null as null | object },
  joinGrant: { current: false },
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn() },
    eventMaterial: { findMany: vi.fn(), create: vi.fn() },
    eventModerator: { findUnique: vi.fn() },
    registration: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/events/join-grant', () => ({
  hasJoinGrant: vi.fn(async () => joinGrant.current),
}));
vi.mock('@/lib/storage', () => ({
  getFilesStorage: () => filesStorage.current,
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock('@/lib/auth/staff-session', async (importOriginal) => ({
  ...(await importOriginal<typeof StaffSessionModule>()),
  getStaffSession: vi.fn(async () => staffSession.current),
}));

import type * as StaffSessionModule from '@/lib/auth/staff-session';
import { prisma } from '@/lib/db';

import { GET } from './route';

const mockedEvent = prisma.event.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedMaterials = prisma.eventMaterial.findMany as unknown as ReturnType<typeof vi.fn>;
const mockedGrant = prisma.eventModerator.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedRegistration = prisma.registration.findUnique as unknown as ReturnType<typeof vi.fn>;

const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const OWNER_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_ID = '44444444-4444-4444-8444-444444444444';
const SLUG = 'evento-di-prova';
const PRIMARY_TOKEN = 'PRIMARY_MOD_TOKEN';
const HOUR = 60 * 60 * 1000;

function eventRow(over: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id: EVENT_ID,
    moderatorToken: PRIMARY_TOKEN,
    createdById: OWNER_ID,
    status: 'PUBLISHED',
    eventType: 'SCHEDULED',
    startsAt: new Date(now + 2 * HOUR),
    endsAt: new Date(now + 4 * HOUR),
    postEventPublic: true,
    postEventPublicUntil: null,
    joinPasswordHash: null,
    ...over,
  };
}

function materialRow(visibility: string) {
  return {
    id: `mat-${visibility}`,
    eventId: EVENT_ID,
    type: 'LINK',
    title: `Materiale ${visibility}`,
    url: 'https://example.org/doc',
    description: null,
    addedBy: 'Moderatore',
    fileName: null,
    fileSize: null,
    mimeType: null,
    blobPath: null,
    visibility,
    createdAt: new Date('2026-09-22T10:00:00.000Z'),
  };
}

const ctx = () => ({ params: Promise.resolve({ param: SLUG }) });

function get(headers: HeadersInit = {}): NextRequest {
  return new Request(`https://webinar.example.gov.it/api/events/${SLUG}/materials`, {
    headers,
  }) as unknown as NextRequest;
}

/** Il `where` con cui la rotta ha interrogato i materiali. */
function whereInterrogato(): Record<string, unknown> {
  const call = mockedMaterials.mock.calls[0]?.[0] as { where: Record<string, unknown> } | undefined;
  expect(call, 'nessuna interrogazione ai materiali').toBeDefined();
  return call!.where;
}

beforeEach(() => {
  vi.clearAllMocks();
  staffSession.current = null;
  filesStorage.current = null;
  mockedEvent.mockResolvedValue(eventRow());
  mockedMaterials.mockResolvedValue([materialRow('ALWAYS')]);
  mockedGrant.mockResolvedValue(null);
  mockedRegistration.mockResolvedValue(null);
  joinGrant.current = false;
});

describe('GET /api/events/[slug]/materials — il pubblico vede la fase in corso', () => {
  it('prima dell’inizio: sempre visibili + solo prima', async () => {
    const res = await GET(get(), ctx());
    expect(res.status).toBe(200);
    expect(whereInterrogato()).toEqual({
      eventId: EVENT_ID,
      visibility: { in: ['ALWAYS', 'BEFORE'] },
    });
  });

  it('in diretta: sempre visibili + solo durante', async () => {
    mockedEvent.mockResolvedValue(eventRow({ status: 'LIVE' }));
    await GET(get(), ctx());
    expect(whereInterrogato()).toEqual({
      eventId: EVENT_ID,
      visibility: { in: ['ALWAYS', 'DURING'] },
    });
  });

  it('a evento concluso: sempre visibili + solo dopo', async () => {
    mockedEvent.mockResolvedValue(eventRow({ status: 'ENDED' }));
    await GET(get(), ctx());
    expect(whereInterrogato()).toEqual({
      eventId: EVENT_ID,
      visibility: { in: ['ALWAYS', 'AFTER'] },
    });
  });

  it('un token che non è di un moderatore non è un errore: vista del pubblico', async () => {
    // Un iscritto manda il proprio accessToken, un relatore il proprio grant:
    // nessuno dei due vede i materiali delle altre fasi, e nessuno riceve 403.
    mockedGrant.mockResolvedValue({
      eventId: EVENT_ID,
      revokedAt: null,
      role: 'SPEAKER',
    });
    const res = await GET(get({ Authorization: 'Bearer TOKEN_DEL_RELATORE' }), ctx());
    expect(res.status).toBe(200);
    expect(whereInterrogato()).toHaveProperty('visibility');
  });

  it('la risposta porta la visibilità e non va in cache condivise', async () => {
    mockedMaterials.mockResolvedValue([materialRow('ALWAYS'), materialRow('BEFORE')]);
    const res = await GET(get(), ctx());
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const body = (await res.json()) as { materials: { visibility: string }[] };
    expect(body.materials.map((m) => m.visibility)).toEqual(['ALWAYS', 'BEFORE']);
  });

  it('un evento senza pagina pubblica resta 404', async () => {
    mockedEvent.mockResolvedValue(eventRow({ status: 'DRAFT' }));
    const res = await GET(get(), ctx());
    expect(res.status).toBe(404);
    expect(mockedMaterials).not.toHaveBeenCalled();
  });
});

describe('GET /api/events/[slug]/materials — chi ha un token moderatore vede tutto', () => {
  it('il moderatore primario', async () => {
    await GET(get({ Authorization: `Bearer ${PRIMARY_TOKEN}` }), ctx());
    expect(whereInterrogato()).toEqual({ eventId: EVENT_ID });
  });

  it('un co-moderatore non revocato', async () => {
    mockedGrant.mockResolvedValue({
      eventId: EVENT_ID,
      revokedAt: null,
      role: 'MODERATOR',
    });
    await GET(get({ Authorization: 'Bearer TOKEN_DEL_COMODERATORE' }), ctx());
    expect(whereInterrogato()).toEqual({ eventId: EVENT_ID });
  });

  it('un co-moderatore revocato torna alla vista del pubblico', async () => {
    mockedGrant.mockResolvedValue({
      eventId: EVENT_ID,
      revokedAt: new Date(),
      role: 'MODERATOR',
    });
    await GET(get({ Authorization: 'Bearer TOKEN_REVOCATO' }), ctx());
    expect(whereInterrogato()).toHaveProperty('visibility');
  });

});

describe('GET /api/events/[slug]/materials — una sessione staff non allarga l’elenco', () => {
  // Chi amministra vede tutto nell'area admin. Nella sala, da iscritto o da
  // ospite, la stessa richiesta porta il cookie di sessione: se allargasse
  // l'elenco, vedrebbe senza contrassegni materiali che il pubblico non vede.
  it('l’amministratore riceve la vista del pubblico', async () => {
    staffSession.current = { role: 'admin', accountId: null };
    await GET(get(), ctx());
    expect(whereInterrogato()).toEqual({
      eventId: EVENT_ID,
      visibility: { in: ['ALWAYS', 'BEFORE'] },
    });
  });

  it('anche l’organizzatore dell’evento, con il token di un iscritto', async () => {
    staffSession.current = { role: 'organizer', accountId: OWNER_ID };
    await GET(get({ Authorization: 'Bearer TOKEN_DI_UN_ISCRITTO' }), ctx());
    expect(whereInterrogato()).toHaveProperty('visibility');
  });

  it('con il token moderatore vede tutto, sessione o no', async () => {
    staffSession.current = { role: 'organizer', accountId: OTHER_ID };
    await GET(get({ Authorization: `Bearer ${PRIMARY_TOKEN}` }), ctx());
    expect(whereInterrogato()).toEqual({ eventId: EVENT_ID });
  });
});

describe('GET /api/events/[slug]/materials — i file caricati', () => {
  it('il peso del file viaggia come numero, il percorso nello storage no', async () => {
    mockedMaterials.mockResolvedValue([
      {
        ...materialRow('ALWAYS'),
        type: 'FILE',
        fileName: 'slide.pdf',
        fileSize: BigInt(2_500_000),
        mimeType: 'application/pdf',
        blobPath: 'assets/document/2026/09/uuid-slide.pdf',
      },
    ]);
    const res = await GET(get(), ctx());
    const body = (await res.json()) as { materials: Record<string, unknown>[] };
    expect(body.materials[0]).toMatchObject({ type: 'FILE', fileSize: 2_500_000 });
    expect(body.materials[0]).not.toHaveProperty('blobPath');
  });

  it('dice se questa installazione accetta caricamenti', async () => {
    let body = (await (await GET(get(), ctx())).json()) as { uploadsEnabled: boolean };
    expect(body.uploadsEnabled).toBe(false);
    filesStorage.current = {};
    body = (await (await GET(get(), ctx())).json()) as { uploadsEnabled: boolean };
    expect(body.uploadsEnabled).toBe(true);
  });
});

/**
 * Un evento protetto da password: i materiali sono della stanza, compresi i
 * file caricati in diretta, e chi ha solo il link non entra nella stanza.
 * Prima l'elenco rispondeva a chiunque avesse lo slug, mentre domande e nuvola
 * della stessa sala rispondevano 401.
 */
describe('GET /api/events/[slug]/materials — evento protetto da password', () => {
  beforeEach(() => {
    mockedEvent.mockResolvedValue(eventRow({ status: 'LIVE', joinPasswordHash: 'hash' }));
  });

  it('chi ha solo il link: 401, nessun materiale letto', async () => {
    const res = await GET(get(), ctx());
    expect(res.status).toBe(401);
    expect(mockedMaterials).not.toHaveBeenCalled();
  });

  it('un token che non è di questo evento vale come nessun token: 401', async () => {
    mockedRegistration.mockResolvedValue({ eventId: '99999999-9999-4999-8999-999999999999' });
    const res = await GET(get({ Authorization: 'Bearer TOKEN_ALTRUI' }), ctx());
    expect(res.status).toBe(401);
  });

  it('l’ospite che ha inserito la password: vista del pubblico', async () => {
    joinGrant.current = true;
    const res = await GET(get(), ctx());
    expect(res.status).toBe(200);
    expect(whereInterrogato()).toEqual({
      eventId: EVENT_ID,
      visibility: { in: ['ALWAYS', 'DURING'] },
    });
  });

  it('l’iscritto con il proprio token: vista del pubblico', async () => {
    mockedRegistration.mockResolvedValue({ eventId: EVENT_ID });
    const res = await GET(get({ Authorization: 'Bearer TOKEN_DI_UN_ISCRITTO' }), ctx());
    expect(res.status).toBe(200);
    expect(whereInterrogato()).toHaveProperty('visibility');
  });

  it('il relatore con il proprio grant: vista del pubblico', async () => {
    mockedGrant.mockResolvedValue({ eventId: EVENT_ID, revokedAt: null, role: 'SPEAKER' });
    const res = await GET(get({ Authorization: 'Bearer TOKEN_DEL_RELATORE' }), ctx());
    expect(res.status).toBe(200);
  });

  it('un relatore revocato non entra più: 401', async () => {
    mockedGrant.mockResolvedValue({ eventId: EVENT_ID, revokedAt: new Date(), role: 'SPEAKER' });
    const res = await GET(get({ Authorization: 'Bearer TOKEN_REVOCATO' }), ctx());
    expect(res.status).toBe(401);
  });

  it('il moderatore vede tutto', async () => {
    const res = await GET(get({ Authorization: `Bearer ${PRIMARY_TOKEN}` }), ctx());
    expect(res.status).toBe(200);
    expect(whereInterrogato()).toEqual({ eventId: EVENT_ID });
  });
});
