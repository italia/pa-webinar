'use client';

/**
 * Ritaglio di un'immagine nel browser, prima del caricamento: un riquadro
 * nel formato richiesto (per la copertina 16:9), l'immagine che ci si
 * trascina dentro e un cursore per ingrandirla. Il ritaglio si disegna su un
 * canvas alla larghezza richiesta (mai piu' grande dell'originale: niente
 * immagini gonfiate) e torna come JPEG, su fondo bianco per le immagini con
 * trasparenza. Il file originale non lascia il browser.
 *
 * Tastiera: con il fuoco sul riquadro le frecce spostano l'immagine
 * (Maiusc per passi lunghi), + e - la ingrandiscono e la rimpiccioliscono.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { useTranslations } from 'next-intl';
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from 'design-react-kit';

export interface Ritaglio {
  /** Larghezza diviso altezza del riquadro (16/9 per la copertina). */
  rapporto: number;
  /** Larghezza del file prodotto, in pixel, se l'originale basta. */
  larghezza: number;
}

/** Sotto questa larghezza (sul totale richiesto) l'immagine si vede sgranata. */
const SOGLIA_PICCOLA = 0.75;
const ZOOM_MAX = 3;
const PASSO = 10;
const PASSO_LUNGO = 50;

interface Stato {
  /** Ingrandimento rispetto alla misura che copre il riquadro (1 = minimo). */
  zoom: number;
  /** Spostamento dell'immagine nel riquadro, in pixel dello schermo. */
  x: number;
  y: number;
}

/** L'immagine copre sempre tutto il riquadro: lo spostamento resta nei limiti. */
function limita(
  s: Stato,
  lato: { fw: number; fh: number; iw: number; ih: number }
): Stato {
  const scala = Math.max(lato.fw / lato.iw, lato.fh / lato.ih) * s.zoom;
  const w = lato.iw * scala;
  const h = lato.ih * scala;
  return {
    zoom: s.zoom,
    x: Math.min(0, Math.max(lato.fw - w, s.x)),
    y: Math.min(0, Math.max(lato.fh - h, s.y)),
  };
}

