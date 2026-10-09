'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import type { ImageSegmenter } from '@mediapipe/tasks-vision';

import {
  LATO_SEGMENTAZIONE,
  mascheraInAlfa,
  prendiSegmentatore,
  rettangoloCopertura,
  rilasciaSegmentatore,
  ripiegaSulProcessore,
} from '@/lib/live/background-preview';

export type StatoAnteprima = 'spenta' | 'caricamento' | 'pronta' | 'errore';

/** Un fotogramma ogni 45 ms circa: basta per un'anteprima, e lascia respiro
 *  al resto della pagina. */
const INTERVALLO_MS = 45;
/** Lato più lungo della tela: oltre non si vede differenza in un riquadro. */
const LATO_MAX = 640;
/** Fotogrammi falliti di fila dopo i quali si cambia strada. */
const ERRORI_MAX = 10;

/**
 * Disegna sulla tela il video della videocamera con lo sfondo scelto al posto
 * di quello vero (vedi lib/live/background-preview).
 *
 * Il motore si carica la prima volta che serve (uno sfondo scelto e la
 * videocamera accesa) e resta fino allo smontaggio: cambiare sfondo, spegnere
 * e riaccendere la camera o cambiare periferica non lo ricarica. Lo sfondo si
 * scambia al volo, appena l'immagine nuova è pronta.
 */
