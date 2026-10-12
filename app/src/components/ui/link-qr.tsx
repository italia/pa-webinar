'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Il codice QR di un link da dare a voce o su carta: chi lo inquadra con la
 * fotocamera del telefono apre il link senza digitarlo. Serve quando il
 * pubblico e' nella stessa sala di chi presenta (un QR proiettato o stampato
 * per entrare come ospite).
 *
 * Il codice si disegna qui, in SVG, da `qrcode-generator`, caricata solo
 * quando si apre un codice: nessun servizio esterno vede il link, e la sala
 * non la scarica per chi non la usa. Mai per un link che porta un token: chi fotografa lo
 * schermo avrebbe la credenziale.
 */

/** Il bordo bianco attorno al codice, in moduli: quattro, come chiede lo standard. */
const MARGINE = 4;

export interface DisegnoQr {
  /** Il lato del codice in moduli, bordo compreso. */
  lato: number;
  /** Le celle scure come un solo percorso SVG. */
  d: string;
}

/** Il link come lo scrive il browser, o null se non e' un indirizzo assoluto. */
function linkAssoluto(link: string): string | null {
  try {
    const url = new URL(link);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Le celle scure del codice, una striscia per ogni tratto scuro di una riga.
 * Il link passa da `URL` prima: i caratteri fuori dall'ASCII diventano
 * sequenze `%..`, che ogni lettore legge allo stesso modo (la libreria, di
 * suo, codifica un byte per carattere). Null per un link che non e' un
 * indirizzo web assoluto, che il telefono non aprirebbe, o troppo lungo per un
 * codice.
 */
export async function disegnoQr(link: string): Promise<DisegnoQr | null> {
  const testo = linkAssoluto(link);
  if (!testo) return null;
  const { default: qrcode } = await import('qrcode-generator');
  const qr = qrcode(0, 'M');
  try {
    qr.addData(testo, 'Byte');
    qr.make();
  } catch {
    return null;
  }
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!qr.isDark(r, c)) {
        c++;
        continue;
      }
      const inizio = c;
      while (c < n && qr.isDark(r, c)) c++;
      d += `M${inizio + MARGINE} ${r + MARGINE}h${c - inizio}v1h-${c - inizio}z`;
    }
  }
  return { lato: n + 2 * MARGINE, d };
}

/** Il file SVG da scaricare: nero su bianco, con il suo bordo. */
export function fileSvgQr({ lato, d }: DisegnoQr): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lato} ${lato}" ` +
    `width="${lato * 10}" height="${lato * 10}" shape-rendering="crispEdges">` +
    `<rect width="${lato}" height="${lato}" fill="#fff"/>` +
    `<path d="${d}" fill="#000"/></svg>\n`
  );
}

/**
 * Il nome del file scaricato: lo stesso per lo stesso link, dall'area di
 * amministrazione e dalla sala.
 */
export function nomeFileQr(slug: string, link: 'pagina' | 'sala'): string {
  return link === 'sala' ? `qr-${slug}-live` : `qr-${slug}`;
}

function GlifoQr() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" />
    </svg>
  );
}

