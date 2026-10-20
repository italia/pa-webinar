'use client';

/**
 * pdf.js (Mozilla, Apache-2.0) per il visore delle presentazioni, servito
 * dall'app stessa: nessun CDN.
 *
 * Si carica con un import dinamico solo quando serve: in sala quando
 * qualcuno presenta, sulla pagina di un evento concluso quando accanto al
 * video ci sono le slide presentate. Chi non vede mai un PDF non scarica la
 * libreria. È la versione «legacy»
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
        import.meta.url
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

/** Una pagina di un documento aperto. */
export type PdfPage = Awaited<ReturnType<PdfDocument['getPage']>>;

/** Oltre questo rapporto lo schermo non aggiunge nitidezza, solo memoria. */
const DPR_MAX = 2;

/** Caratteri al massimo del testo di una pagina mostrato sotto la slide. */
export const TESTO_PAGINA_MAX = 4_000;

/** Una pagina disegnata fuori schermo, pronta da copiare. */
export interface PaginaDisegnata {
  canvas: HTMLCanvasElement;
  /** La densità dello schermo con cui è stata disegnata. */
  dpr: number;
}

/**
 * Disegna `page` adattata al riquadro `misura`, alla densità dello schermo
 * (fino a 2x), su un canvas fuori schermo. Chi chiama la copia sul canvas
 * della pagina con `copiaPagina` quando è pronta: la pagina di prima resta
 * visibile finché la nuova non c'è, senza lampi bianchi. `onCompito` riceve
 * il disegno di pdf.js, per annullarlo se nel frattempo serve un'altra
 * pagina.
 */
export async function disegnaFuoriSchermo(
  page: PdfPage,
  misura: { w: number; h: number },
  onCompito: (compito: { cancel: () => void }) => void
): Promise<PaginaDisegnata> {
  const base = page.getViewport({ scale: 1 });
  const scala = Math.min(misura.w / base.width, misura.h / base.height);
  const dpr = Math.min(window.devicePixelRatio || 1, DPR_MAX);
  const vista = page.getViewport({ scale: scala * dpr });
  const fuori = document.createElement('canvas');
  fuori.width = Math.max(1, Math.floor(vista.width));
  fuori.height = Math.max(1, Math.floor(vista.height));
  const compito = page.render({ canvas: fuori, viewport: vista });
  onCompito(compito);
  await compito.promise;
  return { canvas: fuori, dpr };
}

/** Copia una pagina disegnata sul canvas visibile, alla sua dimensione in CSS. */
export function copiaPagina(disegnata: PaginaDisegnata, canvas: HTMLCanvasElement): void {
  const { canvas: fuori, dpr } = disegnata;
  canvas.width = fuori.width;
  canvas.height = fuori.height;
  canvas.style.width = `${Math.floor(fuori.width / dpr)}px`;
  canvas.style.height = `${Math.floor(fuori.height / dpr)}px`;
  canvas.getContext('2d')?.drawImage(fuori, 0, 0);
}

/**
 * Il testo di una pagina, per chi usa un lettore di schermo o vuole copiarlo:
 * la slide è un'immagine. Righe come le dà il PDF, senza spazi a fine riga
 * né righe vuote ripetute, al massimo `TESTO_PAGINA_MAX` caratteri.
 */
export async function testoDellaPagina(page: PdfPage): Promise<string> {
  const contenuto = await page.getTextContent();
  let righe = '';
  for (const voce of contenuto.items) {
    if (!('str' in voce)) continue;
    righe += voce.str + (voce.hasEOL ? '\n' : ' ');
    if (righe.length > TESTO_PAGINA_MAX) break;
  }
  return righe
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, TESTO_PAGINA_MAX);
}
