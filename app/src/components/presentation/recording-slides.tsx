'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { useTranslations } from 'next-intl';

import type { VideoPlayerHandle } from '@/components/events/video-player';
import { Icon } from '@/components/ui/icon';
import {
  chapterIndexes,
  cuePosition,
  type SlideCue,
  type SlideMaterialView,
} from '@/lib/presentation/recording-slides';
import { formatVideoTime } from '@/lib/utils/video-time';

import {
  copiaPagina,
  disegnaFuoriSchermo,
  openPdf,
  testoDellaPagina,
  type PdfDocument,
  type PdfLoadingTask,
} from './pdf-loader';

interface RecordingSlidesProps {
  playerRef: RefObject<VideoPlayerHandle | null>;
  cues: readonly SlideCue[];
  materials: readonly SlideMaterialView[];
  /** Il livello del titolo del riquadro, secondo la pagina che lo ospita. */
  headingLevel?: 2 | 3;
}

/**
 * Un piccolo margine oltre l'inizio del tratto quando ci si salta: un
 * browser che arrotonda il tempo al fotogramma precedente mostrerebbe ancora
 * la slide di prima.
 */
const SALTO_MARGINE_SEC = 0.05;

/** «Slide precedente» entro questi secondi dall'inizio della slide va a quella prima. */
const INDIETRO_SOGLIA_SEC = 2;

/**
 * Un effetto che nel browser gira prima che la pagina si ridisegni: quando i
 * tratti cambiano (l'anteprima dello staff a ogni correzione) la posizione si
 * ricalcola prima che si veda la slide sbagliata. Sul server non c'è niente da
 * seguire.
 */
const useEffettoPrimaDelDisegno =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Dove si trova il video rispetto ai tratti (`cuePosition`). */
type Posizione = ReturnType<typeof cuePosition>;

/**
 * Segue il tempo del video: a ogni aggiornamento, salto e caricamento, e a
 * ogni fotogramma mentre riproduce, così la slide cambia nell'istante in cui
 * cambiava in sala e non fino a un quarto di secondo dopo.
 */
function usePosizioneNelVideo(
  playerRef: RefObject<VideoPlayerHandle | null>,
  cues: readonly SlideCue[]
): { posizione: Posizione; durata: number | null } {
  // Prima che il video si colleghi vale l'istante zero: lo stesso sul server e
  // nel browser, e la slide d'apertura c'è già nel primo disegno.
  const [posizione, setPosizione] = useState<Posizione>(() => cuePosition(cues, 0));
  const [durata, setDurata] = useState<number | null>(null);
  // Il video può non esserci ancora al primo giro: si riprova poco dopo.
  const [tentativo, setTentativo] = useState(0);

  useEffettoPrimaDelDisegno(() => {
    const v = playerRef.current?.videoEl?.() ?? null;
    if (!v) {
      if (tentativo > 40) return undefined;
      const timer = setTimeout(() => setTentativo((n) => n + 1), 250);
      return () => clearTimeout(timer);
    }
    let frame: number | null = null;
    const aggiorna = () => {
      const p = cuePosition(cues, v.currentTime || 0);
      setPosizione((prima) =>
        prima.last === p.last && prima.active === p.active ? prima : p
      );
    };
    const leggiDurata = () => {
      setDurata(Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null);
    };
    const ciclo = () => {
      aggiorna();
      frame = window.requestAnimationFrame(ciclo);
    };
    const avvia = () => {
      if (frame === null) frame = window.requestAnimationFrame(ciclo);
    };
    const ferma = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
      aggiorna();
    };
    const eventi = ['timeupdate', 'seeked', 'seeking', 'loadedmetadata'];
    const eventiDurata = ['loadedmetadata', 'durationchange'];
    for (const e of eventi) v.addEventListener(e, aggiorna);
    for (const e of eventiDurata) v.addEventListener(e, leggiDurata);
    v.addEventListener('play', avvia);
    v.addEventListener('pause', ferma);
    v.addEventListener('ended', ferma);
    aggiorna();
    leggiDurata();
    if (!v.paused) avvia();
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      for (const e of eventi) v.removeEventListener(e, aggiorna);
      for (const e of eventiDurata) v.removeEventListener(e, leggiDurata);
      v.removeEventListener('play', avvia);
      v.removeEventListener('pause', ferma);
      v.removeEventListener('ended', ferma);
    };
  }, [playerRef, cues, tentativo]);

  return { posizione, durata };
}

/** Il riquadro misurato per adattarvi la pagina. */
interface Misura {
  w: number;
  h: number;
}

