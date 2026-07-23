import fs from 'fs';
import path from 'path';

import type { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Serving degli asset.
 *
 * Gli allegati della chat NON hanno un gate: sono capability-URL (UUID non
 * indovinabile), lo stesso modello degli altri asset. Un gate vero richiede un
 * cookie con ambito sulla rotta ed è in roadmap (vedi il docblock della rotta).
 * Questi test fissano il perimetro che DEVE reggere comunque: gli asset si
 * servono, il namespace chat ha cache breve (una rimozione si propaga), e la
 * difesa in profondità contro il traversal non cede.
 */
vi.mock('@/lib/storage', () => ({ getFilesStorage: vi.fn() }));

import { getFilesStorage } from '@/lib/storage';

import { GET } from './route';

const mockedStorage = getFilesStorage as unknown as ReturnType<typeof vi.fn>;

const EVENT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const BLOB_UUID = '11111111-2222-3333-4444-555555555555';

/** Percorsi serviti (la chiave senza il prefisso `assets/`). */
const CHAT_PATH = ['chat', EVENT_ID, '2026', '07', `${BLOB_UUID}-verbale.pdf`];
const LOGO_PATH = ['image', '2026', '07', `${BLOB_UUID}-logo.png`];

const getDownloadUrl = vi.fn(async (key: string) => `https://blob.example/${key}?sig=x`);
const upstreamFetch = vi.fn(
  async () =>
    new Response('BYTES', {
      status: 200,
      headers: { 'content-type': 'application/pdf', 'content-length': '5' },
    }),
);

/** Il param catch-all arriva come Promise: firma di Next 15. */
const ctx = (path: string[]) => ({ params: Promise.resolve({ path }) });

function request(path: string[]): NextRequest {
  return new Request(
    `https://webinar.gov.it/api/assets/${path.join('/')}`,
  ) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', upstreamFetch);
  mockedStorage.mockReturnValue({ getDownloadUrl });
});

/**
 * Il vincolo speculare: irrigidire la chat non deve spegnere il logo. Questi
 * asset stanno in pagine pubbliche, nelle og:image e nelle email — un gate qui
 * si vedrebbe come immagini rotte fuori dal prodotto.
 */
describe('GET /api/assets/[...path] — gli asset pubblici restano pubblici', () => {
  it.each([
    ['logo/copertina', LOGO_PATH],
    ['audio della sala d’attesa', ['audio', '2026', '07', `${BLOB_UUID}-attesa.mp3`]],
    ['materiale/documento', ['document', '2026', '07', `${BLOB_UUID}-slide.pdf`]],
  ])('serve %s senza token', async (_label, path) => {
    const res = await GET(request(path), ctx(path));
    expect(res.status).toBe(200);
    expect(getDownloadUrl).toHaveBeenCalledWith(`assets/${path.join('/')}`, {
      expiresInMinutes: 10,
    });
  });

  it('serve l’asset via storage senza altri roundtrip', async () => {
    // La rotta non ha alcun gate e non importa nemmeno `@/lib/db` (garanzia
    // strutturale, non solo runtime): un logo o un'og:image non deve pagare una
    // query. Se un domani qualcuno reintroducesse un accesso al DB qui, servono
    // anche i mock relativi in questo file — assenti di proposito — e il test
    // andrebbe esteso ad asserirne il non-uso.
    await GET(request(LOGO_PATH), ctx(LOGO_PATH));
    expect(getDownloadUrl).toHaveBeenCalledTimes(1);
  });

  it('la rotta non dipende dal database', () => {
    // Il vero presidio del test qui sopra: nessun import di `@/lib/db`. Se
    // rientra, questo fallisce e obbliga a ripensare la cache/costo della rotta.
    const src = fs.readFileSync(
      path.join(__dirname, 'route.ts'),
      'utf-8',
    );
    expect(src).not.toMatch(/@\/lib\/db/);
  });

  it('resta cacheabile a lungo dalle cache condivise', async () => {
    const res = await GET(request(LOGO_PATH), ctx(LOGO_PATH));
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
  });
});

/**
 * Il gate vero e proprio. Ogni caso qui è un modo concreto in cui un allegato
 * usciva dalla stanza, o in cui un irrigidimento maldestro chiuderebbe fuori
 * chi ha diritto di vederlo.
 */
describe('GET /api/assets/chat/… — capability-URL, cache breve', () => {
  it('serve un allegato di chat come qualunque altro asset', async () => {
    const res = await GET(request(CHAT_PATH), ctx(CHAT_PATH));
    expect(res.status).toBe(200);
    expect(getDownloadUrl).toHaveBeenCalledWith(`assets/${CHAT_PATH.join('/')}`, {
      expiresInMinutes: 10,
    });
  });

  it('cache BREVE sugli allegati di chat, perché una rimozione si propaghi', async () => {
    // A differenza di un logo (URL per-blob immutabile, cache di un anno), un
    // allegato può essere rimosso dalla moderazione: la sua cache deve scadere
    // in fretta perché chi l'aveva aperto smetta di vederlo.
    const res = await GET(request(CHAT_PATH), ctx(CHAT_PATH));
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=60');
  });

  it('non lascia risalire fuori dal prefisso assets/ (traversal)', async () => {
    for (const path of [['chat', '..', '..', 'evil.pdf'], ['..', 'recordings', 'x.mp4']]) {
      const res = await GET(request(path), ctx(path));
      expect(res.status, path.join('/')).toBe(400);
    }
    expect(getDownloadUrl).not.toHaveBeenCalled();
  });

  it('mantiene le protezioni di serving già presenti (nosniff)', async () => {
    const res = await GET(request(CHAT_PATH), ctx(CHAT_PATH));
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});

