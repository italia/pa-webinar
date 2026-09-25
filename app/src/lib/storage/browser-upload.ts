/**
 * Caricamento di un video dal browser direttamente nello storage delle
 * registrazioni, per i componenti dell'amministrazione.
 *
 * Il server (POST /api/admin/publications/upload-url) sceglie il protocollo
 * in base al fornitore e questo modulo lo esegue:
 *   - `azure-block`   l'SDK Azure carica a blocchi da 8 MiB, 4 alla volta;
 *                     viene scaricato solo quando serve.
 *   - `s3-put`        un PUT con `fetch`, con gli header firmati.
 *   - `s3-multipart`  PUT delle parti con `fetch`, 4 alla volta e ciascuna
 *                     ritentata sugli errori di rete e 5xx; poi il server
 *                     chiude il caricamento (ritentato se l'esito è incerto),
 *                     o lo annulla se qualcosa va storto.
 *
 * Per S3 il CORS del bucket deve ammettere PUT dall'origine dell'app e
 * l'header Content-Type; non serve esporre ETag.
 */

import type { BrowserUpload } from './provider';

const START_URL = '/api/admin/publications/upload-url';
const MULTIPART_URL = '/api/admin/publications/upload-url/multipart';

const AZURE_BLOCK_SIZE = 8 * 1024 * 1024;
const CONCURRENCY = 4;
const PART_ATTEMPTS = 3;
/** Tentativi di chiusura, con attese di 2, 4 e 8 secondi. */
const COMPLETE_ATTEMPTS = 4;
const COMPLETE_RETRY_BASE_MS = 2000;

export type RecordingUploadStep = 'sign' | 'upload';

/**
 * Errore di un passo del caricamento. `step` permette al componente di
 * mostrare il messaggio tradotto giusto; `serverMessage` è il messaggio
 * della rotta di firma, quando c'è.
 */
export class RecordingUploadError extends Error {
  constructor(
    readonly step: RecordingUploadStep,
    message: string,
    readonly serverMessage?: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'RecordingUploadError';
  }
}

interface StartResponse {
  recordingUrl: string;
  objectName: string;
  contentType: string;
  upload: BrowserUpload;
}

export interface RecordingUploadCallbacks {
  /** La firma è arrivata: comincia il trasferimento dei byte. */
  onUploadStart?: () => void;
  /** Avanzamento 0-100; resta a 99 finché il caricamento non è chiuso. */
  onProgress?: (percent: number) => void;
}

/** Carica `file` e restituisce l'URL canonico da salvare sull'evento. */
export async function uploadRecordingFile(
  file: File,
  callbacks: RecordingUploadCallbacks = {},
): Promise<{ recordingUrl: string }> {
  const res = await fetch(START_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      ...(file.type && { contentType: file.type }),
      sizeBytes: file.size,
    }),
  });
  if (!res.ok) {
    const data: unknown = await res.json().catch(() => null);
    const serverMessage =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : undefined;
    throw new RecordingUploadError('sign', `Upload URL request failed: HTTP ${res.status}`, serverMessage);
  }
  const plan = (await res.json()) as StartResponse;

  callbacks.onUploadStart?.();
  const report = (loadedBytes: number) =>
    callbacks.onProgress?.(Math.min(99, Math.floor((loadedBytes / file.size) * 100)));

  const { upload } = plan;
  switch (upload.protocol) {
    case 'azure-block':
      await uploadAzureBlocks(file, upload.url, plan.contentType, report);
      break;
    case 's3-put':
      await putOnce(file, upload.url, upload.headers);
      break;
    case 's3-multipart':
      await uploadParts(file, plan.objectName, upload, report);
      break;
    default:
      throw new RecordingUploadError('upload', 'Unsupported upload protocol');
  }
  callbacks.onProgress?.(100);
  return { recordingUrl: plan.recordingUrl };
}

async function uploadAzureBlocks(
  file: File,
  url: string,
  contentType: string,
  report: (loadedBytes: number) => void,
): Promise<void> {
  // L'SDK divide in blocchi e li ricompone (Put Block List), così anche i
  // file oltre il limite del PUT singolo di Azure passano.
  const { BlockBlobClient } = await import('@azure/storage-blob');
  await new BlockBlobClient(url).uploadData(file, {
    blockSize: AZURE_BLOCK_SIZE,
    concurrency: CONCURRENCY,
    blobHTTPHeaders: { blobContentType: contentType },
    onProgress: (ev) => report(ev.loadedBytes),
  });
}

/**
 * `fetch` verso lo storage. Un errore di rete (spesso il CORS del bucket che
 * non ammette l'origine o il metodo) diventa un errore del passo `upload`,
 * così l'interfaccia mostra il messaggio tradotto; l'originale resta in
 * `cause` e nella console di rete del browser.
 */
