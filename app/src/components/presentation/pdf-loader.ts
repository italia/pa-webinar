'use client';

/**
 * pdf.js (Mozilla, Apache-2.0) per il visore delle presentazioni, servito
 * dall'app stessa: nessun CDN.
 *
 * Si carica solo quando qualcuno presenta, con un import dinamico: chi non
 * vede mai una presentazione non scarica la libreria. È la versione «legacy»
 * del pacchetto, quella per i browser meno recenti: il pubblico di un evento
 * della PA arriva anche da dispositivi aggiornati di rado.
 *
 * Il worker che legge il PDF è un file della stessa libreria che il bundler
 * copia tale e quale fra i file statici dell'app (`new URL(…, import.meta.url)`)
 * e serve da `/_next/static`. La pagina lo avvia sotto `worker-src 'self'`
 * (middleware.ts): stessa origine, niente `blob:`.
 *
 * Nessun decodificatore WebAssembly (`useWasm: false`) e nessun file di font o
 * di CMap da scaricare: le slide esportate da un programma di presentazione
 * incorporano i propri caratteri, e un documento che non lo fa ricade sui
 * caratteri di sistema. Restano fuori le immagini JPEG 2000 e JBIG2, rare
 * nelle slide.
 */

import type * as PdfJsModule from 'pdfjs-dist/legacy/build/pdf.mjs';

type PdfJs = typeof PdfJsModule;

export type PdfDocument = Awaited<ReturnType<PdfJs['getDocument']>['promise']>;
export type PdfLoadingTask = ReturnType<PdfJs['getDocument']>;

let caricamento: Promise<PdfJs> | null = null;

/** La libreria, caricata una volta sola per pagina. */
export function loadPdfJs(): Promise<PdfJs> {
  if (!caricamento) {
    caricamento = import('pdfjs-dist/legacy/build/pdf.mjs').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
        import.meta.url,
      ).toString();
      return pdfjs;
    });
    // Un caricamento fallito (rete) si ritenta alla volta successiva.
    caricamento.catch(() => {
      caricamento = null;
    });
  }
  return caricamento;
}

/** Apre un PDF già scaricato. Il chiamante tiene il compito per poterlo annullare. */
export async function openPdf(data: Uint8Array): Promise<PdfLoadingTask> {
  const pdfjs = await loadPdfJs();
  return pdfjs.getDocument({
    data,
    useWasm: false,
    enableXfa: false,
    // Il documento è già tutto in memoria: niente letture a pezzi.
    disableRange: true,
    disableStream: true,
  });
}
