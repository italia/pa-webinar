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
    event: { count: vi.fn(), update: vi.fn() },
  },
  sessione: { cookie: undefined as string | undefined },
}));

vi.mock('@/lib/db', () => ({ prisma }));
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

const dati = () => prisma.event.update.mock.calls[0]![0].data as Record<string, unknown>;

beforeAll(() => {
  process.env.APP_SECRET = 'segreto-di-prova-delle-pubblicazioni-abbastanza-lungo';
});

beforeEach(async () => {
  vi.clearAllMocks();
  await entra('ADMIN');
  prisma.event.count.mockResolvedValue(0);
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
