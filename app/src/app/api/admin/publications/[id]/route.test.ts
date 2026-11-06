// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
/**
 * Cosa si pubblica di un evento: lo decide chi gestisce l’evento, e questa rotta
 * tocca solo i campi della pubblicazione. Un video caricato si pubblica salvo
 * rinuncia esplicita, e togliere il video toglie anche la pubblicazione.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, sessione } = vi.hoisted(() => ({
  prisma: {
    staffAccount: { findUnique: vi.fn() },
    adminAuditLog: { create: vi.fn() },
    event: { count: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    callSession: { findFirst: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
  sessione: { cookie: undefined as string | undefined },
}));

vi.mock('@/lib/db', () => ({ prisma }));
const storage = vi.hoisted(() => ({ getRecordingsStorage: vi.fn((): unknown => null) }));
vi.mock('@/lib/storage/index', () => ({
  getRecordingsStorage: storage.getRecordingsStorage,
  recordingsProviderLabel: () => 'not-configured',
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) =>
      nome === 'admin_session' && sessione.cookie
        ? { value: sessione.cookie }
        : undefined,
  }),
}));

import { signStaffSession } from '@/lib/auth/staff-session';

import { PATCH } from './route';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const EVENTO = '22222222-2222-4222-8222-222222222222';
const VIDEO = 'https://storage.example.com/recordings/sala.mp4';

function aggiorna(corpo: unknown, id = EVENTO) {
  const request = new Request(`http://localhost/api/admin/publications/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  return PATCH(request as never, { params: Promise.resolve({ id }) });
}

async function entra(role: 'ADMIN' | 'ORGANIZER') {
  prisma.staffAccount.findUnique.mockResolvedValue({
    id: ACCOUNT,
    active: true,
    role,
    emailHash: 'impronta-account',
  });
  sessione.cookie = await signStaffSession({ id: ACCOUNT, role });
}

/** Cio' che la rotta rilegge per la guardia: un evento senza destinazione. */
const evento = (over: Record<string, unknown> = {}) => ({
  status: 'PUBLISHED',
  eventType: 'SCHEDULED',
  recordingEnabled: true,
  recordingDestination: null,
  recordingAudience: 'PUBLIC',
  recordingUrl: null,
  recordingPublished: false,
  transcriptPublished: false,
  youtubeUrl: null,
  tempRecordingUrl: null,
  ...over,
});
const riservato = (over: Record<string, unknown> = {}) =>
  evento({ recordingDestination: 'REGISTRANTS', recordingAudience: 'REGISTRANTS', ...over });
const YOUTUBE = 'https://www.youtube.com/watch?v=abc';

const dati = () => prisma.event.update.mock.calls[0]![0].data as Record<string, unknown>;

beforeAll(() => {
  process.env.APP_SECRET = 'segreto-di-prova-delle-pubblicazioni-abbastanza-lungo';
});

beforeEach(async () => {
  vi.clearAllMocks();
  await entra('ADMIN');
  prisma.event.count.mockResolvedValue(0);
  prisma.event.findUnique.mockResolvedValue(evento());
  prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => unknown) =>
    fn(prisma)
  );
  prisma.callSession.findFirst.mockResolvedValue(null);
  storage.getRecordingsStorage.mockReturnValue(null);
  prisma.event.update.mockImplementation(async ({ data }: { data: object }) => ({
    id: EVENTO,
    moderatorToken: 'token-segreto-di-conduzione',
    ...data,
  }));
});

