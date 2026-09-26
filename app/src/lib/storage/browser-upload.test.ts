import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { uploadData, BlockBlobClient } = vi.hoisted(() => {
  const uploadData = vi.fn();
  return { uploadData, BlockBlobClient: vi.fn(() => ({ uploadData })) };
});
vi.mock('@azure/storage-blob', () => ({ BlockBlobClient }));

import type { BrowserUpload } from './provider';
import { RecordingUploadError, uploadRecordingFile } from './browser-upload';

const START = '/api/admin/publications/upload-url';
const MULTIPART = '/api/admin/publications/upload-url/multipart';
const OBJECT = 'publications/2026/0b8e7a52-3c1d-4f7e-9a3b-5d6e7f8a9b0c.mp4';

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

let calls: Call[];
/** Risposta per URL dello storage (`network`: fetch lancia); di default 200. */
let storageStatus: (url: string, attempt: number) => number | 'network';
/** Risposta alla chiusura, per tentativo (da 1). */
let completeStatus: (attempt: number) => number | 'network';
let abortStatus: number | 'network';

function plan(upload: BrowserUpload) {
  return {
    recordingUrl: 'https://store.example/bucket/recordings/' + OBJECT,
    objectName: OBJECT,
    contentType: 'video/mp4',
    expiresInSeconds: 3600,
    upload,
  };
}

function stubFetch(startBody: unknown, startStatus = 200) {
  const attempts = new Map<string, number>();
  let completions = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      calls.push({
        url,
        method,
        headers: (init.headers ?? {}) as Record<string, string>,
        body: init.body,
      });
      if (url === START) return Response.json(startBody, { status: startStatus });
      if (url === MULTIPART) {
        const status = method === 'POST' ? completeStatus(++completions) : abortStatus;
        if (status === 'network') throw new TypeError('Failed to fetch');
        return status === 204 ? new Response(null, { status }) : Response.json({}, { status });
      }
      const n = (attempts.get(url) ?? 0) + 1;
      attempts.set(url, n);
      const status = storageStatus(url, n);
      if (status === 'network') throw new TypeError('Failed to fetch');
      return new Response(null, { status });
    }),
  );
}

async function text(body: unknown): Promise<string> {
  return (body as Blob).text();
}