export function useAnteprimaSfondo({
  videoRef,
  canvasRef,
  sfondoUrl,
  attiva,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  sfondoUrl: string | null;
  attiva: boolean;
}): StatoAnteprima {
  const [stato, setStato] = useState<StatoAnteprima>('spenta');
  const [segmentatore, setSegmentatore] = useState<ImageSegmenter | null>(null);
  const [richiesto, setRichiesto] = useState(false);
  const [guasto, setGuasto] = useState(false);
  // Il ripiego sul processore: incrementato, fa ricaricare il motore.
  const [generazione, setGenerazione] = useState(0);
  const immagineRef = useRef<HTMLImageElement | null>(null);

  const serve = attiva && !!sfondoUrl;
  // Il motore si chiede la prima volta che serve, e non si richiede più.
  useEffect(() => {
    if (serve) setRichiesto(true);
  }, [serve]);

  // Il motore: preso una volta, rilasciato allo smontaggio (o al ripiego).
  useEffect(() => {
    if (!richiesto) return;
    let annullato = false;
    const promessa = prendiSegmentatore();
    promessa.then(
      (s) => {
        if (!annullato) setSegmentatore(s);
      },
      () => {
        if (!annullato) setGuasto(true);
      },
    );
    return () => {
      annullato = true;
      setSegmentatore(null);
      rilasciaSegmentatore();
    };
  }, [richiesto, generazione]);

  // Lo sfondo: l'immagine nuova sostituisce la vecchia solo quando è pronta,
  // così l'anteprima non resta mai senza.
  useEffect(() => {
    if (!sfondoUrl) return;
    let annullato = false;
    const immagine = new Image();
    immagine.src = sfondoUrl;
    immagine
      .decode()
      .then(() => {
        if (!annullato) immagineRef.current = immagine;
      })
      .catch(() => {
        if (!annullato) setGuasto(true);
      });
    return () => {
      annullato = true;
    };
  }, [sfondoUrl]);

  // Il disegno, finché l'anteprima serve e il motore c'è.
  useEffect(() => {
    if (guasto) {
      setStato('errore');
      return;
    }
    if (!serve) {
      setStato('spenta');
      return;
    }
    if (!segmentatore) {
      setStato('caricamento');
      return;
    }
    let annullato = false;
    let frame: number | null = null;
    let ultimo = 0;
    let istante = 0;
    let errori = 0;
    let primo = true;

    // Il fotogramma ridotto che si dà al segmentatore, e la maschera.
    const piccola = document.createElement('canvas');
    const ctxPiccola = piccola.getContext('2d', { willReadFrequently: false });
    const maschera = document.createElement('canvas');
    const ctxMaschera = maschera.getContext('2d');
    let pixel: ImageData | null = null;

    const disegna = () => {
      frame = null;
      if (annullato) return;
      const video = videoRef.current;
      const tela = canvasRef.current;
      const ctx = tela?.getContext('2d');
      const immagine = immagineRef.current;
      const ora = performance.now();
      if (
        video && tela && ctx && ctxPiccola && ctxMaschera && immagine &&
        video.readyState >= 2 && video.videoWidth > 0 && ora - ultimo >= INTERVALLO_MS
      ) {
        ultimo = ora;
        // Il segmentatore vuole istanti sempre crescenti.
        istante = Math.max(istante + 1, Math.round(ora));
        const scalaP = LATO_SEGMENTAZIONE / Math.max(video.videoWidth, video.videoHeight);
        const pw = Math.max(1, Math.round(video.videoWidth * scalaP));
        const ph = Math.max(1, Math.round(video.videoHeight * scalaP));
        if (piccola.width !== pw || piccola.height !== ph) {
          piccola.width = pw;
          piccola.height = ph;
        }
        ctxPiccola.drawImage(video, 0, 0, pw, ph);
        try {
          segmentatore.segmentForVideo(piccola, istante, (risultato) => {
            const m = risultato.confidenceMasks?.[0];
            if (!m) return;
            // La tela alla misura del riquadro (fino a LATO_MAX).
            const dpr = window.devicePixelRatio || 1;
            const scala = Math.min(1, LATO_MAX / Math.max(1, tela.clientWidth * dpr, tela.clientHeight * dpr));
            const W = Math.max(1, Math.round(tela.clientWidth * dpr * scala));
            const H = Math.max(1, Math.round(tela.clientHeight * dpr * scala));
            if (tela.width !== W || tela.height !== H) {
              tela.width = W;
              tela.height = H;
            }
            if (maschera.width !== m.width || maschera.height !== m.height || !pixel) {
              maschera.width = m.width;
              maschera.height = m.height;
              pixel = ctxMaschera.createImageData(m.width, m.height);
            }
            mascheraInAlfa(m.getAsFloat32Array(), pixel.data);
            ctxMaschera.putImageData(pixel, 0, 0);

            // La stessa inquadratura del video (object-fit: cover); la
            // maschera copre l'intero fotogramma, ridotto.
            const v = rettangoloCopertura(video.videoWidth, video.videoHeight, W, H);
            const kx = m.width / video.videoWidth;
            const ky = m.height / video.videoHeight;
            ctx.clearRect(0, 0, W, H);
            // La maschera ingrandita è già morbida; dove il browser lo
            // permette, la si sfuma ancora un poco.
            ctx.save();
            ctx.imageSmoothingEnabled = true;
            ctx.filter = 'blur(2px)';
            ctx.drawImage(maschera, v.sx * kx, v.sy * ky, v.sw * kx, v.sh * ky, 0, 0, W, H);
            ctx.restore();
            // La persona dentro la maschera, lo sfondo dietro.
            ctx.globalCompositeOperation = 'source-in';
            ctx.drawImage(video, v.sx, v.sy, v.sw, v.sh, 0, 0, W, H);
            ctx.globalCompositeOperation = 'destination-over';
            const b = rettangoloCopertura(immagine.naturalWidth, immagine.naturalHeight, W, H);
            ctx.drawImage(immagine, b.sx, b.sy, b.sw, b.sh, 0, 0, W, H);
            ctx.globalCompositeOperation = 'source-over';
            errori = 0;
            if (primo && !annullato) {
              primo = false;
              setStato('pronta');
            }
          });
        } catch {
          // Un fotogramma andato storto si salta; molti di fila vogliono dire
          // che la scheda grafica non regge: si riprova sul processore, e se
          // anche lì non va l'anteprima qui non è disponibile.
          errori += 1;
          if (errori >= ERRORI_MAX) {
            if (ripiegaSulProcessore()) setGenerazione((g) => g + 1);
            else setGuasto(true);
            return;
          }
        }
      }
      frame = requestAnimationFrame(disegna);
    };
    setStato('caricamento');
    frame = requestAnimationFrame(disegna);

    return () => {
      annullato = true;
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [serve, segmentatore, guasto, videoRef, canvasRef]);

  return stato;
}
