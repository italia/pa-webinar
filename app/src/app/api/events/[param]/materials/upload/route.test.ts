// @vitest-environment node
import type { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Il caricamento di un file dal pannello «Materiali» della sala.
 *
 * Chi può: chi può già aggiungere un link, cioè il token moderatore primario o
 * un co-moderatore non revocato; relatori e iscritti no. Cosa passa: le stesse
 * tipologie e lo stesso limite del caricamento dall'area admin, con il tipo
 * verificato sui byte. Cosa resta: un blob sotto `assets/document/…` e una riga
 * FILE che lo punta, create insieme dal server.
 *
 * L'autorizzazione del moderatore gira davvero; storage, avviso alla sala e
 * database sono stubbati.
 */
const { storage, poke } = vi.hoisted(() => ({
  storage: {
    current: null as null | {
      put: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    },
  },
  poke: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findFirst: vi.fn() },
    eventMaterial: { create: vi.fn(), aggregate: vi.fn() },
    eventModerator: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/storage', () => ({
  getFilesStorage: () => storage.current,
}));
vi.mock('@/lib/live-state/publish', () => ({
  pokeLivePanel: poke,
}));
// Il limite per minuto è in memoria e sopravvive fra i test: qui non è l'oggetto.
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof RateLimitModule>()),
  rateLimit: () => ({ allowed: true, remaining: 1, resetAt: Date.now() + 60_000 }),
}));

import { prisma } from '@/lib/db';
import type * as RateLimitModule from '@/lib/rate-limit';
import {
  MATERIAL_FILE_MAX_BYTES,
  MATERIAL_FILES_PER_EVENT_MAX,
  MATERIAL_FILES_PER_EVENT_MAX_BYTES,
} from '@/lib/validation/materials';

import { POST } from './route';

/** Il livello della riga di log che withErrorHandling scrive per la risposta. */
function livelloDelLog(spia: { mock: { calls: unknown[][] } }, status: number): string | undefined {
  for (const [riga] of spia.mock.calls) {
    if (typeof riga !== 'string') continue;
    try {
      const j = JSON.parse(riga) as { level?: string; status?: number };
      if (j.status === status) return j.level;
    } catch {
      /* non e' la riga della richiesta */
    }
  }
  return undefined;
}

const mockedEvent = prisma.event.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockedCreate = prisma.eventMaterial.create as unknown as ReturnType<typeof vi.fn>;
const mockedGrant = prisma.eventModerator.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedAggregate = prisma.eventMaterial.aggregate as unknown as ReturnType<typeof vi.fn>;

/** Cosa l'evento ha già fra i materiali caricati. */
function giaCaricati(count: number, bytes: number | null) {
  mockedAggregate.mockResolvedValue({
    _count: { _all: count },
    _sum: { fileSize: bytes === null ? null : BigInt(bytes) },
  });
}

const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const SLUG = 'evento-di-prova';
const PRIMARY_TOKEN = 'PRIMARY_MOD_TOKEN';
const ORIGIN = 'https://webinar.example.gov.it';

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

const ctx = () => ({ params: Promise.resolve({ param: SLUG }) });

interface UploadOptions {
  token?: string | null;
  file?: { bytes: Buffer; name: string; type: string } | null;
  fields?: Record<string, string>;
  /** Sovrascrive il Content-Length calcolato; null lo toglie. */
  contentLength?: string | null;
}

