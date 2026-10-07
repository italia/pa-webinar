'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';

import { Icon } from '@/components/ui/icon';
import { clampPage } from '@/lib/presentation/client-state';

import { openPdf, type PdfDocument, type PdfLoadingTask } from './pdf-loader';
import { presentationErrorMessage, usePresentationControls } from './use-presentation';

interface PresentationStageProps {
  /** Il token di sala, per leggere il file (Bearer); vuoto per gli ospiti. */
  token: string;
  /** La chiamata sta registrando: chi presenta va avvisato che il riquadro non ci finisce. */
  isRecording: boolean;
  /** Ridotta a una riga sopra la chiamata, per chi vuole il video più grande. */
  minimized: boolean;
  onToggleMinimized: () => void;
}

/** Il riquadro misurato per adattarvi la pagina. */
interface Misura {
  w: number;
  h: number;
}

/** Oltre questo rapporto lo schermo non aggiunge nitidezza, solo memoria. */
const DPR_MAX = 2;

/** Chi assiste scarica il documento entro questo intervallo, non tutti nello stesso istante. */
const RITARDO_MAX_MS = 1_200;

/** Caratteri al massimo del testo della pagina mostrato sotto la slide. */
const TESTO_MAX = 4_000;

/**
 * La scena della presentazione: la pagina del PDF che chi presenta mostra a
 * tutta la sala, accanto alla videochiamata.
 *
 * Chi presenta (moderatori e relatori) gira le pagine per tutti, con i
 * pulsanti o con le frecce della tastiera a riquadro selezionato, e chiude la
 * presentazione. Chi assiste segue la pagina di chi presenta; può sfogliare da
 * solo, e un pulsante lo riporta alla pagina condivisa. Il numero di pagina si
 * annuncia ai lettori di schermo senza interrompere, e il testo della pagina
 * si legge sotto la slide.
 *
 * Il documento si scarica dalla rotta della presentazione, che controlla chi
 * sta nella stanza, e si tiene in memoria finché resta lo stesso: girare
 * pagina non scarica più nulla.
 */