export default function LinkQr({
  url,
  nome,
  nomeFile,
  className = 'btn btn-outline-primary btn-sm d-inline-flex align-items-center gap-1',
  onApertura,
}: {
  url: string;
  /** Il nome del link, come lo legge chi guarda («Link per partecipare»). */
  nome: string;
  /** Il nome del file scaricato, senza estensione (`nomeFileQr`). */
  nomeFile: string;
  className?: string;
  /** Il codice si apre e si chiude: chi lo ospita sa quando Esc e' suo. */
  onApertura?: (aperto: boolean) => void;
}) {
  const t = useTranslations('common.qr');
  const tc = useTranslations('common');
  const dialogo = useRef<HTMLDialogElement>(null);
  // Il clic sullo sfondo chiude solo se e' cominciato sullo sfondo: chi
  // seleziona l'indirizzo e rilascia fuori dal riquadro non lo chiude.
  const premutoSulloSfondo = useRef(false);
  const titoloId = useId();
  // Il codice si calcola quando lo si apre, e il dialogo si apre dopo che c'e':
  // aperto vuoto e poi riempito cambierebbe misura sotto gli occhi di chi
  // guarda, e il pulsante col fuoco si sposterebbe.
  // Il codice e il link da cui viene, insieme: il testo sotto il codice dice
  // sempre quello che il codice apre.
  const [codice, setCodice] = useState<{
    disegno: DisegnoQr | null;
    link: string;
  } | null>(null);
  const disegno = codice?.disegno ?? null;
  const [daAprire, setDaAprire] = useState(false);
  const aperto = useRef(false);
  const onAperturaRef = useRef(onApertura);
  onAperturaRef.current = onApertura;

  const segnala = useCallback((valore: boolean) => {
    if (aperto.current === valore) return;
    aperto.current = valore;
    onAperturaRef.current?.(valore);
  }, []);

  useEffect(() => {
    if (!daAprire) return;
    setDaAprire(false);
    const d = dialogo.current;
    if (!d) return;
    // Un browser senza <dialog> modale lo mostra comunque, aperto nella
    // pagina: meglio di un errore che porta via la sala.
    if (typeof d.showModal === 'function') d.showModal();
    else d.setAttribute('open', '');
    segnala(true);
  }, [daAprire, segnala]);

  // Chi ospita il codice puo' sparire con il codice aperto (il fumetto della
  // sala si chiude): il dialogo se ne va senza l'evento close, e va detto.
  useEffect(() => () => segnala(false), [segnala]);

  const apri = useCallback(async () => {
    // Lo stesso link di prima: il codice c'e' gia'.
    if (codice?.link === url) {
      setDaAprire(true);
      return;
    }
    let nuovo: DisegnoQr | null = null;
    try {
      nuovo = await disegnoQr(url);
    } catch {
      // La libreria non si e' caricata (una pagina rimasta aperta durante
      // un aggiornamento): lo dice il dialogo, al posto del codice.
    }
    setCodice(nuovo ? { disegno: nuovo, link: url } : { disegno: null, link: url });
    setDaAprire(true);
  }, [codice, url]);
  const chiudi = useCallback(() => {
    const d = dialogo.current;
    if (!d) return;
    if (typeof d.close === 'function') d.close();
    else {
      d.removeAttribute('open');
      segnala(false);
    }
  }, [segnala]);

  const scarica = useCallback(() => {
    if (!disegno) return;
    const blob = new Blob([fileSvgQr(disegno)], { type: 'image/svg+xml' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = `${nomeFile}.svg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Alcuni browser leggono il file dopo il clic, mentre chiedono dove
    // salvarlo: l'indirizzo resta valido per un minuto.
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
  }, [disegno, nomeFile]);

  // Un link che il telefono non aprirebbe non ha un codice.
  if (!linkAssoluto(url)) return null;

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => void apri()}
        aria-haspopup="dialog"
        // Il nome dice di QUALE link: piu' pulsanti «QR» uno sotto l'altro, a
        // voce, sarebbero indistinguibili. Comincia con il testo visibile.
        aria-label={t('buttonLabel', { name: nome })}
      >
        <GlifoQr />
        <span aria-hidden="true">{t('button')}</span>
      </button>

      <dialog
        ref={dialogo}
        className="link-qr"
        aria-labelledby={titoloId}
        onClose={() => segnala(false)}
        onPointerDown={(e) => {
          premutoSulloSfondo.current = e.target === dialogo.current;
        }}
        // Un clic sullo sfondo (il dialogo stesso, fuori dal contenuto) chiude.
        onClick={(e) => {
          if (e.target === dialogo.current && premutoSulloSfondo.current) chiudi();
        }}
      >
        <div className="link-qr__corpo">
          <h2 id={titoloId} className="link-qr__titolo">
            {t('title', { name: nome })}
          </h2>
          {disegno ? (
            <svg
              className="link-qr__codice"
              viewBox={`0 0 ${disegno.lato} ${disegno.lato}`}
              shapeRendering="crispEdges"
              role="img"
              aria-label={t('alt', { name: nome })}
            >
              <rect width={disegno.lato} height={disegno.lato} fill="#fff" />
              <path d={disegno.d} fill="#000" />
            </svg>
          ) : (
            codice && (
              <p className="link-qr__errore" role="alert">
                {t('error')}
              </p>
            )
          )}
          <p className="link-qr__link">{codice?.link ?? url}</p>
          {disegno && <p className="link-qr__aiuto">{t('hint')}</p>}
          <div className="link-qr__azioni">
            {disegno && (
              <button
                type="button"
                className="btn btn-outline-primary btn-sm"
                onClick={scarica}
              >
                {t('download')}
              </button>
            )}
            <button type="button" className="btn btn-primary btn-sm" onClick={chiudi}>
              {tc('close')}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