async function storageFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    throw new RecordingUploadError(
      'upload',
      `Storage request failed: ${e instanceof Error ? e.message : String(e)}`,
      undefined,
      { cause: e },
    );
  }
}

async function putOnce(
  file: File,
  url: string,
  headers: Record<string, string>,
): Promise<void> {
  const res = await storageFetch(url, { method: 'PUT', headers, body: file });
  if (!res.ok) {
    throw new RecordingUploadError('upload', `Storage PUT failed: HTTP ${res.status}`);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function putPart(url: string, body: Blob): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    let res: Response | null = null;
    try {
      // Il Blob di `slice` non ha tipo: niente Content-Type, come vuole la
      // firma della parte (copre solo l'host).
      res = await storageFetch(url, { method: 'PUT', body });
    } catch (e) {
      // Errore di rete: si ritenta la stessa parte.
      if (attempt >= PART_ATTEMPTS) throw e;
    }
    if (res?.ok) return;
    if (res && ((res.status < 500 && res.status !== 429) || attempt >= PART_ATTEMPTS)) {
      throw new RecordingUploadError('upload', `Storage part PUT failed: HTTP ${res.status}`);
    }
    await sleep(1000 * attempt);
  }
}

async function uploadParts(
  file: File,
  objectName: string,
  upload: Extract<BrowserUpload, { protocol: 's3-multipart' }>,
  report: (loadedBytes: number) => void,
): Promise<void> {
  const { uploadId, partSize, partUrls } = upload;
  const loaded = new Array<number>(partUrls.length).fill(0);
  // Stato condiviso dai lavoratori: al primo errore nessuno prende altre parti.
  const state: { next: number; failure: { error: unknown } | null } = {
    next: 0,
    failure: null,
  };

  const worker = async () => {
    while (!state.failure && state.next < partUrls.length) {
      const i = state.next++;
      const url = partUrls[i];
      if (!url) return;
      const start = i * partSize;
      const chunk = file.slice(start, Math.min(start + partSize, file.size));
      try {
        await putPart(url, chunk);
      } catch (error) {
        state.failure ??= { error };
        return;
      }
      loaded[i] = chunk.size;
      report(loaded.reduce((a, b) => a + b, 0));
    }
  };
  // Si aspetta che ogni parte in volo finisca prima di chiudere o annullare:
  // una parte arrivata dopo l'annullamento resterebbe nel bucket.
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, partUrls.length) }, worker),
  );

  const ref = { objectName, uploadId };
  if (!state.failure) {
    const error = await completeUpload(ref, file.size);
    if (!error) return;
    state.failure = { error };
  }

  // Annullamento di cortesia, anche dopo una chiusura mai confermata: su un
  // caricamento già chiuso lo storage non tocca l'oggetto, su uno ancora
  // aperto ne libera le parti. L'errore da mostrare resta quello del
  // caricamento.
  await abortUpload(ref);
  throw state.failure.error;
}

type UploadRef = { objectName: string; uploadId: string };

/**
 * Chiede al server di chiudere il caricamento; restituisce l'errore da
 * mostrare, o null se è chiuso. Un esito incerto (rete, 5xx, 429: ad
 * esempio il proxy che scade mentre lo storage ricompone un file grande)
 * si ritenta, perché la chiusura è idempotente: se la precedente era
 * riuscita il server risponde 200. Un 4xx (parti mancanti, sessione
 * scaduta) non cambia ritentando.
 */
async function completeUpload(
  ref: UploadRef,
  sizeBytes: number,
): Promise<RecordingUploadError | null> {
  for (let attempt = 1; ; attempt++) {
    let error: RecordingUploadError;
    try {
      const res = await fetch(MULTIPART_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...ref, sizeBytes }),
      });
      if (res.ok) return null;
      error = new RecordingUploadError('upload', `Upload completion failed: HTTP ${res.status}`);
      if (res.status < 500 && res.status !== 429) return error;
    } catch (e) {
      error = new RecordingUploadError('upload', 'Upload completion failed', undefined, {
        cause: e,
      });
    }
    if (attempt >= COMPLETE_ATTEMPTS) return error;
    await sleep(COMPLETE_RETRY_BASE_MS * 2 ** (attempt - 1));
  }
}

/**
 * Annulla il caricamento. Se non ci riesce lo scrive in console (anche per
 * un rifiuto HTTP, non solo per un errore di rete) e le parti restano nel
 * bucket finché non le toglie la regola di ciclo di vita.
 */
async function abortUpload(ref: UploadRef): Promise<void> {
  try {
    const res = await fetch(MULTIPART_URL, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ref),
    });
    if (!res.ok) console.warn(`[upload] abort failed: HTTP ${res.status}`);
  } catch (e) {
    console.warn('[upload] abort failed:', e);
  }
}
