import type { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({})) }));
vi.mock('@/lib/auth/staff-session', () => ({ requireStaff: vi.fn() }));
vi.mock('@/lib/storage/recordings', () => ({
  completeRecordingBrowserUpload: vi.fn(),
  abortRecordingBrowserUpload: vi.fn(),
  isRecordingStorageConfigured: vi.fn(),
}));

import { requireStaff } from '@/lib/auth/staff-session';
import { UnauthorizedError } from '@/lib/errors';
import { IncompleteUploadError } from '@/lib/storage/provider';
import {
  abortRecordingBrowserUpload,
  completeRecordingBrowserUpload,
  isRecordingStorageConfigured,
} from '@/lib/storage/recordings';

import { DELETE, POST } from './route';

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

const staff = requireStaff as unknown as ReturnType<typeof vi.fn>;
const complete = completeRecordingBrowserUpload as unknown as ReturnType<typeof vi.fn>;
const abort = abortRecordingBrowserUpload as unknown as ReturnType<typeof vi.fn>;
const configured = isRecordingStorageConfigured as unknown as ReturnType<typeof vi.fn>;

const OBJECT = 'publications/2026/0b8e7a52-3c1d-4f7e-9a3b-5d6e7f8a9b0c.mp4';

function call(
  handler: typeof POST,
  method: 'POST' | 'DELETE',
  body: unknown,
): Promise<Response> {
  const request = new Request(
    'https://app.example/api/admin/publications/upload-url/multipart',
    { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
  );
  return handler(request as unknown as NextRequest, { params: Promise.resolve({}) });
}

beforeEach(() => {
  vi.clearAllMocks();
  staff.mockResolvedValue({ role: 'admin' });
  configured.mockReturnValue(true);
  complete.mockResolvedValue(true);
  abort.mockResolvedValue(true);
});

describe('POST: chiusura del caricamento a parti', () => {
  it('chiude il caricamento', async () => {
    const res = await call(POST, 'POST', { objectName: OBJECT, uploadId: 'up-1', sizeBytes: 40 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ completed: true });
    expect(complete).toHaveBeenCalledWith(OBJECT, { uploadId: 'up-1', sizeBytes: 40 });
  });

  it('parti mancanti: 409 e il caricamento resta aperto', async () => {
    complete.mockRejectedValue(new IncompleteUploadError('Upload incomplete: 2/3 parts'));
    const res = await call(POST, 'POST', { objectName: OBJECT, uploadId: 'up-1', sizeBytes: 40 });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('UPLOAD_INCOMPLETE');
  });

  it('errore dello storage: 502 senza dettagli', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    complete.mockRejectedValue(new Error('AccessDenied: chiave interna'));
    const res = await call(POST, 'POST', { objectName: OBJECT, uploadId: 'up-1', sizeBytes: 40 });
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('chiave interna');
  });

  it.each([
    ['una chiave qualsiasi delle registrazioni', 'recordings/call-1.mp4'],
    ['un artefatto di post-produzione', 'postprod/x/transcript.json'],
    ['un percorso con risalita', `${OBJECT}/../../x.mp4`],
  ])('non tocca %s', async (_label, objectName) => {
    const res = await call(POST, 'POST', { objectName, uploadId: 'up-1', sizeBytes: 40 });
    expect(res.status).toBe(422);
    expect(complete).not.toHaveBeenCalled();
  });

  it('senza sessione dello staff non chiude nulla', async () => {
    staff.mockRejectedValue(new UnauthorizedError());
    const res = await call(POST, 'POST', { objectName: OBJECT, uploadId: 'up-1', sizeBytes: 40 });
    expect(res.status).toBe(401);
    expect(complete).not.toHaveBeenCalled();
  });

  it('senza storage delle registrazioni risponde 503, registrato come warn', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    configured.mockReturnValue(false);
    const res = await call(POST, 'POST', { objectName: OBJECT, uploadId: 'up-1', sizeBytes: 40 });
    expect(res.status).toBe(503);
    expect(complete).not.toHaveBeenCalled();
    // Una configurazione ammessa, non un guasto.
    expect(livelloDelLog(log, 503)).toBe('warn');
    log.mockRestore();
  });
});

describe('DELETE: annullamento del caricamento a parti', () => {
  it('annulla il caricamento', async () => {
    const res = await call(DELETE, 'DELETE', { objectName: OBJECT, uploadId: 'up-1' });
    expect(res.status).toBe(204);
    expect(abort).toHaveBeenCalledWith(OBJECT, 'up-1');
  });

  it('non annulla oggetti fuori dalle pubblicazioni', async () => {
    const res = await call(DELETE, 'DELETE', { objectName: 'recordings/call-1.mp4', uploadId: 'up-1' });
    expect(res.status).toBe(422);
    expect(abort).not.toHaveBeenCalled();
  });

  it('senza sessione dello staff non annulla nulla', async () => {
    staff.mockRejectedValue(new UnauthorizedError());
    const res = await call(DELETE, 'DELETE', { objectName: OBJECT, uploadId: 'up-1' });
    expect(res.status).toBe(401);
    expect(abort).not.toHaveBeenCalled();
  });
});
