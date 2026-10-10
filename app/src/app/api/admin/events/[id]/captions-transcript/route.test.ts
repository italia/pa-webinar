// @vitest-environment node
/**
 * /api/admin/events/[id]/captions-transcript — lo stato della trascrizione
 * dai sottotitoli (GET) e la sua costruzione su richiesta (POST), per chi
 * gestisce l'evento.
 */
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
}));
vi.mock('@/lib/auth/staff-session', () => ({
  requireEventManager: vi.fn(async () => ({ role: 'admin', accountId: null })),
}));
vi.mock('@/lib/audit/admin-audit', () => ({ logAdminAction: vi.fn(async () => undefined) }));
vi.mock('@/lib/captions/transcript', () => ({
  CAPTIONS_TRANSCRIPT_MODEL: 'live-captions',
  costruisciTrascrizioneDaiSottotitoli: vi.fn(),
  contaVoci: (f: unknown[]) => f.length,
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn() },
    captionSegment: { count: vi.fn(), findMany: vi.fn() },
    recording: { findFirst: vi.fn() },
  },
}));

import { requireEventManager } from '@/lib/auth/staff-session';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { costruisciTrascrizioneDaiSottotitoli } from '@/lib/captions/transcript';
import { prisma } from '@/lib/db';
import { ForbiddenError } from '@/lib/errors';

import { GET, POST } from './route';

const ID = '11111111-2222-4333-8444-555555555555';
const evento = vi.mocked(prisma.event.findUnique);
const conta = vi.mocked(prisma.captionSegment.count);
const voci = vi.mocked(prisma.captionSegment.findMany);
const registrazione = vi.mocked(prisma.recording.findFirst);

function req(id = ID, method = 'GET'): [NextRequest, { params: Promise<{ id: string }> }] {
  return [
    new Request(`https://webinar.example.gov.it/api/admin/events/${id}/captions-transcript`, {
      method,
    }) as unknown as NextRequest,
    { params: Promise.resolve({ id }) },
  ];
}

describe('GET captions-transcript', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    evento.mockResolvedValue({
      id: ID,
      transcriptPublished: false,
      recordingPublished: false,
      recordingUrl: null,
    } as never);
    conta.mockImplementation((async (args: { where: { text: unknown } }) =>
      args.where.text === null ? 9 : 8) as never);
    voci.mockResolvedValue([{ seatId: 'a' }, { seatId: 'b' }] as never);
  });

  it('conta frasi, segnaposto e voci; senza trascrizione dice null', async () => {
    registrazione.mockResolvedValue(null);
    const res = await GET(...req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      frasi: 8,
      segnaposto: 9,
      voci: 2,
      trascrizione: null,
      pubblicata: false,
      videoPubblicato: false,
    });
  });

  it('dice da dove viene la trascrizione e se è stata corretta', async () => {
    registrazione.mockResolvedValue({
      id: 'rec-1',
      artifacts: [{ modelId: 'live-captions', revisedAt: new Date() }],
    } as never);
    const body = await (await GET(...req())).json();
    expect(body.trascrizione).toEqual({ recordingId: 'rec-1', origine: 'sottotitoli', corretta: true });

    registrazione.mockResolvedValue({
      id: 'rec-2',
      artifacts: [{ modelId: 'whisperx-large-v3', revisedAt: null }],
    } as never);
    const ai = await (await GET(...req())).json();
    expect(ai.trascrizione).toEqual({ recordingId: 'rec-2', origine: 'ai', corretta: false });
  });

  it('rifiuta chi non gestisce l’evento', async () => {
    vi.mocked(requireEventManager).mockRejectedValueOnce(new ForbiddenError());
    const res = await GET(...req());
    expect(res.status).toBe(403);
    expect(evento).not.toHaveBeenCalled();
  });

  it('rifiuta un id che non è un UUID', async () => {
    const res = await GET(...req('non-uuid'));
    expect(res.status).toBe(400);
  });
});

describe('POST captions-transcript', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    evento.mockResolvedValue({ id: ID } as never);
  });

  it('costruisce e lascia traccia nel registro', async () => {
    vi.mocked(costruisciTrascrizioneDaiSottotitoli).mockResolvedValue({
      stato: 'scritta',
      recordingId: 'rec-1',
      segmenti: 8,
      nuovaRegistrazione: true,
    });
    const res = await POST(...req(ID, 'POST'));
    expect(res.status).toBe(200);
    expect((await res.json()).stato).toBe('scritta');
    expect(vi.mocked(logAdminAction).mock.calls[0]![0]).toMatchObject({
      action: 'CAPTIONS_TRANSCRIPT_BUILT',
      details: { stato: 'scritta', segmenti: 8 },
    });
  });
});
