/**
 * I byte del PDF di un materiale, letti lato server come fa `/api/assets`: il
 * browser non raggiunge lo storage (nessun host in più nella CSP), e il file
 * si legge con un URL firmato breve che non esce da qui.
 *
 * Lo usano le rotte che mostrano un PDF con pdf.js: la presentazione in sala
 * e le slide accanto alla registrazione. Chi chiama ha già deciso chi può
 * leggere e quale materiale, e che la chiave sia quella di un materiale
 * dell'evento (`isPresentableMaterial`, lib/presentation/state).
 *
 * La risposta è privata e senza memoria (dipende da chi chiede e da cosa si
 * mostra adesso), con il tipo deciso dal materiale e non dallo storage, e
 * `attachment`: aperta direttamente si scarica, il visore la legge con fetch.
 */

import { AppError, NotFoundError } from '@/lib/errors';
import { getFilesStorage } from '@/lib/storage';

/** Quanto vale l'URL firmato: il tempo di aprire la lettura, non di più. */
const FIRMA_MINUTI = 10;

export async function streamMaterialPdf(
  blobPath: string,
  logTag: string
): Promise<Response> {
  const storage = getFilesStorage();
  if (!storage) {
    const err = new AppError(
      'Files storage is not configured',
      503,
      'STORAGE_UNAVAILABLE'
    );
    err.expected = true;
    throw err;
  }

  let upstream: Response;
  try {
    const firmato = await storage.getDownloadUrl(blobPath, {
      expiresInMinutes: FIRMA_MINUTI,
    });
    upstream = await fetch(firmato);
  } catch (err) {
    console.error(
      `[${logTag}] lettura dallo storage non riuscita:`,
      err instanceof Error ? err.message : err
    );
    throw new AppError(
      'Failed to read the file from storage',
      502,
      'STORAGE_READ_FAILED'
    );
  }
  if (!upstream.ok || !upstream.body) throw new NotFoundError('File');

  const headers = new Headers({
    // Il tipo lo decide il materiale (un PDF verificato al caricamento), non
    // lo storage; e non lo indovina il browser.
    'Content-Type': 'application/pdf',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'attachment',
    'Cache-Control': 'private, no-store',
  });
  const len = upstream.headers.get('content-length');
  if (len) headers.set('Content-Length', len);

  return new Response(upstream.body, { status: 200, headers });
}
