'use client';

import { useState, useEffect, useCallback, useId, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { localizedPath } from '@/lib/utils/localized-url';

type RowKey = 'call' | 'event' | 'mod';

// SVG inline, NON <Icon> di design-react-kit (regola di idratazione della sala).
const svgProps = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

function ShareGlyph() {
  return (
    <svg {...svgProps} width={14} height={14}>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}
function CallGlyph() {
  return (
    <svg {...svgProps}>
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  );
}
function EventGlyph() {
  return (
    <svg {...svgProps}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}
function ShieldGlyph() {
  return (
    <svg {...svgProps} width={14} height={14}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
function CopyGlyph() {
  return (
    <svg {...svgProps} width={14} height={14}>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
function CheckGlyph() {
  return (
    <svg {...svgProps} width={14} height={14} strokeWidth={3}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
function CloseGlyph() {
  return (
    <svg {...svgProps} width={14} height={14}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

/** Quanto dura l'animazione di chiusura (allineata a globals.scss). */
const CHIUSURA_MS = 160;

/**
 * «Condividi» nella sala: un fumetto ancorato al pulsante con i link da
 * copiare:
 *   - il link per entrare, senza token (`/{locale}/events/{slug}/live`)
 *   - la pagina pubblica dell'evento (`/{locale}/events/{slug}`)
 *   - (solo per chi modera, chiuso) il link PRIVILEGIATO da moderatore
 *
 * I link pubblici si costruiscono da slug e lingua, MAI da
 * `window.location.href` (l'indirizzo corrente porta il `?token=` di chi
 * guarda). Il link da moderatore viene da `moderatorToken`, che la sala passa
 * SOLO a chi modera: il token non entra mai nell'albero di un partecipante. Sta
 * dietro un pannello chiuso con un avviso esplicito, perché non si condivida
 * per sbaglio.
 *
 * Il fumetto vive dentro la barra della sala: resta visibile anche nello
 * schermo intero della sala, che contiene la barra.
 */
export default function LiveShareButton({
  slug,
  locale,
  moderatorToken,
  hasPublicPage = true,
  hasCallLink = true,
}: {
  slug: string;
  locale: string;
  moderatorToken?: string;
  /** Falso per una chiamata istantanea: non ha una pagina pubblica, e
   *  offrirne il link qui significherebbe far condividere un indirizzo che
   *  risponde 404 a chi lo riceve. */
  hasPublicPage?: boolean;
  /** Falso per un evento in calendario quando l'amministrazione non ammette
   *  ospiti: chi apre il link senza token finisce all'iscrizione, e il suo
   *  suggerimento («entra direttamente») sarebbe falso. Resta la pagina
   *  dell'evento, che porta lì dichiarandolo. */
  hasCallLink?: boolean;
}) {
  const t = useTranslations('live.share');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [chiusura, setChiusura] = useState(false);
  // Ogni apertura conta: riaperto durante l'animazione di chiusura, il fumetto
  // riprende il fuoco come a un'apertura normale.
  const [aperture, setAperture] = useState(0);
  // Dove comincia il fumetto (sotto il pulsante), per l'altezza massima e per
  // la posizione sul telefono, dove la barra può andare su due righe.
  const [sotto, setSotto] = useState<number | null>(null);
  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState<RowKey | null>(null);
  const [showMod, setShowMod] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const timerChiusura = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerCopia = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popId = useId();
  const titoloId = useId();

  useEffect(() => {
    setOrigin(window.location.origin);
    return () => {
      if (timerChiusura.current) clearTimeout(timerChiusura.current);
      if (timerCopia.current) clearTimeout(timerCopia.current);
    };
  }, []);

  const chiudi = useCallback((rimettiFuoco: boolean) => {
    if (timerChiusura.current) clearTimeout(timerChiusura.current);
    setChiusura(true);
    timerChiusura.current = setTimeout(() => {
      setOpen(false);
      setChiusura(false);
      setShowMod(false);
    }, CHIUSURA_MS);
    if (rimettiFuoco) triggerRef.current?.focus();
  }, []);

  const apri = useCallback(() => {
    if (timerChiusura.current) clearTimeout(timerChiusura.current);
    const r = triggerRef.current?.getBoundingClientRect();
    setSotto(r ? Math.round(r.bottom) : null);
    setChiusura(false);
    setOpen(true);
    setAperture((n) => n + 1);
  }, []);

  // Aperto: il fuoco va al fumetto (da lì Tab porta ai comandi, e chi lo
  // legge con uno screen reader sente il titolo); Esc e un clic fuori lo
  // chiudono.
  useEffect(() => {
    if (!open) return;
    popRef.current?.focus();
    // In cattura e fermato lì: Esc chiude il fumetto e basta, non anche il
    // pannello laterale che ascolta lo stesso tasto.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        chiudi(true);
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) chiudi(false);
    };
    // Un clic nella videochiamata non arriva a questa pagina (è un iframe):
    // la pagina però perde il fuoco, e il fumetto si chiude.
    const onBlur = () => chiudi(false);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('blur', onBlur);
    };
  }, [open, aperture, chiudi]);

  const callUrl = origin ? `${origin}${localizedPath(`/events/${slug}/live`, locale)}` : '';
  const eventUrl = origin ? `${origin}${localizedPath(`/events/${slug}`, locale)}` : '';
  const modUrl =
    origin && moderatorToken
      ? `${origin}${localizedPath(`/events/${slug}/live`, locale)}?token=${moderatorToken}`
      : '';

  const copy = useCallback(async (which: RowKey, url: string) => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        /* resta il campo selezionabile per la copia a mano */
      }
      ta.remove();
    }
    setCopied(which);
    if (timerCopia.current) clearTimeout(timerCopia.current);
    timerCopia.current = setTimeout(() => setCopied((c) => (c === which ? null : c)), 2000);
  }, []);

  const rows: Array<{ key: RowKey; icon: ReactNode; label: string; hint: string; url: string }> = [];
  // Una chiamata istantanea ammette sempre chi ha il link e non ha una pagina
  // pubblica: il link per partecipare, lì, è l'unico da condividere.
  if (hasCallLink || !hasPublicPage) {
    rows.push({ key: 'call', icon: <CallGlyph />, label: t('callLink'), hint: t('callLinkHint'), url: callUrl });
  }
  if (hasPublicPage) {
    rows.push({
      key: 'event',
      icon: <EventGlyph />,
      label: t('eventLink'),
      hint: t('eventLinkHint'),
      url: eventUrl,
    });
  }

  const riga = (key: RowKey, url: string, pericolo = false) => (
    <div className={`live-share__field${copied === key ? ' is-copied' : ''}`}>
      <input
        type="text"
        readOnly
        value={url}
        className="live-share__url"
        aria-label={key === 'mod' ? t('moderatorLink') : rows.find((r) => r.key === key)?.label}
        onFocus={(e) => e.currentTarget.select()}
      />
      <button
        type="button"
        className={`live-share__copy${pericolo ? ' live-share__copy--danger' : ''}`}
        onClick={() => void copy(key, url)}
      >
        <span className="live-share__copy-icon" key={copied === key ? 'ok' : 'copia'}>
          {copied === key ? <CheckGlyph /> : <CopyGlyph />}
        </span>
        {copied === key ? t('copied') : t('copy')}
      </button>
    </div>
  );

  return (
    <div className="live-share" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`btn btn-xs d-inline-flex align-items-center live-share-btn${open && !chiusura ? ' is-open' : ''}`}
        onClick={() => (open && !chiusura ? chiudi(false) : apri())}
        aria-label={t('button')}
        aria-expanded={open && !chiusura}
        aria-controls={open ? popId : undefined}
        aria-haspopup="dialog"
      >
        <ShareGlyph />
        <span className="d-none d-md-inline ms-1">{t('button')}</span>
      </button>

      {open && (
        <div
          ref={popRef}
          id={popId}
          className={`live-share__pop${chiusura ? ' is-closing' : ''}`}
          role="dialog"
          aria-labelledby={titoloId}
          tabIndex={-1}
          style={sotto !== null ? ({ ['--share-sotto' as string]: `${sotto}px` } as CSSProperties) : undefined}
        >
          <div className="live-share__head">
            <span className="live-share__head-icon" aria-hidden="true">
              <ShareGlyph />
            </span>
            <h2 id={titoloId} className="live-share__title">
              {t('title')}
            </h2>
            <button
              type="button"
              className="live-share__close"
              onClick={() => chiudi(true)}
              aria-label={tc('close')}
              title={tc('close')}
            >
              <CloseGlyph />
            </button>
          </div>

          <div className="live-share__body">
            {rows.map((r, i) => (
              <section
                key={r.key}
                className="live-share__card"
                style={{ animationDelay: `${60 + i * 50}ms` }}
              >
                <div className="live-share__card-head">
                  <span className="live-share__card-icon">{r.icon}</span>
                  <span className="live-share__card-label">{r.label}</span>
                </div>
                {riga(r.key, r.url)}
                <p className="live-share__hint">{r.hint}</p>
              </section>
            ))}

            {modUrl && (
              <section
                className={`live-share__mod${showMod ? ' is-open' : ''}`}
                style={{ animationDelay: `${60 + rows.length * 50}ms` }}
              >
                <button
                  type="button"
                  className="live-share__mod-toggle"
                  onClick={() => setShowMod((s) => !s)}
                  aria-expanded={showMod}
                >
                  <ShieldGlyph />
                  <span>{t('moderatorReveal')}</span>
                  <svg {...svgProps} width={14} height={14} className="live-share__chevron">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {showMod && (
                  <div className="live-share__mod-body">
                    {/* Un div, NON <Alert> di design-react-kit (l'icona finisce
                        sotto il testo). */}
                    <p className="live-share__warning">{t('moderatorWarning')}</p>
                    {riga('mod', modUrl, true)}
                    <p className="live-share__hint">{t('moderatorLinkHint')}</p>
                  </div>
                )}
              </section>
            )}
          </div>

          {/* La conferma della copia per chi usa un lettore di schermo. */}
          <span className="visually-hidden" role="status">
            {copied ? t('copied') : ''}
          </span>
        </div>
      )}
    </div>
  );
}