/** Una richiesta multipart come la manda il browser, Content-Length compreso. */
async function upload(opts: UploadOptions = {}): Promise<NextRequest> {
  const form = new FormData();
  const file = opts.file === undefined ? { bytes: PDF, name: 'Slide finali.pdf', type: 'application/pdf' } : opts.file;
  if (file) form.append('file', new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));
  for (const [k, v] of Object.entries(opts.fields ?? {})) form.append(k, v);

  const encoded = new Response(form);
  const body = Buffer.from(await encoded.arrayBuffer());
  const headers = new Headers({ 'content-type': encoded.headers.get('content-type') ?? '' });
  const token = opts.token === undefined ? PRIMARY_TOKEN : opts.token;
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (opts.contentLength !== null) {
    headers.set('content-length', opts.contentLength ?? String(body.byteLength));
  }
  return new Request(`${ORIGIN}/api/events/${SLUG}/materials/upload`, {
    method: 'POST',
    headers,
    body,
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
  storage.current = {
    put: vi.fn().mockResolvedValue({ publicUrl: 'ignored' }),
    delete: vi.fn().mockResolvedValue(true),
  };
  mockedEvent.mockResolvedValue({
    id: EVENT_ID,
    moderatorToken: PRIMARY_TOKEN,
    moderatorName: 'Conduzione',
  });
  mockedGrant.mockResolvedValue(null);
  giaCaricati(0, null);
  mockedCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'mat-1',
    createdAt: new Date('2026-09-25T10:00:00.000Z'),
    ...data,
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /materials/upload — chi può caricare', () => {
  it('senza token: 401, niente storage', async () => {
    const res = await POST(await upload({ token: null }), ctx());
    expect(res.status).toBe(401);
    expect(storage.current!.put).not.toHaveBeenCalled();
  });

  it('il token di un relatore: 403, come per i link', async () => {
    mockedGrant.mockResolvedValue({ eventId: EVENT_ID, revokedAt: null, role: 'SPEAKER' });
    const res = await POST(await upload({ token: 'TOKEN_DEL_RELATORE' }), ctx());
    expect(res.status).toBe(403);
    expect(storage.current!.put).not.toHaveBeenCalled();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('il token di un iscritto: 403', async () => {
    const res = await POST(await upload({ token: 'TOKEN_DI_UN_ISCRITTO' }), ctx());
    expect(res.status).toBe(403);
  });

  it('un co-moderatore revocato: 403', async () => {
    mockedGrant.mockResolvedValue({ eventId: EVENT_ID, revokedAt: new Date(), role: 'MODERATOR' });
    const res = await POST(await upload({ token: 'TOKEN_REVOCATO' }), ctx());
    expect(res.status).toBe(403);
  });

  it('il co-moderatore di un altro evento: 403', async () => {
    mockedGrant.mockResolvedValue({
      eventId: '99999999-9999-4999-8999-999999999999',
      revokedAt: null,
      role: 'MODERATOR',
    });
    const res = await POST(await upload({ token: 'TOKEN_ALTRO_EVENTO' }), ctx());
    expect(res.status).toBe(403);
  });

  it('un co-moderatore attivo carica', async () => {
    mockedGrant.mockResolvedValue({ eventId: EVENT_ID, revokedAt: null, role: 'MODERATOR' });
    const res = await POST(await upload({ token: 'TOKEN_DEL_COMODERATORE' }), ctx());
    expect(res.status).toBe(201);
  });

  it('il nome (cifrato) del co-moderatore non finisce in chiaro nella riga', async () => {
    mockedGrant.mockResolvedValue({
      id: 'grant-1',
      eventId: EVENT_ID,
      revokedAt: null,
      role: 'MODERATOR',
      name: 'Nome Cognome',
      email: null,
    });
    const res = await POST(await upload({ token: 'TOKEN_DEL_COMODERATORE' }), ctx());
    expect(res.status).toBe(201);
    expect(mockedCreate.mock.calls[0]![0].data).toMatchObject({ addedBy: '' });
    // Senza nome la risposta porta null: la sala mostra la dicitura tradotta.
    expect(await res.json()).toMatchObject({ addedBy: null });
  });

  it('evento senza conduttore: nessuna parola fissa al posto del nome', async () => {
    mockedEvent.mockResolvedValue({ id: EVENT_ID, moderatorToken: PRIMARY_TOKEN, moderatorName: null });
    const res = await POST(await upload(), ctx());
    expect(res.status).toBe(201);
    expect(mockedCreate.mock.calls[0]![0].data).toMatchObject({ addedBy: '' });
  });

  it('evento inesistente: 404', async () => {
    mockedEvent.mockResolvedValue(null);
    const res = await POST(await upload(), ctx());
    expect(res.status).toBe(404);
  });
});

describe('POST /materials/upload — il file', () => {
  it('crea blob e riga insieme, con la chiave decisa dal server', async () => {
    const res = await POST(await upload({ fields: { description: 'Da scaricare' } }), ctx());
    expect(res.status).toBe(201);

    const [key, bytes, mime] = storage.current!.put.mock.calls[0]!;
    expect(key).toMatch(/^assets\/document\/\d{4}\/\d{2}\/[0-9a-f-]{36}-Slide-finali\.pdf$/);
    expect(Buffer.compare(bytes as Buffer, PDF)).toBe(0);
    expect(mime).toBe('application/pdf');

    const data = mockedCreate.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data).toMatchObject({
      eventId: EVENT_ID,
      type: 'FILE',
      // Senza titolo vale il nome del file.
      title: 'Slide finali.pdf',
      description: 'Da scaricare',
      addedBy: 'Conduzione',
      fileName: 'Slide-finali.pdf',
      fileSize: BigInt(PDF.byteLength),
      mimeType: 'application/pdf',
      blobPath: key,
      // Come il predefinito dell'area admin e dei link aggiunti in sala.
      visibility: 'ALWAYS',
    });
    // URL assoluto servito dall'app, come quello dell'area admin.
    expect(data.url).toBe(`${ORIGIN}/api/assets/${(key as string).replace(/^assets\//, '')}`);

    expect(poke).toHaveBeenCalledWith(EVENT_ID, 'materials');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ type: 'FILE', fileSize: PDF.byteLength, visibility: 'ALWAYS' });
    // Il percorso interno dello storage resta sul server.
    expect(body).not.toHaveProperty('blobPath');
  });

  it('usa l’origine pubblica configurata', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eventi.example.gov.it/');
    await POST(await upload({ fields: { title: 'Programma' } }), ctx());
    const data = mockedCreate.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.title).toBe('Programma');
    expect(data.url).toMatch(/^https:\/\/eventi\.example\.gov\.it\/api\/assets\/document\//);
  });

  it('un tipo fuori elenco: 415', async () => {
    const res = await POST(
      await upload({ file: { bytes: PNG, name: 'foto.png', type: 'image/png' } }),
      ctx(),
    );
    expect(res.status).toBe(415);
    expect(storage.current!.put).not.toHaveBeenCalled();
  });

  it('un tipo dichiarato che i byte smentiscono: 415', async () => {
    const res = await POST(
      await upload({ file: { bytes: PNG, name: 'finto.pdf', type: 'application/pdf' } }),
      ctx(),
    );
    expect(res.status).toBe(415);
    expect(storage.current!.put).not.toHaveBeenCalled();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('senza Content-Length: 411, prima di leggere il corpo', async () => {
    const res = await POST(await upload({ contentLength: null }), ctx());
    expect(res.status).toBe(411);
  });

  it('un corpo dichiarato oltre il limite: 413, prima di leggerlo', async () => {
    const res = await POST(
      await upload({ contentLength: String(MATERIAL_FILE_MAX_BYTES + 64 * 1024) }),
      ctx(),
    );
    expect(res.status).toBe(413);
    expect(storage.current!.put).not.toHaveBeenCalled();
  });

  it('senza file: 422', async () => {
    const res = await POST(await upload({ file: null, fields: { title: 'Solo titolo' } }), ctx());
    expect(res.status).toBe(422);
  });

  it('un titolo troppo lungo: 422', async () => {
    const res = await POST(await upload({ fields: { title: 'x'.repeat(301) } }), ctx());
    expect(res.status).toBe(422);
    expect(storage.current!.put).not.toHaveBeenCalled();
  });

  it('senza storage configurato: 503, registrato come warn', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    storage.current = null;
    const res = await POST(await upload(), ctx());
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code?: string }).code).toBe('STORAGE_UNAVAILABLE');
    expect(mockedCreate).not.toHaveBeenCalled();
    // Una configurazione ammessa, non un guasto.
    expect(livelloDelLog(log, 503)).toBe('warn');
    log.mockRestore();
  });

  it('se lo storage non scrive: 502 e nessuna riga', async () => {
    storage.current!.put.mockRejectedValue(new Error('down'));
    const res = await POST(await upload(), ctx());
    expect(res.status).toBe(502);
    expect(mockedCreate).not.toHaveBeenCalled();
    expect(poke).not.toHaveBeenCalled();
  });

  it('se la riga non si crea, il blob appena scritto se ne va', async () => {
    mockedCreate.mockRejectedValue(new Error('db down'));
    const res = await POST(await upload(), ctx());
    expect(res.status).toBe(500);
    const [key] = storage.current!.put.mock.calls[0]!;
    expect(storage.current!.delete).toHaveBeenCalledWith(key);
    expect(poke).not.toHaveBeenCalled();
  });
});

