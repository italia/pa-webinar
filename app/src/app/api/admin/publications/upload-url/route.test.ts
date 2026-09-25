import type { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// La rotta restituisce un permesso di scrittura sullo storage: in ogni test
// negativo l'asserzione che conta è che non sia stato firmato niente.
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({})) }));
vi.mock('@/lib/auth/staff-session', () => ({ requireStaff: vi.fn() }));
vi.mock('@/lib/storage/recordings', () => ({
  createRecordingBrowserUpload: vi.fn(),
  isRecordingStorageConfigured: vi.fn(),
}));

import { requireStaff } from '@/lib/auth/staff-session';
import { UnauthorizedError } from '@/lib/errors';
import { PUBLICATION_OBJECT_NAME_RE } from '@/lib/storage/publication-upload';
import {
  createRecordingBrowserUpload,
  isRecordingStorageConfigured,
} from '@/lib/storage/recordings';

import { POST } from './route';

const staff = requireStaff as unknown as ReturnType<typeof vi.fn>;
const create = createRecordingBrowserUpload as unknown as ReturnType<typeof vi.fn>;
const configured = isRecordingStorageConfigured as unknown as ReturnType<typeof vi.fn>;

function post(body: unknown): Promise<Response> {
  const request = new Request('https://app.example/api/admin/publications/upload-url', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST(request as unknown as NextRequest, { params: Promise.resolve({}) });
}

const PLAN = {
  protocol: 's3-multipart',
  uploadId: 'up-1',
  partSize: 16 * 1024 * 1024,
  partUrls: ['https://s3.example/p1', 'https://s3.example/p2'],
};

describe('POST /api/admin/publications/upload-url', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    staff.mockResolvedValue({ role: 'organizer', id: 'org-1' });
    configured.mockReturnValue(true);
    create.mockResolvedValue({ recordingUrl: 'https://s3.example/bucket/rec.mp4', upload: PLAN });
  });

  it('restituisce URL canonico, tipo e piano di caricamento del fornitore', async () => {
    const res = await post({ filename: 'riunione.MOV', contentType: 'video/quicktime', sizeBytes: 20_000_000 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      recordingUrl: 'https://s3.example/bucket/rec.mp4',
      contentType: 'video/quicktime',
      expiresInSeconds: 3600,
      upload: PLAN,
    });
    expect(body.objectName).toMatch(PUBLICATION_OBJECT_NAME_RE);
    expect(body.objectName).toMatch(/\.mov$/);
    expect(create).toHaveBeenCalledWith(body.objectName, {
      contentType: 'video/quicktime',
      sizeBytes: 20_000_000,
      expiresInMinutes: 60,
    });
  });

  it('un tipo dichiarato fuori elenco non arriva allo storage', async () => {
    await post({ filename: 'clip.webm', contentType: 'text/html', sizeBytes: 10 });
    expect(create.mock.calls[0]?.[1]).toMatchObject({ contentType: 'video/webm' });
  });

  it('senza sessione dello staff non firma nulla', async () => {
    staff.mockRejectedValue(new UnauthorizedError());
    const res = await post({ filename: 'a.mp4', sizeBytes: 10 });
    expect(res.status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });

  it('senza storage delle registrazioni risponde 503', async () => {
    configured.mockReturnValue(false);
    const res = await post({ filename: 'a.mp4', sizeBytes: 10 });
    expect(res.status).toBe(503);
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ['senza nome', { sizeBytes: 10 }],
    ['nome vuoto', { filename: '   ', sizeBytes: 10 }],
    ['senza dimensione', { filename: 'a.mp4' }],
    ['dimensione zero', { filename: 'a.mp4', sizeBytes: 0 }],
    ['oltre 5 GiB', { filename: 'a.mp4', sizeBytes: 5 * 1024 ** 3 + 1 }],
    ['dimensione non intera', { filename: 'a.mp4', sizeBytes: 1.5 }],
  ])('%s: 422 e nessuna firma', async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(422);
    expect(create).not.toHaveBeenCalled();
  });
});