export default function PresentationStage({
  token,
  isRecording,
  minimized,
  onToggleMinimized,
}: PresentationStageProps) {
  const t = useTranslations('presentation');
  const controls = usePresentationControls();
  const view = controls?.view;
  const fileUrl = view?.fileUrl ?? null;
  const canPresent = controls?.canPresent ?? false;
  const sharedPage = controls?.displayPage ?? 1;

  const [documento, setDocumento] = useState<PdfDocument | null>(null);
  const [stato, setStato] = useState<'loading' | 'ready' | 'error'>('loading');
  const [tentativo, setTentativo] = useState(0);
  // La pagina scelta da chi assiste mentre sfoglia da solo; null = segue chi presenta.
  const [paginaLibera, setPaginaLibera] = useState<number | null>(null);
  const [testo, setTesto] = useState('');
  const [misura, setMisura] = useState<Misura>({ w: 0, h: 0 });
  const [vaiA, setVaiA] = useState('');

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const titleId = useId();
  const hintId = useId();
  const gotoId = useId();

  // ── Il documento: uno per materiale presentato ───────────────────────────
  useEffect(() => {
    if (!fileUrl) return;
    let annullato = false;
    let compito: PdfLoadingTask | null = null;
    setStato('loading');
    setDocumento(null);
    setPaginaLibera(null);
    setTesto('');
    // Chi assiste aspetta un istante a caso: trecento persone che chiedono lo
    // stesso file nello stesso millisecondo sono un picco evitabile.
    const ritardo = canPresent ? 0 : Math.floor(Math.random() * RITARDO_MAX_MS);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(fileUrl, {
            cache: 'no-store',
            ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const dati = new Uint8Array(await res.arrayBuffer());
          if (annullato) return;
          compito = await openPdf(dati);
          if (annullato) {
            void compito.destroy();
            return;
          }
          const doc = await compito.promise;
          if (annullato) return;
          setDocumento(doc);
          setStato('ready');
        } catch {
          if (!annullato) setStato('error');
        }
      })();
    }, ritardo);
    return () => {
      annullato = true;
      clearTimeout(timer);
      // Chiude anche il documento, se si era già aperto.
      if (compito) void compito.destroy();
    };
  }, [fileUrl, token, canPresent, tentativo]);

  const total = documento?.numPages ?? view?.info?.pageCount ?? null;
  const paginaCondivisa = clampPage(sharedPage, total);
  const pagina = canPresent ? paginaCondivisa : clampPage(paginaLibera ?? paginaCondivisa, total);
  const sfoglia = !canPresent && paginaLibera !== null && paginaLibera !== paginaCondivisa;
  // Chi presenta è arrivato alla pagina su cui sfogliava chi assiste: da qui
  // lo si segue di nuovo, invece di restare fermi quando passa oltre.
  useEffect(() => {
    if (paginaLibera !== null && paginaLibera === paginaCondivisa) setPaginaLibera(null);
  }, [paginaLibera, paginaCondivisa]);

  // ── Misura del riquadro ──────────────────────────────────────────────────
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
        setMisura((prima) => (Math.abs(prima.w - w) < 2 && Math.abs(prima.h - h) < 2 ? prima : { w, h }));
      });
    });
    osserva.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      osserva.disconnect();
    };
  }, [minimized, view?.materialId]);

  // ── Disegno della pagina ─────────────────────────────────────────────────
  useEffect(() => {
    if (!documento || minimized || misura.w <= 0 || misura.h <= 0) return;
    let annullato = false;
    let disegno: { cancel: () => void } | null = null;
    void (async () => {
      try {
        const page = await documento.getPage(clampPage(pagina, documento.numPages));
        if (annullato) return;
        const base = page.getViewport({ scale: 1 });
        const scala = Math.min(misura.w / base.width, misura.h / base.height);
        const dpr = Math.min(window.devicePixelRatio || 1, DPR_MAX);
        const vista = page.getViewport({ scale: scala * dpr });
        // Si disegna fuori schermo e si copia alla fine: la pagina vecchia
        // resta visibile finché la nuova non è pronta, senza lampi bianchi.
        const fuori = document.createElement('canvas');
        fuori.width = Math.max(1, Math.floor(vista.width));
        fuori.height = Math.max(1, Math.floor(vista.height));
        const compito = page.render({ canvas: fuori, viewport: vista });
        disegno = compito;
        await compito.promise;
        const canvas = canvasRef.current;
        if (annullato || !canvas) return;
        canvas.width = fuori.width;
        canvas.height = fuori.height;
        canvas.style.width = `${Math.floor(fuori.width / dpr)}px`;
        canvas.style.height = `${Math.floor(fuori.height / dpr)}px`;
        canvas.getContext('2d')?.drawImage(fuori, 0, 0);

        // Il testo della pagina, per chi usa un lettore di schermo o vuole
        // copiarlo: la slide è un'immagine.
        const contenuto = await page.getTextContent();
        if (annullato) return;
        let righe = '';
        for (const voce of contenuto.items) {
          if (!('str' in voce)) continue;
          righe += voce.str + (voce.hasEOL ? '\n' : ' ');
          if (righe.length > TESTO_MAX) break;
        }
        setTesto(righe.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, TESTO_MAX));
      } catch {
        // Disegno annullato da una pagina più recente, o pagina illeggibile:
        // resta quella di prima.
      }
    })();
    return () => {
      annullato = true;
      disegno?.cancel();
    };
  }, [documento, pagina, misura.w, misura.h, minimized]);

  // ── Navigazione ──────────────────────────────────────────────────────────
  // Si sfoglia solo un documento aperto: prima non si sa quante pagine abbia.
  const pronto = stato === 'ready';
  const naviga = useCallback(
    (destinazione: number) => {
      if (!controls || !pronto) return;
      const p = clampPage(destinazione, total);
      if (canPresent) {
        controls.goTo(p, total ?? undefined);
        return;
      }
      // Chi assiste sfoglia per conto suo; tornato alla pagina condivisa, la segue di nuovo.
      setPaginaLibera(p === paginaCondivisa ? null : p);
    },
    [controls, pronto, canPresent, total, paginaCondivisa],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const bersaglio = e.target as HTMLElement;
    if (bersaglio.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    let destinazione: number | null = null;
    switch (e.key) {
      case 'ArrowRight':
      case 'PageDown':
        destinazione = pagina + 1;
        break;
      case 'ArrowLeft':
      case 'PageUp':
        destinazione = pagina - 1;
        break;
      case 'Home':
        destinazione = 1;
        break;
      case 'End':
        destinazione = total ?? pagina;
        break;
      default:
        return;
    }
    e.preventDefault();
    naviga(destinazione);
  };

  const onVaiA = (e: FormEvent) => {
    e.preventDefault();
    const n = Number.parseInt(vaiA, 10);
    if (Number.isFinite(n)) naviga(n);
    setVaiA('');
  };

  if (!controls || !view?.materialId) return null;

  const titolo = view.info?.title ?? '';
  const indicatore = total ? t('pageOf', { page: pagina, total }) : t('pageOnly', { page: pagina });
  const chi = view.info?.presenterName
    ? t('presentedBy', { name: view.info.presenterName })
    : view.info?.presenterRole === 'SPEAKER'
      ? t('presentedBySpeaker')
      : view.info?.presenterRole === 'MODERATOR'
        ? t('presentedByModerator')
        : null;
  const errore = controls.actionError ? presentationErrorMessage(t, controls.actionError) : null;

  if (minimized) {
    return (
      <section className="presentation-stage presentation-stage--minimized" aria-labelledby={titleId}>
        <Icon icon="it-presentation" size="sm" className="presentation-stage__icon" aria-hidden="true" />
        <p className="presentation-stage__summary" id={titleId}>
          <span className="presentation-stage__summary-title">
            {titolo ? t('minimizedSummary', { title: titolo }) : t('label')}
          </span>
          <span className="presentation-stage__summary-page">{indicatore}</span>
        </p>
        <button type="button" className="presentation-stage__btn" onClick={onToggleMinimized}>
          <Icon icon="it-expand" size="sm" aria-hidden="true" />
          <span>{t('expand')}</span>
        </button>
      </section>
    );
  }

  return (
    <section
      className="presentation-stage"
      aria-labelledby={titleId}
      aria-describedby={hintId}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <header className="presentation-stage__bar">
        <Icon icon="it-presentation" size="sm" className="presentation-stage__icon" aria-hidden="true" />
        <div className="presentation-stage__heading">
          <h2 className="presentation-stage__title" id={titleId}>
            {titolo || t('label')}
          </h2>
          {chi && <p className="presentation-stage__by">{chi}</p>}
        </div>
        <button
          type="button"
          className="presentation-stage__btn presentation-stage__btn--quiet"
          onClick={onToggleMinimized}
          aria-label={t('minimize')}
          title={t('minimize')}
        >
          <Icon icon="it-collapse" size="sm" aria-hidden="true" />
        </button>
      </header>
      <p id={hintId} className="visually-hidden">
        {canPresent ? t('keyboardHintPresenter') : t('keyboardHintViewer')}
      </p>

      <div className="presentation-stage__canvas-wrap" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className={`presentation-stage__canvas${stato === 'ready' ? '' : ' is-hidden'}`}
          role="img"
          aria-label={titolo ? `${titolo}. ${indicatore}` : indicatore}
        />
        {stato === 'loading' && (
          <div className="presentation-stage__status" role="status">
            <span className="presentation-stage__spinner" aria-hidden="true" />
            {t('loading')}
          </div>
        )}
        {stato === 'error' && (
          <div className="presentation-stage__status" role="alert">
            <p className="mb-2">{t('loadError')}</p>
            <button
              type="button"
              className="btn btn-sm btn-outline-light"
              onClick={() => {
                setTentativo((n) => n + 1);
                controls.refresh();
              }}
            >
              {t('retry')}
            </button>
          </div>
        )}
      </div>

      <div className="presentation-stage__controls">
        <button
          type="button"
          className="presentation-stage__btn"
          onClick={() => naviga(pagina - 1)}
          disabled={!pronto || pagina <= 1}
          aria-label={t('previous')}
          title={t('previous')}
        >
          <Icon icon="it-chevron-left" size="sm" aria-hidden="true" />
        </button>
        <p className="presentation-stage__indicator" aria-live="polite" aria-atomic="true">
          {indicatore}
        </p>
        <button
          type="button"
          className="presentation-stage__btn"
          onClick={() => naviga(pagina + 1)}
          disabled={!pronto || (total !== null && pagina >= total)}
          aria-label={t('next')}
          title={t('next')}
        >
          <Icon icon="it-chevron-right" size="sm" aria-hidden="true" />
        </button>

        {canPresent && (
          <>
            <form className="presentation-stage__goto" onSubmit={onVaiA}>
              <label htmlFor={gotoId} className="visually-hidden">
                {t('goToPage')}
              </label>
              <input
                id={gotoId}
                type="number"
                inputMode="numeric"
                min={1}
                max={total ?? undefined}
                className="form-control form-control-sm"
                // L'intervallo delle pagine, uguale in ogni lingua: il nome del
                // campo lo dà l'etichetta.
                placeholder={total ? `1–${total}` : undefined}
                value={vaiA}
                onChange={(e) => setVaiA(e.target.value)}
              />
              <button
                type="submit"
                className="presentation-stage__btn presentation-stage__btn--text"
                disabled={!pronto}
              >
                {t('go')}
              </button>
            </form>
            <button
              type="button"
              className="presentation-stage__btn presentation-stage__btn--stop"
              disabled={controls.busy}
              onClick={() => void controls.stop()}
            >
              <Icon icon="it-close" size="sm" aria-hidden="true" />
              <span>{t('stop')}</span>
            </button>
          </>
        )}

        {sfoglia && (
          <button
            type="button"
            className="presentation-stage__btn presentation-stage__btn--text"
            onClick={() => setPaginaLibera(null)}
          >
            {t('backToPresenter')}
          </button>
        )}
      </div>

      {sfoglia && (
        <p className="presentation-stage__note">
          {t('browsingAhead', { page: pagina, presenterPage: paginaCondivisa })}
        </p>
      )}
      {errore && (
        <p className="presentation-stage__note presentation-stage__note--error" role="alert">
          {errore}
        </p>
      )}
      {canPresent && isRecording && (
        <p className="presentation-stage__note" role="note">
          {t('recordingNote')}
        </p>
      )}

      {stato === 'ready' && (
        <details className="presentation-stage__text">
          <summary>{t('pageText')}</summary>
          <p>{testo || t('pageTextEmpty')}</p>
        </details>
      )}
    </section>
  );
}