beforeEach(() => {
  calls = [];
  storageStatus = () => 200;
  completeStatus = () => 200;
  abortStatus = 204;
  uploadData.mockReset().mockResolvedValue({});
  BlockBlobClient.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('uploadRecordingFile', () => {
  it('chiede il piano con nome, tipo e dimensione del file', async () => {
    stubFetch(plan({ protocol: 's3-put', url: 'https://store.example/put', headers: {} }));
    const file = new File(['abc'], 'riunione.mp4', { type: 'video/mp4' });
    await uploadRecordingFile(file);
    expect(calls[0]).toMatchObject({ url: START, method: 'POST' });
    expect(JSON.parse(calls[0]?.body as string)).toEqual({
      filename: 'riunione.mp4',
      contentType: 'video/mp4',
      sizeBytes: 3,
    });
  });

  it('firma rifiutata: errore del passo `sign` con il messaggio del server', async () => {
    stubFetch({ error: 'Recording storage not configured' }, 503);
    const err = await uploadRecordingFile(new File(['x'], 'a.mp4')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RecordingUploadError);
    expect(err).toMatchObject({ step: 'sign', serverMessage: 'Recording storage not configured' });
  });

  it('Azure: blocchi con l’SDK, stessi parametri di sempre', async () => {
    stubFetch(plan({ protocol: 'azure-block', url: 'https://acct.blob.core.windows.net/c/k?sig=1' }));
    uploadData.mockImplementation(async (_file, opts) => {
      opts.onProgress({ loadedBytes: 5 });
    });
    const progress: number[] = [];
    const file = new File(['0123456789'], 'a.mp4', { type: 'video/mp4' });
    const res = await uploadRecordingFile(file, { onProgress: (p) => progress.push(p) });

    expect(res.recordingUrl).toContain(OBJECT);
    expect(BlockBlobClient).toHaveBeenCalledWith('https://acct.blob.core.windows.net/c/k?sig=1');
    expect(uploadData).toHaveBeenCalledWith(file, expect.objectContaining({
      blockSize: 8 * 1024 * 1024,
      concurrency: 4,
      blobHTTPHeaders: { blobContentType: 'video/mp4' },
    }));
    expect(progress).toEqual([50, 100]);
    expect(calls).toHaveLength(1);
  });

  it('S3, un PUT: con gli header firmati e senza SDK Azure', async () => {
    stubFetch(plan({
      protocol: 's3-put',
      url: 'https://store.example/put?sig=1',
      headers: { 'Content-Type': 'video/mp4' },
    }));
    const file = new File(['abc'], 'a.mp4', { type: 'video/mp4' });
    await uploadRecordingFile(file);
    expect(calls[1]).toMatchObject({
      url: 'https://store.example/put?sig=1',
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4' },
      body: file,
    });
    expect(BlockBlobClient).not.toHaveBeenCalled();
  });

  it('S3, errore di rete (CORS del bucket): errore del passo `upload`', async () => {
    stubFetch(plan({ protocol: 's3-put', url: 'https://store.example/put', headers: {} }));
    storageStatus = () => 'network';
    const err = await uploadRecordingFile(new File(['abc'], 'a.mp4')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RecordingUploadError);
    expect(err).toMatchObject({ step: 'upload' });
    expect((err as Error).cause).toBeInstanceOf(TypeError);
  });

  it('S3, un PUT rifiutato: errore del passo `upload`', async () => {
    stubFetch(plan({ protocol: 's3-put', url: 'https://store.example/put', headers: {} }));
    storageStatus = () => 403;
    await expect(uploadRecordingFile(new File(['abc'], 'a.mp4'))).rejects.toMatchObject({
      step: 'upload',
    });
  });

  describe('S3 a parti', () => {
    const parts: BrowserUpload = {
      protocol: 's3-multipart',
      uploadId: 'up-1',
      partSize: 4,
      partUrls: ['https://store.example/p1', 'https://store.example/p2', 'https://store.example/p3'],
    };
    const file = () => new File(['0123456789'], 'a.mp4', { type: 'video/mp4' });

    it('carica ogni parte col suo intervallo di byte, poi chiude sul server', async () => {
      stubFetch(plan(parts));
      const progress: number[] = [];
      await uploadRecordingFile(file(), { onProgress: (p) => progress.push(p) });

      const puts = calls.filter((c) => c.method === 'PUT');
      expect(puts.map((c) => c.url).sort()).toEqual(parts.partUrls);
      const bodies = Object.fromEntries(
        await Promise.all(puts.map(async (c) => [c.url, await text(c.body)] as const)),
      );
      expect(bodies).toEqual({
        'https://store.example/p1': '0123',
        'https://store.example/p2': '4567',
        'https://store.example/p3': '89',
      });
      // Le parti viaggiano senza Content-Type: la loro firma copre solo l'host.
      for (const c of puts) expect(c.headers).toEqual({});

      const complete = calls.find((c) => c.url === MULTIPART);
      expect(complete?.method).toBe('POST');
      expect(JSON.parse(complete?.body as string)).toEqual({
        objectName: OBJECT,
        uploadId: 'up-1',
        sizeBytes: 10,
      });
      expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
      expect(progress.at(-1)).toBe(100);
      expect(Math.max(...progress.slice(0, -1))).toBeLessThanOrEqual(99);
    });

    it('ritenta una parte dopo un 503', async () => {
      vi.useFakeTimers();
      stubFetch(plan(parts));
      storageStatus = (url, attempt) => (url.endsWith('/p2') && attempt === 1 ? 503 : 200);
      const done = uploadRecordingFile(file());
      await vi.runAllTimersAsync();
      await done;
      expect(calls.filter((c) => c.url.endsWith('/p2'))).toHaveLength(2);
      expect(calls.find((c) => c.url === MULTIPART)?.method).toBe('POST');
    });

    it('ritenta una parte dopo un errore di rete', async () => {
      vi.useFakeTimers();
      stubFetch(plan(parts));
      storageStatus = (url, attempt) => (url.endsWith('/p3') && attempt < 3 ? 'network' : 200);
      const done = uploadRecordingFile(file());
      await vi.runAllTimersAsync();
      await done;
      expect(calls.filter((c) => c.url.endsWith('/p3'))).toHaveLength(3);
    });

    it('rete giù su una parte dopo tutti i tentativi: annulla', async () => {
      vi.useFakeTimers();
      stubFetch(plan(parts));
      storageStatus = (url) => (url.endsWith('/p1') ? 'network' : 200);
      const done = uploadRecordingFile(file()).catch((e: unknown) => e);
      await vi.runAllTimersAsync();
      const err = await done;
      expect(err).toMatchObject({ step: 'upload' });
      expect(calls.filter((c) => c.url.endsWith('/p1'))).toHaveLength(3);
      expect(calls.filter((c) => c.url === MULTIPART).map((c) => c.method)).toEqual(['DELETE']);
    });

    const multipartMethods = () =>
      calls.filter((c) => c.url === MULTIPART).map((c) => c.method);

    it.each([
      ['la rete', 'network' as const],
      ['il proxy (504)', 504],
      ['lo storage (502)', 502],
    ])('chiusura senza risposta per %s: la ritenta e non annulla', async (_label, first) => {
      vi.useFakeTimers();
      stubFetch(plan(parts));
      completeStatus = (attempt) => (attempt === 1 ? first : 200);
      const progress: number[] = [];
      const done = uploadRecordingFile(file(), { onProgress: (p) => progress.push(p) });
      await vi.runAllTimersAsync();
      await expect(done).resolves.toMatchObject({ recordingUrl: expect.stringContaining(OBJECT) });
      expect(multipartMethods()).toEqual(['POST', 'POST']);
      expect(progress.at(-1)).toBe(100);
    });

    it('chiusura mai confermata: dopo tutti i tentativi annulla e segnala l’errore', async () => {
      vi.useFakeTimers();
      stubFetch(plan(parts));
      completeStatus = () => 'network';
      const done = uploadRecordingFile(file()).catch((e: unknown) => e);
      await vi.runAllTimersAsync();
      const err = await done;
      expect(err).toBeInstanceOf(RecordingUploadError);
      expect(err).toMatchObject({ step: 'upload' });
      expect((err as Error).cause).toBeInstanceOf(TypeError);
      expect(multipartMethods()).toEqual(['POST', 'POST', 'POST', 'POST', 'DELETE']);
    });

    it.each([401, 422])('chiusura rifiutata con %s: non la ritenta', async (status) => {
      stubFetch(plan(parts));
      completeStatus = () => status;
      await expect(uploadRecordingFile(file())).rejects.toMatchObject({ step: 'upload' });
      expect(multipartMethods()).toEqual(['POST', 'DELETE']);
    });

    it('annullamento rifiutato dal server: lo scrive in console, l’errore resta quello del caricamento', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      stubFetch(plan(parts));
      storageStatus = (url) => (url.endsWith('/p2') ? 403 : 200);
      abortStatus = 401;
      await expect(uploadRecordingFile(file())).rejects.toThrow(/part PUT failed: HTTP 403/);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('HTTP 401'));
      warn.mockRestore();
    });

    it('annullamento perso per rete: lo scrive in console', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      stubFetch(plan(parts));
      storageStatus = (url) => (url.endsWith('/p2') ? 403 : 200);
      abortStatus = 'network';
      await expect(uploadRecordingFile(file())).rejects.toMatchObject({ step: 'upload' });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('abort failed'), expect.any(TypeError));
      warn.mockRestore();
    });

    it('una parte rifiutata annulla il caricamento e non lo chiude', async () => {
      stubFetch(plan(parts));
      storageStatus = (url) => (url.endsWith('/p2') ? 403 : 200);
      await expect(uploadRecordingFile(file())).rejects.toMatchObject({ step: 'upload' });
      expect(calls.filter((c) => c.url.endsWith('/p2'))).toHaveLength(1);
      const multipart = calls.filter((c) => c.url === MULTIPART);
      expect(multipart.map((c) => c.method)).toEqual(['DELETE']);
      expect(JSON.parse(multipart[0]?.body as string)).toEqual({ objectName: OBJECT, uploadId: 'up-1' });
    });

    it('chiusura rifiutata dal server (parti mancanti): annulla senza ritentare', async () => {
      stubFetch(plan(parts));
      completeStatus = () => 409;
      await expect(uploadRecordingFile(file())).rejects.toMatchObject({ step: 'upload' });
      expect(calls.filter((c) => c.url === MULTIPART).map((c) => c.method)).toEqual(['POST', 'DELETE']);
    });
  });
});
