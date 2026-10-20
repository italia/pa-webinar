import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    eventPersonPhoto: { findUnique: vi.fn() },
    event: { count: vi.fn() },
  },
}));
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({})) }));
const sessione = vi.hoisted(() => ({ getStaffSession: vi.fn() }));
vi.mock('@/lib/auth/staff-session', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getStaffSession: sessione.getStaffSession,
}));

import { prisma } from '@/lib/db';

import { GET } from './route';

const ID = '11111111-1111-4111-8111-111111111111';
const find = prisma.eventPersonPhoto.findUnique as unknown as ReturnType<typeof vi.fn>;
const contaEventi = prisma.event.count as unknown as ReturnType<typeof vi.fn>;
const get = (id: string) =>
  GET(new Request(`https://webinar.gov.it/api/avatar/person/${id}`), {
    params: Promise.resolve({ id }),
  });

const FUTURO = new Date(Date.now() + 86_400_000);
/** Un evento la cui pagina pubblica si apre. */
const visibile = {
  status: 'PUBLISHED',
  eventType: 'SCHEDULED',
  endsAt: FUTURO,
  postEventPublic: true,
  postEventPublicUntil: null,
};
const BYTES = Buffer.from([0xff, 0xd8, 0xff]);

/** La foto come la legge la rotta: chi la usa ed è presentato, e quanti la
 *  usano in tutto. */
function foto({
  leadOf = [] as Array<Record<string, unknown>>,
  grants = [] as Array<Record<string, unknown>>,
  usi = { leadOf: 0, grants: 0 },
} = {}) {
  return { bytes: BYTES, contentType: 'image/jpeg', leadOf, grants, _count: usi };
}

const organizzatore = { role: 'organizer', accountId: 'a1', emailHash: 'h1' };

beforeEach(() => {
  vi.clearAllMocks();
  sessione.getStaffSession.mockResolvedValue(null);
  contaEventi.mockResolvedValue(0);
});

describe('GET /api/avatar/person/[id] — la persona è presentata', () => {
  it('una concessione presentata, su una pagina visibile: l’immagine per tutti, con una cache breve', async () => {
    find.mockResolvedValue(
      foto({ grants: [{ event: visibile }], usi: { leadOf: 0, grants: 1 } })
    );
    const res = await get(ID);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    // Le anteprime dei link la leggono da un'altra origine.
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
    // Pochi minuti, solo nel browser: tolta la persona, smette presto di vedersi.
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=300');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(BYTES));
    // Per chi la vede da fuori la sessione non serve.
    expect(sessione.getStaffSession).not.toHaveBeenCalled();
  });

  it('chiede solo chi è presentato: concessioni non revocate e organizzatore principale presentato', async () => {
    find.mockResolvedValue(null);
    await get(ID);
    const { where, select } = find.mock.calls[0]![0];
    expect(where).toEqual({ id: ID });
    expect(select.leadOf.where).toEqual({ moderatorPublicListed: true });
    expect(select.grants.where).toEqual({ publicListed: true, revokedAt: null });
  });

  it('l’organizzatore principale presentato, con il nome: per tutti', async () => {
    find.mockResolvedValue(
      foto({ leadOf: [{ moderatorName: 'Organizzatrice 1', ...visibile }], usi: { leadOf: 1, grants: 0 } })
    );
    const res = await get(ID);
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it.each([
    ['in bozza', { ...visibile, status: 'DRAFT' }],
    ['archiviato', { ...visibile, status: 'ARCHIVED' }],
    ['concluso con la pagina spenta', { ...visibile, status: 'ENDED', postEventPublic: false }],
    [
      'concluso con la pagina scaduta',
      { ...visibile, status: 'ENDED', postEventPublicUntil: new Date(Date.now() - 1000) },
    ],
    ['una chiamata rapida in corso', { ...visibile, status: 'LIVE', eventType: 'INSTANT' }],
  ])('su un evento %s la foto non è pubblica: 404 senza sessione', async (_caso, evento) => {
    find.mockResolvedValue(foto({ grants: [{ event: evento }], usi: { leadOf: 0, grants: 1 } }));
    const res = await get(ID);
    expect(res.status).toBe(404);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('tolta dalla pagina o revocata (nessuno presentato la usa): 404 senza sessione', async () => {
    // L'indirizzo era nella pagina e nei dati strutturati: chi lo conosce non
    // la vede più.
    find.mockResolvedValue(foto({ usi: { leadOf: 0, grants: 1 } }));
    expect((await get(ID)).status).toBe(404);
    // L'organizzatore principale presentato ma senza nome non compare.
    find.mockResolvedValue(
      foto({ leadOf: [{ moderatorName: null, ...visibile }], usi: { leadOf: 1, grants: 0 } })
    );
    expect((await get(ID)).status).toBe(404);
  });
});

describe('GET /api/avatar/person/[id] — lo staff', () => {
  it('chi gestisce un evento che la usa la vede: privata, mai conservata, solo per l’app', async () => {
    find.mockResolvedValue(foto({ usi: { leadOf: 0, grants: 1 } }));
    sessione.getStaffSession.mockResolvedValue(organizzatore);
    contaEventi.mockResolvedValue(1);
    const res = await get(ID);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    // La regola di chi gestisce un evento (eventScope), sugli eventi che la usano.
    const { where } = contaEventi.mock.calls[0]![0];
    expect(where.AND).toBeDefined();
    expect(where.OR).toEqual([
      { moderatorPhotoId: ID },
      { additionalMods: { some: { photoId: ID } } },
    ]);
  });

  it('un organizzatore che non gestisce nessun evento che la usa: 404', async () => {
    find.mockResolvedValue(foto({ usi: { leadOf: 1, grants: 0 } }));
    sessione.getStaffSession.mockResolvedValue(organizzatore);
    contaEventi.mockResolvedValue(0);
    expect((await get(ID)).status).toBe(404);
  });

  it('l’amministrazione la vede sempre, senza contare gli eventi', async () => {
    find.mockResolvedValue(foto({ usi: { leadOf: 1, grants: 0 } }));
    sessione.getStaffSession.mockResolvedValue({ role: 'admin', accountId: null });
    expect((await get(ID)).status).toBe(200);
    expect(contaEventi).not.toHaveBeenCalled();
  });

  it('appena caricata, prima di salvare (nessuno la usa): qualunque sessione dello staff, nessun altro', async () => {
    find.mockResolvedValue(foto());
    expect((await get(ID)).status).toBe(404);
    sessione.getStaffSession.mockResolvedValue(organizzatore);
    const res = await get(ID);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(contaEventi).not.toHaveBeenCalled();
  });
});

describe('GET /api/avatar/person/[id] — niente foto', () => {
  it('tolta, o con un id che non è un UUID: 404, mai conservato', async () => {
    find.mockResolvedValue(null);
    const tolta = await get(ID);
    expect(tolta.status).toBe(404);
    expect(tolta.headers.get('Cache-Control')).toBe('private, no-store');
    expect((await get('../segreto')).status).toBe(404);
    expect(find).toHaveBeenCalledTimes(1);
  });
});
