import type { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Serving degli asset: pubblico per default, protetto per gli allegati di chat.
 *
 * Il difetto che questi test impediscono: la rotta era dichiaratamente pubblica
 * e gli allegati della chat vivevano sotto lo stesso prefisso di un logo, quindi
 * un documento condiviso in una stanza PA era protetto solo dal fatto che
 * l'UUID non fosse indovinabile. Chiunque avesse visto l'URL una volta — o lo
 * avesse ricevuto inoltrato — poteva riaprirlo per sempre, anche a evento
 * concluso, mentre il messaggio che lo conteneva era già dietro autenticazione.
 *
 * Come per il test della chat, l'autorizzazione NON è mockata: `authorizeChatRead`
 * (e sotto di lei sender/moderator) gira davvero, perché il punto è proprio che
 * il gate degli allegati sia LO STESSO della lettura dei messaggi. Si stubbano
 * solo DB, storage, cookie e la fetch verso il blob.
 */
vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findFirst: vi.fn() },
    eventModerator: { findUnique: vi.fn() },
    registration: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/storage', () => ({ getFilesStorage: vi.fn() }));
vi.mock('@/lib/crypto/pii', () => ({ tryDecryptPII: (v: string) => v }));
vi.mock('@/lib/events/join-grant', () => ({ hasJoinGrant: vi.fn() }));
vi.mock('@/lib/event-session', () => ({ readOwnedEventAccessToken: vi.fn() }));

import { prisma } from '@/lib/db';
import { readOwnedEventAccessToken } from '@/lib/event-session';
import { hasJoinGrant } from '@/lib/events/join-grant';
import { getFilesStorage } from '@/lib/storage';

import { signAssetRead } from '@/lib/chat/attachment-token';

import { GET } from './route';

// Il token di sola lettura è firmato HMAC con APP_SECRET.
process.env.APP_SECRET = 'test-app-secret-for-asset-read-tokens';

const mockedEvent = prisma.event.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockedGrantRow = prisma.eventModerator
  .findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedRegistration = prisma.registration
  .findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedStorage = getFilesStorage as unknown as ReturnType<typeof vi.fn>;
const mockedJoinGrant = hasJoinGrant as unknown as ReturnType<typeof vi.fn>;
const mockedOwnedToken = readOwnedEventAccessToken as unknown as ReturnType<typeof vi.fn>;

const EVENT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OTHER_EVENT_ID = 'ffffffff-1111-4222-8333-444444444444';
const BLOB_UUID = '11111111-2222-3333-4444-555555555555';
const PRIMARY_TOKEN = 'PRIMARY_MOD_TOKEN';
const ACCESS_TOKEN = 'ALICE_ACCESS_TOKEN';

/** Percorsi serviti (la chiave senza il prefisso `assets/`). */
const CHAT_PATH = ['chat', EVENT_ID, '2026', '07', `${BLOB_UUID}-verbale.pdf`];
const LOGO_PATH = ['image', '2026', '07', `${BLOB_UUID}-logo.png`];

const CHAT_KEY = `assets/${['chat', EVENT_ID, '2026', '07', `${'11111111-2222-3333-4444-555555555555'}-verbale.pdf`].join('/')}`;

const getDownloadUrl = vi.fn(async (key: string) => `https://blob.example/${key}?sig=x`);
const upstreamFetch = vi.fn(
  async () =>
    new Response('BYTES', {
      status: 200,
      headers: { 'content-type': 'application/pdf', 'content-length': '5' },
    }),
);

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

/** Il param catch-all arriva come Promise: firma di Next 15. */
const ctx = (path: string[]) => ({ params: Promise.resolve({ path }) });

