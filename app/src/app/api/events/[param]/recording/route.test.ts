// @vitest-environment node
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Il player della registrazione: rimanda al file firmato solo a chi puo'
 * vedere la registrazione (lib/recording/audience).
 */
const { db, accesso } = vi.hoisted(() => ({
  db: { event: { findFirst: vi.fn() } },
  accesso: { accessoRegistrazione: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/recording/audience', () => accesso);
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/lib/storage/recordings', () => ({
  generateRecordingSasUrl: vi.fn(async (url: string) => `${url}?sig=firmato`),
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

  it('non pubblicata: lo staff la vede (anteprima), gli altri no', async () => {
    db.event.findFirst.mockResolvedValue(evento({ recordingPublished: false }));
    accesso.accessoRegistrazione.mockResolvedValue('staff');
    expect((await GET(req(), ctx())).status).toBe(302);
    accesso.accessoRegistrazione.mockResolvedValue(null);
    expect((await GET(req(), ctx())).status).toBe(403);
  });

  it('evento non concluso: 403; senza video: 404', async () => {
    db.event.findFirst.mockResolvedValue(evento({ status: 'LIVE' }));
    expect((await GET(req(), ctx())).status).toBe(403);
    db.event.findFirst.mockResolvedValue(evento({ recordingUrl: null }));
    expect((await GET(req(), ctx())).status).toBe(404);
  });
});