describe('POST /materials/upload — quanto si può caricare', () => {
  it('l’evento ha già il numero massimo di file: 409 prima di leggere il corpo', async () => {
    giaCaricati(MATERIAL_FILES_PER_EVENT_MAX, 1024);
    const res = await POST(await upload(), ctx());
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code?: string }).code).toBe('MATERIALS_QUOTA_EXCEEDED');
    expect(storage.current!.put).not.toHaveBeenCalled();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('il Content-Length basta a dire che si supera il tetto dei byte: 409 senza leggere', async () => {
    giaCaricati(3, MATERIAL_FILES_PER_EVENT_MAX_BYTES - 1024 * 1024);
    const res = await POST(
      await upload({ contentLength: String(5 * 1024 * 1024) }),
      ctx(),
    );
    expect(res.status).toBe(409);
    expect(storage.current!.put).not.toHaveBeenCalled();
  });

  it('i byte letti superano il tetto dell’evento: 409, niente storage', async () => {
    giaCaricati(3, MATERIAL_FILES_PER_EVENT_MAX_BYTES - 10);
    const res = await POST(await upload(), ctx());
    expect(res.status).toBe(409);
    expect(storage.current!.put).not.toHaveBeenCalled();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('conta solo i file dell’evento', async () => {
    await POST(await upload(), ctx());
    expect(mockedAggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { eventId: EVENT_ID, type: 'FILE' } }),
    );
  });

  it('oltre i caricamenti letti insieme: 429 con Retry-After, e il posto si libera', async () => {
    const inAttesa: Array<(v: { publicUrl: string }) => void> = [];
    storage.current!.put.mockImplementation(
      () => new Promise<{ publicUrl: string }>((resolve) => inAttesa.push(resolve)),
    );
    const primi = [
      POST(await upload(), ctx()),
      POST(await upload(), ctx()),
      POST(await upload(), ctx()),
    ];
    await vi.waitFor(() => expect(inAttesa).toHaveLength(3));

    const quarto = await POST(await upload(), ctx());
    expect(quarto.status).toBe(429);
    expect(quarto.headers.get('Retry-After')).toBe('5');

    for (const resolve of inAttesa) resolve({ publicUrl: 'ignored' });
    for (const res of await Promise.all(primi)) expect(res.status).toBe(201);

    // Finiti i primi tre, si carica di nuovo; anche dopo un errore il posto torna.
    storage.current!.put.mockRejectedValueOnce(new Error('down'));
    expect((await POST(await upload(), ctx())).status).toBe(502);
    storage.current!.put.mockResolvedValue({ publicUrl: 'ignored' });
    for (let i = 0; i < 3; i++) expect((await POST(await upload(), ctx())).status).toBe(201);
  });
});
