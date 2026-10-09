/**
 * L'anteprima dello sfondo virtuale nella sala d'attesa: la persona ritagliata
 * dal video della propria videocamera e disegnata davanti allo sfondo scelto.
 *
 * Il ritaglio lo fa MediaPipe (Image Segmenter, modello «selfie» orizzontale)
 * nel browser: nessun fotogramma lascia il dispositivo. Il motore e il modello
 * sono serviti dal portale (`/vendor/mediapipe/`, copiato da node_modules a
 * ogni installazione, e `/models/selfie-segmentation/`), senza CDN, e si
 * scaricano solo quando qualcuno sceglie uno sfondo.
 *
 * È solo un'anteprima: nella sala l'effetto lo applica Jitsi con il proprio
 * motore (vedi lib/jitsi/virtual-background).
 */

import type { ImageSegmenter } from '@mediapipe/tasks-vision';

export const PERCORSO_WASM = '/vendor/mediapipe';
export const PERCORSO_MODELLO = '/models/selfie-segmentation/selfie_segmenter_landscape.tflite';

/** Il rettangolo della sorgente da disegnare per riempire la destinazione
 *  tagliando i bordi in eccesso, come `object-fit: cover`. */
export function rettangoloCopertura(
  sorgenteW: number,
  sorgenteH: number,
  destW: number,
  destH: number,
): { sx: number; sy: number; sw: number; sh: number } {
  if (sorgenteW <= 0 || sorgenteH <= 0 || destW <= 0 || destH <= 0) {
    return { sx: 0, sy: 0, sw: Math.max(0, sorgenteW), sh: Math.max(0, sorgenteH) };
  }
  const scala = Math.max(destW / sorgenteW, destH / sorgenteH);
  const sw = destW / scala;
  const sh = destH / scala;
  return { sx: (sorgenteW - sw) / 2, sy: (sorgenteH - sh) / 2, sw, sh };
}

/** La maschera di confidenza (0 = sfondo, 1 = persona) come canale alfa di
 *  un'immagine bianca: disegnata su una tela, ritaglia la persona. */
export function mascheraInAlfa(confidenza: Float32Array, pixel: Uint8ClampedArray): void {
  const n = Math.min(confidenza.length, pixel.length / 4);
  for (let i = 0; i < n; i++) {
    const c = confidenza[i] ?? 0;
    const o = i * 4;
    pixel[o] = 255;
    pixel[o + 1] = 255;
    pixel[o + 2] = 255;
    pixel[o + 3] = c <= 0 ? 0 : c >= 1 ? 255 : Math.round(c * 255);
  }
}

/** Il lato lungo del fotogramma che si dà al segmentatore: la misura del
 *  modello orizzontale (256×144). Ritagliare a piena risoluzione costerebbe
 *  molto di più senza un'anteprima migliore: la maschera si ingrandisce e si
 *  sfuma dopo. */
export const LATO_SEGMENTAZIONE = 256;

// Un segmentatore per pagina, condiviso fra le anteprime e chiuso quando
// l'ultima smette di usarlo: il motore occupa parecchia memoria, e in sala
// lavora già quello di Jitsi.
let inCorso: Promise<ImageSegmenter> | null = null;
let utenti = 0;
// Dopo un guasto della scheda grafica si resta sul processore.
let soloProcessore = false;

async function crea(): Promise<ImageSegmenter> {
  const { FilesetResolver, ImageSegmenter: Segmentatore } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(PERCORSO_WASM);
  const opzioni = (delegate: 'GPU' | 'CPU') => ({
    baseOptions: { modelAssetPath: PERCORSO_MODELLO, delegate },
    runningMode: 'VIDEO' as const,
    outputCategoryMask: false,
    outputConfidenceMasks: true,
  });
  if (soloProcessore) return Segmentatore.createFromOptions(fileset, opzioni('CPU'));
  // La scheda grafica quando c'è, altrimenti il processore.
  try {
    return await Segmentatore.createFromOptions(fileset, opzioni('GPU'));
  } catch {
    soloProcessore = true;
    return Segmentatore.createFromOptions(fileset, opzioni('CPU'));
  }
}

/** Il segmentatore condiviso; ogni chiamata va pareggiata da `rilascia`. */
export function prendiSegmentatore(): Promise<ImageSegmenter> {
  utenti += 1;
  if (!inCorso) {
    const questo: Promise<ImageSegmenter> = crea().catch((e: unknown) => {
      // Solo se è ancora lui: un caricamento vecchio che fallisce tardi non
      // deve cancellare quello nuovo.
      if (inCorso === questo) inCorso = null;
      throw e;
    });
    inCorso = questo;
  }
  return inCorso;
}

export function rilasciaSegmentatore(): void {
  utenti = Math.max(0, utenti - 1);
  if (utenti > 0 || !inCorso) return;
  const daChiudere = inCorso;
  inCorso = null;
  void daChiudere.then((s) => s.close()).catch(() => {});
}

/**
 * Il segmentatore creato sulla scheda grafica si è rotto mentre lavorava
 * (contesto WebGL perso, driver inaffidabile): si chiude e il prossimo si
 * crea sul processore. Restituisce false se era già sul processore.
 */
export function ripiegaSulProcessore(): boolean {
  if (soloProcessore) return false;
  soloProcessore = true;
  const daChiudere = inCorso;
  inCorso = null;
  void daChiudere?.then((s) => s.close()).catch(() => {});
  return true;
}