describe('chi puo’ pubblicare', () => {
  it('un identificativo malformato e’ 400', async () => {
    expect((await aggiorna({ libraryListed: true }, 'non-un-uuid')).status).toBe(400);
    expect(prisma.event.update).not.toHaveBeenCalled();
  });

  it('senza sessione e’ 401', async () => {
    sessione.cookie = undefined;
    expect((await aggiorna({ libraryListed: true })).status).toBe(401);
    expect(prisma.event.update).not.toHaveBeenCalled();
  });

  it('l’evento di un altro organizzatore e’ 403', async () => {
    await entra('ORGANIZER');
    expect((await aggiorna({ libraryListed: true })).status).toBe(403);
    expect(prisma.event.count.mock.calls[0]![0].where).toMatchObject({
      id: EVENTO,
      AND: [{ OR: expect.arrayContaining([{ createdById: ACCOUNT }]) }],
    });
    expect(prisma.event.update).not.toHaveBeenCalled();
  });

  it('chi organizza pubblica il proprio evento', async () => {
    await entra('ORGANIZER');
    prisma.event.count.mockResolvedValue(1);
    expect((await aggiorna({ libraryListed: true })).status).toBe(200);
    expect(prisma.event.update.mock.calls[0]![0].where).toEqual({ id: EVENTO });
  });
});

describe('cosa si accetta', () => {
  it('il video e’ un indirizzo http o https', async () => {
    for (const recordingUrl of ['javascript:alert(1)', 'data:text/html,x']) {
      expect((await aggiorna({ recordingUrl })).status).toBe(422);
    }
    expect(prisma.event.update).not.toHaveBeenCalled();
  });

  it('togliere il video toglie la pubblicazione, qualunque cosa chieda la richiesta', async () => {
    await aggiorna({ recordingUrl: null, recordingPublished: true });
    expect(dati()).toMatchObject({
      recordingUrl: null,
      recordingPublished: false,
      recordingPublishedAt: null,
      recordingFileSize: null,
      recordingDuration: null,
    });
    expect(dati().recordingEnabled).toBeUndefined();
  });

  it('un corpo non valido e’ 422, e non si scrive niente', async () => {
    const corpi = [
      { libraryListed: 'si' },
      { coverImageUrl: 'non-un-indirizzo' },
      { youtubeUrl: 'https://video.example.com/1' },
      { recordingUrl: 'non-un-indirizzo' },
      { recordingFileSize: 0 },
      { recordingFileSize: 1.5 },
      { recordingDuration: -1 },
    ];
    for (const corpo of corpi) {
      expect((await aggiorna(corpo)).status).toBe(422);
    }
    expect(prisma.event.update).not.toHaveBeenCalled();
  });

  it('i campi fuori dalla pubblicazione non si scrivono', async () => {
    await aggiorna({ libraryListed: true, title: { it: 'Altro' }, moderatorToken: 'x' });
    expect(dati()).toEqual({ libraryListed: true });
  });
});

describe('cosa si scrive', () => {
  it('solo i campi mandati', async () => {
    await aggiorna({
      postEventPublic: false,
      coverImageUrl: null,
      youtubeUrl: 'https://www.youtube.com/watch?v=abc',
    });
    expect(dati()).toEqual({
      postEventPublic: false,
      coverImageUrl: null,
      youtubeUrl: 'https://www.youtube.com/watch?v=abc',
    });
  });

  it('un video caricato si pubblica e accende la registrazione', async () => {
    await aggiorna({ recordingUrl: VIDEO });
    expect(dati()).toMatchObject({
      recordingUrl: VIDEO,
      recordingEnabled: true,
      recordingPublished: true,
    });
    expect(dati().recordingPublishedAt).toBeInstanceOf(Date);
  });

  it('chi rinuncia a pubblicare carica il video e basta', async () => {
    await aggiorna({ recordingUrl: VIDEO, recordingPublished: false });
    expect(dati()).toEqual({
      recordingUrl: VIDEO,
      recordingEnabled: true,
      recordingPublished: false,
    });
  });

  it('togliere il video toglie la pubblicazione', async () => {
    await aggiorna({ recordingUrl: null });
    expect(dati()).toMatchObject({ recordingUrl: null, recordingPublished: false });
    expect(dati().recordingPublishedAt).toBeNull();
  });

  it('ritirare la pubblicazione non tocca il video', async () => {
    await aggiorna({ recordingPublished: false });
    expect(dati()).toEqual({ recordingPublished: false });
  });

  it('pubblicare segna la data', async () => {
    await aggiorna({ recordingPublished: true });
    expect(dati().recordingPublished).toBe(true);
    expect(dati().recordingPublishedAt).toBeInstanceOf(Date);
  });

  it('la dimensione del file diventa BigInt, e nulla resta nulla', async () => {
    await aggiorna({ recordingFileSize: 1_048_576, recordingDuration: 90 });
    expect(dati()).toEqual({ recordingFileSize: 1_048_576n, recordingDuration: 90 });

    prisma.event.update.mockClear();
    await aggiorna({ recordingFileSize: null, recordingDuration: null });
    expect(dati()).toEqual({ recordingFileSize: null, recordingDuration: null });
  });
});