function request(path: string[], opts: { query?: string; bearer?: string } = {}): NextRequest {
  return new Request(
    `https://webinar.gov.it/api/assets/${path.join('/')}${opts.query ?? ''}`,
    opts.bearer ? { headers: { authorization: `Bearer ${opts.bearer}` } } : undefined,
  ) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', upstreamFetch);
  mockedStorage.mockReturnValue({ getDownloadUrl });
  mockedEvent.mockResolvedValue(eventRow());
  mockedGrantRow.mockResolvedValue(null);
  mockedRegistration.mockResolvedValue(null);
  mockedJoinGrant.mockResolvedValue(false);
  mockedOwnedToken.mockResolvedValue(null);
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

  it('non interroga il DB per un asset pubblico', async () => {
    // Il gate costa una query per richiesta: se scattasse anche sul logo, ogni
    // pagina pubblica pagherebbe un roundtrip su un byte-stream cacheabile.
    await GET(request(LOGO_PATH), ctx(LOGO_PATH));
    expect(mockedEvent).not.toHaveBeenCalled();
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
describe('GET /api/assets/chat/… — stesso gate della lettura chat', () => {
  it('nega a un lettore anonimo un allegato di un evento concluso, senza emettere il SAS', async () => {
    // Il difetto: l'URL dell'allegato era una capability eterna. GET /chat su
    // un evento ENDED risponde 403; l'allegato rispondeva 200 a chiunque.
    // Non basta il 403: la firma di lettura sul blob non deve nemmeno nascere.
    mockedEvent.mockResolvedValue(eventRow({ status: 'ENDED' }));
    const res = await GET(request(CHAT_PATH), ctx(CHAT_PATH));
    expect(res.status).toBe(403);
    expect(getDownloadUrl).not.toHaveBeenCalled();
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('ammette un ospite finché la finestra ospite è aperta, come per i messaggi', async () => {
    // Chi in questo momento può LEGGERE il messaggio deve poterne aprire
    // l'allegato: un gate più stretto della chat romperebbe la sala live.
    const res = await GET(request(CHAT_PATH), ctx(CHAT_PATH));
    expect(res.status).toBe(200);
    expect(getDownloadUrl).toHaveBeenCalledWith(`assets/${CHAT_PATH.join('/')}`, {
      expiresInMinutes: 10,
    });
  });

  it('nega a un ospite senza join grant l’allegato di un evento con password', async () => {
    // "Ho l'URL" non basta per entrare in sala, quindi non basta per il file.
    mockedEvent.mockResolvedValue(eventRow({ joinPasswordHash: 'argon2-hash' }));
    const res = await GET(request(CHAT_PATH), ctx(CHAT_PATH));
    expect(res.status).toBe(403);
    expect(mockedJoinGrant).toHaveBeenCalledWith(EVENT_ID);
  });

  it('serve un <img> con il token di lettura FIRMATO nell’URL', async () => {
    // <img src>/<a href> non possono mandare un header, e la credenziale
    // durevole del lettore NON deve mai finire nell'URL (una magic-link di
    // moderatore, esposta nella barra e nella condivisione schermo). L'URL
    // porta invece un token di sola lettura, firmato dal server e legato a
    // QUESTO percorso: sblocca l'immagine e nient'altro. Vale anche a evento
    // concluso, senza toccare il DB.
    mockedEvent.mockResolvedValue(eventRow({ status: 'ENDED' }));
    const t = signAssetRead(CHAT_KEY, EVENT_ID);
    const res = await GET(request(CHAT_PATH, { query: `?t=${t}` }), ctx(CHAT_PATH));
    expect(res.status).toBe(200);
    // Non serve nemmeno interrogare l'evento: la firma basta.
    expect(mockedEvent).not.toHaveBeenCalled();
  });

  it('rifiuta un token di lettura firmato per un ALTRO percorso', async () => {
    // Legato al percorso: un token valido per un allegato non ne apre un altro.
    mockedEvent.mockResolvedValue(eventRow({ status: 'ENDED' }));
    const t = signAssetRead(`${CHAT_KEY}.altro`, EVENT_ID);
    const res = await GET(request(CHAT_PATH, { query: `?t=${t}` }), ctx(CHAT_PATH));
    // Firma non valida per QUESTO percorso → si ricade sul gate, evento ENDED
    // e nessun bearer → 403.
    expect(res.status).toBe(403);
  });

  it('IGNORA una credenziale durevole messa in ?token= (mai autorizzata via URL)', async () => {
    // La proprietà strutturale: su questa rotta il token durevole autorizza
    // solo dall'header. In query viene ignorato, così un vecchio link col
    // token non è più una capability. Evento ENDED → 403 nonostante il token.
    mockedEvent.mockResolvedValue(eventRow({ status: 'ENDED' }));
    const res = await GET(
      request(CHAT_PATH, { query: `?token=${PRIMARY_TOKEN}` }),
      ctx(CHAT_PATH),
    );
    expect(res.status).toBe(403);
  });

  it('accetta lo stesso token in Authorization: Bearer', async () => {
    mockedEvent.mockResolvedValue(eventRow({ status: 'ARCHIVED' }));
    const res = await GET(request(CHAT_PATH, { bearer: PRIMARY_TOKEN }), ctx(CHAT_PATH));
    expect(res.status).toBe(200);
  });

  it('ammette il partecipante registrato anche a evento concluso', async () => {
    mockedEvent.mockResolvedValue(eventRow({ status: 'ENDED' }));
    mockedRegistration.mockResolvedValue({
      id: '42',
      displayName: 'Alice',
      eventId: EVENT_ID,
    });
    const res = await GET(
      request(CHAT_PATH, { bearer: ACCESS_TOKEN }),
      ctx(CHAT_PATH),
    );
    expect(res.status).toBe(200);
  });

  it('nega il token di un ALTRO evento invece di degradarlo a ospite', async () => {
    // Bearer di un'altra registrazione: se scivolasse nel ramo ospite la
    // richiesta passerebbe lo stesso e il gate sembrerebbe funzionare.
    mockedEvent.mockResolvedValue(eventRow({ status: 'ENDED' }));
    mockedRegistration.mockResolvedValue({
      id: '43',
      displayName: 'Bruno',
      eventId: OTHER_EVENT_ID,
    });
    const res = await GET(
      request(CHAT_PATH, { bearer: 'TOKEN-DI-UN-ALTRO-EVENTO' }),
      ctx(CHAT_PATH),
    );
    expect(res.status).toBe(403);
  });

  it('risponde 404 quando l’evento nel percorso non esiste', async () => {
    mockedEvent.mockResolvedValue(null);
    const res = await GET(request(CHAT_PATH), ctx(CHAT_PATH));
    expect(res.status).toBe(404);
    expect(getDownloadUrl).not.toHaveBeenCalled();
  });

  it('nega per default un percorso malformato dentro il namespace protetto', async () => {
    // Nessun fallback al ramo pubblico: sarebbe un bypass del gate ottenuto
    // storpiando il percorso.
    for (const path of [['chat'], ['chat', 'non-un-uuid', 'x.pdf'], ['chat', EVENT_ID]]) {
      const res = await GET(request(path), ctx(path));
      expect(res.status, path.join('/')).toBe(404);
    }
    expect(getDownloadUrl).not.toHaveBeenCalled();
  });

  it('non lascia mai un allegato in una cache CONDIVISA', async () => {
    // `public` davanti a una CDN vanificherebbe il gate: la prima richiesta
    // autorizzata riempirebbe la cache e le successive verrebbero servite a
    // chiunque. Privata e breve: il browser può riusarla nella sessione, ma
    // nessuna cache condivisa, e un allegato rimosso sparisce entro pochi min.
    const res = await GET(request(CHAT_PATH), ctx(CHAT_PATH));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=300');
    expect(res.headers.get('Cache-Control')).not.toContain('public');
  });

  it('mantiene le protezioni di serving già presenti', async () => {
    // Il gate si aggiunge a nosniff & co., non li sostituisce.
    const res = await GET(request(CHAT_PATH), ctx(CHAT_PATH));
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});