/**
 * Le slide presentate in sala accanto alla registrazione, sincronizzate con
 * il tempo del video: a ogni istante la pagina che la sala vedeva in quel
 * momento, nessuna dove non si presentava nulla.
 *
 * I tratti arrivano già calcolati (lib/presentation/recording-slides): qui si
 * segue il video, si scarica ogni documento una volta sola e si disegna la
 * pagina con pdf.js. L'elenco delle slide e i pulsanti «precedente» e
 * «successiva» spostano il video, non la slide: la slide segue il video.
 * La pagina mostrata si annuncia ai lettori di schermo senza interrompere,
 * ha un testo alternativo con il numero e il titolo, e il suo testo si legge
 * sotto la slide.
 */
export default function RecordingSlides({
  playerRef,
  cues,
  materials,
  headingLevel = 2,
}: RecordingSlidesProps) {
  const t = useTranslations('recordingSlides');
  const { posizione, durata } = usePosizioneNelVideo(playerRef, cues);
  const corrente = posizione.active ? cues[posizione.last]! : null;
  const prossimo = cues[posizione.last + 1] ?? null;
  const perId = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);
  const piuDocumenti = materials.length > 1;

  // Il documento da tenere pronto: quello a schermo, o il prossimo che verrà.
  const daCaricare = corrente?.materialId ?? prossimo?.materialId ?? null;
  const materiale = corrente ? (perId.get(corrente.materialId) ?? null) : null;

  const documentiRef = useRef(new Map<string, Promise<PdfDocument>>());
  const compitiRef = useRef<PdfLoadingTask[]>([]);
  const vivoRef = useRef(true);
  const [documenti, setDocumenti] = useState<Record<string, PdfDocument>>({});
  const [errori, setErrori] = useState<Record<string, true>>({});
  const [tentativo, setTentativo] = useState(0);

  // Andando via dalla pagina si chiudono i documenti aperti.
  useEffect(() => {
    vivoRef.current = true;
    const documentiAperti = documentiRef.current;
    return () => {
      vivoRef.current = false;
      for (const c of compitiRef.current) void c.destroy();
      compitiRef.current = [];
      documentiAperti.clear();
    };
  }, []);

  // ── I documenti: ciascuno scaricato una volta sola ──────────────────────
  // Restano in memoria: quando il video torna su un documento già visto, la
  // slide compare subito.
  useEffect(() => {
    if (!daCaricare) return;
    const m = perId.get(daCaricare);
    if (!m || documentiRef.current.has(m.id)) return;
    // Un errore di prima non vale per questo nuovo tentativo.
    setErrori((e) => {
      if (!e[m.id]) return e;
      const { [m.id]: _tolto, ...resto } = e;
      return resto;
    });
    const promessa = (async () => {
      const res = await fetch(m.fileUrl, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const dati = new Uint8Array(await res.arrayBuffer());
      const compito = await openPdf(dati);
      if (!vivoRef.current) {
        void compito.destroy();
        throw new Error('riquadro chiuso');
      }
      compitiRef.current.push(compito);
      return compito.promise;
    })();
    documentiRef.current.set(m.id, promessa);
    promessa.then(
      (doc) => {
        if (vivoRef.current) setDocumenti((d) => ({ ...d, [m.id]: doc }));
      },
      () => {
        // Al prossimo tentativo si riscarica.
        documentiRef.current.delete(m.id);
        if (vivoRef.current) setErrori((e) => ({ ...e, [m.id]: true }));
      }
    );
  }, [daCaricare, perId, tentativo]);

  const documento = corrente ? (documenti[corrente.materialId] ?? null) : null;
  const inErrore = !!corrente && !!errori[corrente.materialId] && !documento;
  const totale = documento?.numPages ?? null;
  const pagina = corrente
    ? totale
      ? Math.min(corrente.page, totale)
      : corrente.page
    : null;

  // ── Misura del riquadro ──────────────────────────────────────────────────
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [misura, setMisura] = useState<Misura>({ w: 0, h: 0 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    const osserva = new ResizeObserver((voci) => {
      const box = voci[0]?.contentRect;
      if (!box) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const w = Math.floor(box.width);
        const h = Math.floor(box.height);
        setMisura((prima) =>
          Math.abs(prima.w - w) < 2 && Math.abs(prima.h - h) < 2 ? prima : { w, h }
        );
      });
    });
    osserva.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      osserva.disconnect();
    };
  }, []);

  // ── Disegno della pagina ─────────────────────────────────────────────────
  const [disegnata, setDisegnata] = useState<string | null>(null);
  // Il testo di una slide, con la slide a cui appartiene.
  const [testo, setTesto] = useState<{ chiave: string; testo: string } | null>(null);
  useEffect(() => {
    if (!documento || pagina === null || misura.w <= 0 || misura.h <= 0) return;
    let annullato = false;
    let disegno: { cancel: () => void } | null = null;
    const chiave = `${corrente?.materialId}:${pagina}`;
    void (async () => {
      try {
        const page = await documento.getPage(pagina);
        if (annullato) return;
        // Fuori schermo e poi copiata (pdf-loader): la slide di prima resta
        // visibile finché la nuova non è pronta, senza lampi bianchi.
        const fatta = await disegnaFuoriSchermo(
          page,
          { w: misura.w, h: misura.h },
          (c) => {
            disegno = c;
          }
        );
        const canvas = canvasRef.current;
        if (annullato || !canvas) return;
        copiaPagina(fatta, canvas);
        setDisegnata(chiave);

        // Il testo della slide, per chi usa un lettore di schermo o vuole
        // copiarlo: la slide è un'immagine.
        const testoPagina = await testoDellaPagina(page);
        if (annullato) return;
        setTesto({ chiave, testo: testoPagina });
      } catch {
        // Disegno annullato da una slide più recente, o pagina illeggibile:
        // resta quella di prima.
      }
    })();
    return () => {
      annullato = true;
      disegno?.cancel();
    };
  }, [documento, pagina, misura.w, misura.h, corrente?.materialId]);

  // ── Navigazione: sposta il video ─────────────────────────────────────────
  const capitoli = useMemo(
    () => chapterIndexes(cues, { videoDurationSec: durata }),
    [cues, durata]
  );
  const vaiA = useCallback(
    (sec: number) => {
      // Senza far partire il video: chi lo guardava continua, chi l'aveva
      // fermo vede la slide e il fotogramma.
      playerRef.current?.seekTo(sec + SALTO_MARGINE_SEC, false);
    },
    [playerRef]
  );
  const adesso = () => playerRef.current?.currentTime() ?? 0;
  const precedente = () => {
    const ora = adesso();
    const prima = capitoli
      .map((i) => cues[i]!)
      .filter((c) => c.start < ora - INDIETRO_SOGLIA_SEC);
    const c = prima[prima.length - 1];
    if (c) vaiA(c.start);
  };
  const successiva = () => {
    const ora = adesso();
    const c = capitoli
      .map((i) => cues[i]!)
      .find((x) => x.start > ora + SALTO_MARGINE_SEC);
    if (c) vaiA(c.start);
  };
  const primaDelPrimo = capitoli.length > 0 && posizione.last < capitoli[0]!;
  const dopoLUltimo =
    capitoli.length > 0 && posizione.last >= capitoli[capitoli.length - 1]!;

  // L'elenco aperto segue la slide in corso, senza spostare la pagina.
  const listaRef = useRef<HTMLOListElement>(null);
  const [elencoAperto, setElencoAperto] = useState(false);
  useEffect(() => {
    const lista = listaRef.current;
    if (!elencoAperto || !lista) return;
    const voce = lista.querySelector<HTMLElement>('[aria-current="true"]');
    if (!voce) return;
    lista.scrollTop = Math.max(
      0,
      voce.offsetTop - lista.clientHeight / 2 + voce.offsetHeight / 2
    );
  }, [elencoAperto, posizione.last]);

  const titoloId = useId();
  const Titolo = headingLevel === 3 ? 'h3' : 'h2';

  const nomeSlide = (c: SlideCue, tot: number | null) => {
    const titolo = perId.get(c.materialId)?.title || t('untitled');
    return tot
      ? t('slideOf', { page: Math.min(c.page, tot), total: tot, title: titolo })
      : t('slideOnly', { page: c.page, title: titolo });
  };
  // Il testo alternativo della slide: il numero e il titolo.
  const descrizione = corrente ? nomeSlide(corrente, totale) : '';
  const chiaveCorrente = corrente ? `${corrente.materialId}:${pagina}` : null;
  const pronta = !!chiaveCorrente && disegnata === chiaveCorrente;
  const testoCorrente = testo && testo.chiave === chiaveCorrente ? testo.testo : null;
  const caricando = !!corrente && !documento && !inErrore;

  return (
    <section className="recording-slides" aria-labelledby={titoloId}>
      <header className="recording-slides__bar">
        <Icon
          icon="it-presentation"
          size="sm"
          className="recording-slides__icon"
          aria-hidden="true"
        />
        <div className="recording-slides__heading">
          <Titolo className="recording-slides__title" id={titoloId}>
            {t('title')}
          </Titolo>
          {materiale && (
            <p className="recording-slides__doc">{materiale.title || t('untitled')}</p>
          )}
        </div>
      </header>
      {/* Il documento a schermo, annunciato quando compare o cambia; la
          pagina la annuncia l'indicatore. */}
      <p className="visually-hidden" aria-live="polite">
        {materiale ? t('nowShowing', { title: materiale.title || t('untitled') }) : ''}
      </p>

      <div className="recording-slides__canvas-wrap" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className={`recording-slides__canvas${pronta ? '' : ' is-hidden'}`}
          role="img"
          aria-label={descrizione || t('title')}
          aria-hidden={pronta ? undefined : true}
        />
        {!corrente && (
          <div className="recording-slides__status">
            <p className="mb-2">
              {primaDelPrimo ? t('notYet') : dopoLUltimo ? t('noMore') : t('noSlideNow')}
            </p>
            {prossimo && (
              <button
                type="button"
                className="recording-slides__btn recording-slides__btn--text"
                onClick={() => vaiA(prossimo.start)}
              >
                {t('goToNext', { time: formatVideoTime(prossimo.start) })}
              </button>
            )}
          </div>
        )}
        {caricando && (
          <div className="recording-slides__status" role="status">
            <span className="recording-slides__spinner" aria-hidden="true" />
            {t('loading')}
          </div>
        )}
        {inErrore && (
          <div className="recording-slides__status" role="alert">
            <p className="mb-2">{t('loadError')}</p>
            <button
              type="button"
              className="recording-slides__btn recording-slides__btn--text"
              onClick={() => {
                setErrori({});
                setTentativo((n) => n + 1);
              }}
            >
              {t('retry')}
            </button>
          </div>
        )}
      </div>

      <div className="recording-slides__controls">
        <button
          type="button"
          className="recording-slides__btn"
          onClick={precedente}
          disabled={capitoli.length === 0 || primaDelPrimo}
          aria-label={t('previous')}
          title={t('previous')}
        >
          <Icon icon="it-chevron-left" size="sm" aria-hidden="true" />
        </button>
        {/* La slide in corso, annunciata senza interrompere a ogni cambio. */}
        <p className="recording-slides__indicator" aria-live="polite" aria-atomic="true">
          {corrente
            ? totale
              ? t('pageOf', { page: pagina!, total: totale })
              : t('pageOnly', { page: corrente.page })
            : t('noSlideShort')}
        </p>
        <button
          type="button"
          className="recording-slides__btn"
          onClick={successiva}
          disabled={capitoli.length === 0 || dopoLUltimo}
          aria-label={t('next')}
          title={t('next')}
        >
          <Icon icon="it-chevron-right" size="sm" aria-hidden="true" />
        </button>
        {materiale?.downloadName && (
          <a
            className="recording-slides__download"
            href={materiale.fileUrl}
            download={materiale.downloadName}
            aria-label={t('downloadNamed', { title: materiale.title || t('untitled') })}
          >
            <Icon icon="it-download" size="sm" aria-hidden="true" />
            <span>{t('download')}</span>
          </a>
        )}
      </div>

      {pronta && testoCorrente !== null && (
        <details className="recording-slides__text">
          <summary>{t('pageText')}</summary>
          <p>{testoCorrente || t('pageTextEmpty')}</p>
        </details>
      )}

      {capitoli.length > 0 && (
        <details
          className="recording-slides__list"
          onToggle={(e) => setElencoAperto((e.currentTarget as HTMLDetailsElement).open)}
        >
          <summary>{t('listTitle', { count: capitoli.length })}</summary>
          <ol className="recording-slides__chapters" ref={listaRef}>
            {capitoli.map((i) => {
              const c = cues[i]!;
              const attuale = posizione.active && posizione.last === i;
              return (
                <li key={`${c.materialId}-${c.start}`}>
                  <button
                    type="button"
                    className={`recording-slides__chapter${attuale ? ' is-current' : ''}`}
                    aria-current={attuale ? 'true' : undefined}
                    onClick={() => vaiA(c.start)}
                  >
                    <span className="recording-slides__chapter-time">
                      {formatVideoTime(c.start)}
                    </span>
                    <span className="recording-slides__chapter-page">
                      {t('chapterPage', { page: c.page })}
                    </span>
                    {piuDocumenti && (
                      <span className="recording-slides__chapter-doc">
                        {perId.get(c.materialId)?.title || t('untitled')}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
        </details>
      )}

      <p className="recording-slides__note">{t('note')}</p>
    </section>
  );
}