describe('la destinazione della registrazione', () => {
  it('un video esterno su un evento riservato e’ 409, e non si scrive niente', async () => {
    prisma.event.findUnique.mockResolvedValue(riservato());
    const r = await aggiorna({ youtubeUrl: YOUTUBE });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: 'RECORDING_DESTINATION_NOT_COVERED' });
    expect(prisma.event.update).not.toHaveBeenCalled();
  });

  it('un file caricato non si rifiuta mai: si pubblica per gli iscritti', async () => {
    prisma.event.findUnique.mockResolvedValue(riservato());
    const r = await aggiorna({ recordingUrl: VIDEO, recordingFileSize: 1024 });
    expect(r.status).toBe(200);
    expect(dati()).toMatchObject({ recordingUrl: VIDEO, recordingPublished: true });
  });

  it('un indirizzo fuori dallo storage su un evento riservato e’ 409', async () => {
    storage.getRecordingsStorage.mockReturnValue({ keyFromUrl: () => null });
    prisma.event.findUnique.mockResolvedValue(riservato());
    const r = await aggiorna({ recordingUrl: 'https://altro.example.com/video.mp4' });
    expect(r.status).toBe(409);
    expect(prisma.event.update).not.toHaveBeenCalled();
  });

  it('un file dello storage su un evento riservato passa', async () => {
    storage.getRecordingsStorage.mockReturnValue({ keyFromUrl: () => 'recordings/sala.mp4' });
    prisma.event.findUnique.mockResolvedValue(riservato());
    expect((await aggiorna({ recordingUrl: VIDEO })).status).toBe(200);
  });

  it.each([
    ['la libreria', { libraryListed: true }],
    ['la pagina dopo l’evento', { postEventPublic: true }],
    ['la pubblicazione per gli iscritti', { recordingPublished: true }],
    ['togliere il video esterno', { youtubeUrl: null }],
    ['togliere il video', { recordingUrl: null }],
  ])('un evento riservato accetta %s', async (_n, corpo) => {
    prisma.event.findUnique.mockResolvedValue(riservato());
    expect((await aggiorna(corpo)).status).toBe(200);
  });

  it('un evento riservato tiene il suo video esterno', async () => {
    prisma.event.findUnique.mockResolvedValue(riservato({ youtubeUrl: YOUTUBE }));
    expect((await aggiorna({ youtubeUrl: YOUTUBE })).status).toBe(200);
  });

  describe('un evento che comincia a registrare con il file caricato', () => {
    const spento = (over: Record<string, unknown> = {}) =>
      evento({ recordingEnabled: false, ...over });

    it('parte riservato, e il file non si rifiuta', async () => {
      prisma.event.findUnique.mockResolvedValue(spento());
      expect((await aggiorna({ recordingUrl: VIDEO })).status).toBe(200);
      expect(dati()).toMatchObject({
        recordingUrl: VIDEO,
        recordingEnabled: true,
        recordingPublished: true,
        recordingDestination: 'REGISTRANTS',
        recordingAudience: 'REGISTRANTS',
      });
    });

    it('anche se chi carica rinuncia a pubblicare', async () => {
      prisma.event.findUnique.mockResolvedValue(spento());
      await aggiorna({ recordingUrl: VIDEO, recordingPublished: false });
      expect(dati()).toMatchObject({
        recordingPublished: false,
        recordingDestination: 'REGISTRANTS',
        recordingAudience: 'REGISTRANTS',
      });
    });

    it.each([
      ['concluso', () => spento({ status: 'ENDED' })],
      ['archiviato', () => spento({ status: 'ARCHIVED' })],
    ])('su un evento %s resta senza destinazione e pubblica', async (_n, stato) => {
      prisma.event.findUnique.mockResolvedValue(stato());
      expect((await aggiorna({ recordingUrl: VIDEO })).status).toBe(200);
      expect(dati()).toMatchObject({
        recordingUrl: VIDEO,
        recordingEnabled: true,
        recordingPublished: true,
      });
      expect(dati()).not.toHaveProperty('recordingDestination');
      expect(dati()).not.toHaveProperty('recordingAudience');
    });

    it('anche su un evento pubblicato la cui sala si e’ gia’ aperta', async () => {
      prisma.event.findUnique.mockResolvedValue(spento());
      prisma.callSession.findFirst.mockResolvedValue({ id: 'sessione' });
      await aggiorna({ recordingUrl: VIDEO });
      expect(dati()).not.toHaveProperty('recordingDestination');
    });

    it('un video esterno nella stessa richiesta e’ 409', async () => {
      prisma.event.findUnique.mockResolvedValue(spento());
      const r = await aggiorna({ recordingUrl: VIDEO, youtubeUrl: YOUTUBE });
      expect(r.status).toBe(409);
      expect(prisma.event.update).not.toHaveBeenCalled();
    });

    it.each([
      ['una chiamata rapida', spento({ eventType: 'INSTANT' })],
      ['un evento storico', spento({ eventType: 'LEGACY' })],
      ['un evento che registrava gia’', evento()],
      ['una destinazione dichiarata', spento({ recordingDestination: 'PUBLIC' })],
    ])('%s resta com’era', async (_n, stato) => {
      prisma.event.findUnique.mockResolvedValue(stato);
      await aggiorna({ recordingUrl: VIDEO });
      expect(dati().recordingDestination).toBeUndefined();
      expect(dati().recordingAudience).toBeUndefined();
    });

    it('togliere il video o le altre modifiche non toccano la destinazione', async () => {
      prisma.event.findUnique.mockResolvedValue(spento());
      await aggiorna({ recordingUrl: null });
      expect(dati().recordingDestination).toBeUndefined();

      prisma.event.update.mockClear();
      await aggiorna({ libraryListed: true });
      expect(dati()).toEqual({ libraryListed: true });
    });
  });

  it.each([
    ['senza destinazione', evento()],
    ['con destinazione pubblica', evento({ recordingDestination: 'PUBLIC' })],
  ])('un evento %s non si blocca', async (_n, stato) => {
    prisma.event.findUnique.mockResolvedValue(stato);
    expect((await aggiorna({ youtubeUrl: YOUTUBE, recordingPublished: true })).status).toBe(200);
  });

  it('un evento che non esiste e’ 404', async () => {
    prisma.event.findUnique.mockResolvedValue(null);
    expect((await aggiorna({ libraryListed: true })).status).toBe(404);
    expect(prisma.event.update).not.toHaveBeenCalled();
  });
});

describe('la risposta e la traccia', () => {
  it('la risposta dice i soli campi della pubblicazione', async () => {
    const r = await aggiorna({ libraryListed: true });
    expect(r.status).toBe(200);
    const testo = await r.text();
    expect(JSON.parse(testo)).toMatchObject({ id: EVENTO, libraryListed: true });
    expect(testo).not.toContain('token-segreto-di-conduzione');
  });

  it('la traccia dice quali campi', async () => {
    await aggiorna({ libraryListed: true, postEventPublic: true });
    expect(prisma.adminAuditLog.create.mock.calls[0]![0].data).toMatchObject({
      action: 'EVENT_PUBLICATION_UPDATE',
      target: EVENTO,
      details: JSON.stringify({ fields: ['libraryListed', 'postEventPublic'] }),
    });
  });
});