export default function ImageCropDialog({
  file,
  ritaglio,
  onConferma,
  onAnnulla,
}: {
  file: File;
  ritaglio: Ritaglio;
  onConferma: (ritagliato: File) => void;
  onAnnulla: () => void;
}) {
  const t = useTranslations('admin.fileOrUrl.crop');
  const tc = useTranslations('common');
  const [url, setUrl] = useState<string | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [errore, setErrore] = useState(false);
  const [stato, setStato] = useState<Stato>({ zoom: 1, x: 0, y: 0 });
  const [riquadro, setRiquadro] = useState<{ fw: number; fh: number } | null>(null);
  const cornice = useRef<HTMLDivElement>(null);
  const trascina = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  // L'immagine si legge dal file scelto, senza caricarla da nessuna parte.
  // Un'immagine lasciata (file cambiato, o il doppio montaggio di React in
  // sviluppo) non scrive piu' nello stato: il suo indirizzo e' gia' revocato.
  useEffect(() => {
    let attiva = true;
    const u = URL.createObjectURL(file);
    setUrl(u);
    setImg(null);
    setErrore(false);
    const i = new Image();
    i.onload = () => {
      if (attiva) setImg(i);
    };
    i.onerror = () => {
      if (attiva) setErrore(true);
    };
    i.src = u;
    return () => {
      attiva = false;
      i.onload = null;
      i.onerror = null;
      URL.revokeObjectURL(u);
    };
  }, [file]);

  // La misura del riquadro segue la finestra (telefono o schermo largo).
  useEffect(() => {
    const el = cornice.current;
    if (!el) return;
    const misura = () => setRiquadro({ fw: el.clientWidth, fh: el.clientHeight });
    misura();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(misura);
    ro.observe(el);
    return () => ro.disconnect();
  }, [img]);

  const lato = useMemo(
    () =>
      img && riquadro
        ? { ...riquadro, iw: img.naturalWidth, ih: img.naturalHeight }
        : null,
    [img, riquadro]
  );

  // All'apertura, e quando cambia il riquadro, l'immagine e' centrata.
  // All'apertura l'immagine e' centrata; se poi il riquadro cambia misura
  // (telefono girato, barra di scorrimento) il ritaglio scelto resta: lo
  // spostamento si riscala con il riquadro.
  const centrata = useRef<HTMLImageElement | null>(null);
  const misuraPrima = useRef<number | null>(null);
  useEffect(() => {
    if (!lato) return;
    if (centrata.current !== img) {
      centrata.current = img;
      const scala = Math.max(lato.fw / lato.iw, lato.fh / lato.ih);
      setStato({
        zoom: 1,
        x: (lato.fw - lato.iw * scala) / 2,
        y: (lato.fh - lato.ih * scala) / 2,
      });
    } else if (misuraPrima.current && misuraPrima.current !== lato.fw) {
      const k = lato.fw / misuraPrima.current;
      setStato((s) => limita({ zoom: s.zoom, x: s.x * k, y: s.y * k }, lato));
    }
    misuraPrima.current = lato.fw;
  }, [img, lato]);

  const aggiorna = useCallback(
    (prossimo: Stato) => {
      if (lato) setStato(limita(prossimo, lato));
    },
    [lato]
  );

  /** Cambia l'ingrandimento tenendo fermo il centro del riquadro. */
  const ingrandisci = (zoom: number) => {
    if (!lato) return;
    const z = Math.min(ZOOM_MAX, Math.max(1, zoom));
    const base = Math.max(lato.fw / lato.iw, lato.fh / lato.ih);
    const prima = base * stato.zoom;
    const dopo = base * z;
    const cx = (lato.fw / 2 - stato.x) / prima;
    const cy = (lato.fh / 2 - stato.y) / prima;
    aggiorna({ zoom: z, x: lato.fw / 2 - cx * dopo, y: lato.fh / 2 - cy * dopo });
  };

  const giu = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    trascina.current = { px: e.clientX, py: e.clientY, x: stato.x, y: stato.y };
  };
  const muovi = (e: PointerEvent<HTMLDivElement>) => {
    const d = trascina.current;
    if (!d) return;
    aggiorna({ zoom: stato.zoom, x: d.x + e.clientX - d.px, y: d.y + e.clientY - d.py });
  };
  const su = () => {
    trascina.current = null;
  };

  const tasti = (e: KeyboardEvent<HTMLDivElement>) => {
    const passo = e.shiftKey ? PASSO_LUNGO : PASSO;
    const mosse: Record<string, [number, number]> = {
      ArrowLeft: [passo, 0],
      ArrowRight: [-passo, 0],
      ArrowUp: [0, passo],
      ArrowDown: [0, -passo],
    };
    if (mosse[e.key]) {
      e.preventDefault();
      const [dx, dy] = mosse[e.key]!;
      aggiorna({ zoom: stato.zoom, x: stato.x + dx, y: stato.y + dy });
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      ingrandisci(stato.zoom + 0.1);
    } else if (e.key === '-') {
      e.preventDefault();
      ingrandisci(stato.zoom - 0.1);
    }
  };

  // Il pezzo d'originale dentro il riquadro, e la misura del file prodotto.
  const scala = lato ? Math.max(lato.fw / lato.iw, lato.fh / lato.ih) * stato.zoom : 1;
  const sorgente = lato
    ? {
        sx: -stato.x / scala,
        sy: -stato.y / scala,
        sw: lato.fw / scala,
        sh: lato.fh / scala,
      }
    : null;
  const larghezzaFinale = sorgente
    ? Math.min(ritaglio.larghezza, Math.round(sorgente.sw))
    : 0;
  const altezzaFinale = Math.round(larghezzaFinale / ritaglio.rapporto);
  const piccola =
    larghezzaFinale > 0 && larghezzaFinale < ritaglio.larghezza * SOGLIA_PICCOLA;

  const [inviando, setInviando] = useState(false);
  // Il ritaglio non si e' potuto preparare (memoria del browser): si riprova.
  const [codificaFallita, setCodificaFallita] = useState(false);
  // Chiusa la finestra mentre il ritaglio si prepara, il risultato non vale.
  const chiusa = useRef(false);
  useEffect(() => {
    // Anche al secondo montaggio di React in sviluppo la finestra e' aperta.
    chiusa.current = false;
    return () => {
      chiusa.current = true;
    };
  }, []);
  const annulla = () => {
    chiusa.current = true;
    onAnnulla();
  };
  const conferma = async () => {
    if (inviando || !img || !sorgente) return;
    setInviando(true);
    setCodificaFallita(false);
    const fallito = () => {
      setInviando(false);
      setCodificaFallita(true);
    };
    const canvas = document.createElement('canvas');
    canvas.width = larghezzaFinale;
    canvas.height = altezzaFinale;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      fallito();
      return;
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      img,
      sorgente.sx,
      sorgente.sy,
      sorgente.sw,
      sorgente.sh,
      0,
      0,
      canvas.width,
      canvas.height
    );
    const blob = await new Promise<Blob | null>((r) =>
      canvas.toBlob(r, 'image/jpeg', 0.9)
    );
    if (chiusa.current) return;
    if (!blob) {
      fallito();
      return;
    }
    const nome = file.name.replace(/\.[^.]+$/, '') || 'copertina';
    onConferma(new File([blob], `${nome}.jpg`, { type: 'image/jpeg' }));
  };

  return (
    <Modal
      isOpen
      toggle={annulla}
      size="lg"
      labelledBy="ritaglio-titolo"
      className="ritaglio-immagine"
    >
      <ModalHeader closeAriaLabel={tc('close')} toggle={annulla}>
        <span id="ritaglio-titolo">{t('title')}</span>
      </ModalHeader>
      <ModalBody>
        <p className="ritaglio-immagine__testo">{t('intro')}</p>
        {errore ? (
          <p className="text-danger" role="alert">
            {t('error')}
          </p>
        ) : (
          <>
            <div
              ref={cornice}
              className="ritaglio-immagine__cornice"
              style={{ aspectRatio: String(ritaglio.rapporto) }}
              tabIndex={0}
              role="group"
              aria-label={t('frame')}
              aria-describedby="ritaglio-tasti"
              onPointerDown={giu}
              onPointerMove={muovi}
              onPointerUp={su}
              onPointerCancel={su}
              onKeyDown={tasti}
            >
              {url && img && lato && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={url}
                  alt=""
                  draggable={false}
                  style={{
                    width: lato.iw * scala,
                    height: lato.ih * scala,
                    transform: `translate(${stato.x}px, ${stato.y}px)`,
                  }}
                />
              )}
            </div>
            <p id="ritaglio-tasti" className="ritaglio-immagine__nota">
              {t('keys')}
            </p>
            <label className="ritaglio-immagine__zoom">
              <span>{t('zoom')}</span>
              <input
                type="range"
                className="form-range"
                min={1}
                max={ZOOM_MAX}
                step={0.01}
                value={stato.zoom}
                onChange={(e) => ingrandisci(Number(e.target.value))}
              />
            </label>
            {codificaFallita && (
              <p className="text-danger mt-2 mb-0" role="alert">
                {t('encodeError')}
              </p>
            )}
            {larghezzaFinale > 0 && (
              <p
                className={`ritaglio-immagine__nota${piccola ? ' ritaglio-immagine__nota--avviso' : ''}`}
              >
                {t('size', { width: larghezzaFinale, height: altezzaFinale })}
                {piccola && <> {t('small')}</>}
              </p>
            )}
          </>
        )}
      </ModalBody>
      <ModalFooter>
        <Button color="secondary" outline onClick={annulla}>
          {t('cancel')}
        </Button>
        <Button
          color="primary"
          onClick={() => void conferma()}
          disabled={!img || errore || inviando}
        >
          {t('confirm')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
