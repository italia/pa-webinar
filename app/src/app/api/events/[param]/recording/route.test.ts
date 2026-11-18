// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Il player della registrazione: rimanda al file firmato solo a chi puo'
 * vedere la registrazione (lib/recording/audience).
 */
const { db, accesso, traccia, storage } = vi.hoisted(() => ({
  db: { event: { findFirst: vi.fn() } },
  accesso: { accessoRegistrazione: vi.fn() },
  traccia: vi.fn(),
  storage: {
    generateRecordingSasUrl: vi.fn(async (url: string): Promise<string | null> => `${url}?sig=firmato`),
    fileDelloStorage: vi.fn(() => true),
  },
}));

vi.mock('@/lib/db', () => ({ prisma: db }));
// La rotta chiede anche lo staff che ha ottenuto l'accesso, per il registro.
vi.mock('@/lib/recording/audience', () => ({
  accessoRegistrazioneConStaff: async (...a: unknown[]) => {
    const esito = await accesso.accessoRegistrazione(...a);
    return {
      accesso: esito,
      staff: esito === 'staff' ? { session: { role: 'admin', accountId: 'a' }, via: 'organizzatore' } : null,
    };
  },
}));
vi.mock('@/lib/recording/content-access', () => ({ tracciaLetturaContenuto: traccia }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/lib/storage/recordings', () => ({
  generateRecordingSasUrl: storage.generateRecordingSasUrl,
  fileDelloStorage: storage.fileDelloStorage,
  deleteRecordingBlob: vi.fn(),
}));

import { GET } from './route';

const ctx = () => ({ params: Promise.resolve({ param: 'webinar' }) });
const req = () =>
  new Request(
    'https://webinar.example.gov.it/api/events/webinar/recording'
  ) as unknown as NextRequest;
const evento = (over: Record<string, unknown> = {}) => ({
  id: 'ev-1',
  recordingUrl: 'https://storage.example.net/recordings/sala.mp4',
  status: 'ENDED',
  recordingPublished: true,
  transcriptPublished: false,
  recordingAudience: 'PUBLIC',
  recordingDestination: null,
  postEventPublic: true,
  postEventPublicUntil: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.event.findFirst.mockResolvedValue(evento());
});

describe('GET /api/events/[slug]/recording', () => {
  it("chi puo' vedere la registrazione pubblicata va al file firmato", async () => {
    for (const chi of ['pubblico', 'iscritto']) {
      accesso.accessoRegistrazione.mockResolvedValue(chi);
      const res = await GET(req(), ctx());
      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toBe(
        'https://storage.example.net/recordings/sala.mp4?sig=firmato'
      );
    }
  });

  it('riservata agli iscritti, senza prova: 403', async () => {
    db.event.findFirst.mockResolvedValue(evento({ recordingAudience: 'REGISTRANTS' }));
    accesso.accessoRegistrazione.mockResolvedValue(null);
    expect((await GET(req(), ctx())).status).toBe(403);
  });

  it('legge la destinazione, che decide per l’iscritto con la pagina privata', async () => {
    db.event.findFirst.mockResolvedValue(
      evento({
        recordingAudience: 'REGISTRANTS',
        recordingDestination: 'REGISTRANTS',
        postEventPublic: false,
      })
    );
    accesso.accessoRegistrazione.mockResolvedValue('iscritto');
    expect((await GET(req(), ctx())).status).toBe(302);
    const { select } = db.event.findFirst.mock.calls[0]?.[0] as {
      select: Record<string, boolean>;
    };
    expect(select.recordingDestination).toBe(true);
    expect(accesso.accessoRegistrazione).toHaveBeenCalledWith(
      expect.objectContaining({ recordingDestination: 'REGISTRANTS' }),
      expect.anything()
    );
  });

  it('non pubblicata: chi organizza la vede (anteprima), con la lettura tracciata; gli altri no', async () => {
    db.event.findFirst.mockResolvedValue(evento({ recordingPublished: false }));
    accesso.accessoRegistrazione.mockResolvedValue('staff');
    expect((await GET(req(), ctx())).status).toBe(302);
    expect(traccia).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'ev-1', superficie: 'video', via: 'organizzatore' })
    );
    accesso.accessoRegistrazione.mockResolvedValue(null);
    expect((await GET(req(), ctx())).status).toBe(403);
  });

  it('chi vede un video pubblicato per tutti non e’ una lettura dello staff', async () => {
    accesso.accessoRegistrazione.mockResolvedValue('pubblico');
    expect((await GET(req(), ctx())).status).toBe(302);
    expect(traccia).not.toHaveBeenCalled();
  });

  it('il pass di presenza vale senza pubblicazione solo per una chiamata rapida', async () => {
    accesso.accessoRegistrazione.mockResolvedValue('presente');
    db.event.findFirst.mockResolvedValue(evento({ recordingPublished: false, eventType: 'INSTANT' }));
    expect((await GET(req(), ctx())).status).toBe(302);
    db.event.findFirst.mockResolvedValue(evento({ recordingPublished: false, eventType: 'SCHEDULED' }));
    expect((await GET(req(), ctx())).status).toBe(403);
  });

  it('si firma solo un file dell’evento: un file dello storage che non si firma e’ 404, mai il rinvio', async () => {
    accesso.accessoRegistrazione.mockResolvedValue('pubblico');
    storage.generateRecordingSasUrl.mockResolvedValueOnce(null);
    const res = await GET(req(), ctx());
    expect(res.status).toBe(404);
    expect(res.headers.get('Location')).toBeNull();
    expect(storage.generateRecordingSasUrl).toHaveBeenCalledWith(expect.any(String), expect.any(Number), 'ev-1');
  });

  it('un indirizzo esterno, che non e’ un file dello storage, si segue com’e’', async () => {
    accesso.accessoRegistrazione.mockResolvedValue('pubblico');
    storage.generateRecordingSasUrl.mockResolvedValueOnce(null);
    storage.fileDelloStorage.mockReturnValueOnce(false);
    const res = await GET(req(), ctx());
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://storage.example.net/recordings/sala.mp4');
  });

  it('evento non concluso: 403; senza video: 404', async () => {
    db.event.findFirst.mockResolvedValue(evento({ status: 'LIVE' }));
    expect((await GET(req(), ctx())).status).toBe(403);
    db.event.findFirst.mockResolvedValue(evento({ recordingUrl: null }));
    expect((await GET(req(), ctx())).status).toBe(404);
  });
});
