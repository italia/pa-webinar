'use client';

/**
 * Le finestre dei luoghi della piazza: la bacheca (che cosa, quando, chi) e
 * la galleria dei ritratti (chi c'è in piazza adesso, con il suo personaggio).
 * Finestre native (<dialog>): fuoco intrappolato ed Esc li dà il browser.
 */

import { useCallback, useEffect, useId, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { AV_H, AV_W, disegnaPersonaggio, type AvatarLook } from '@pa-webinar/lobby/avatar';
import { EMOTE_BARRA, EMOTE_KEY } from '@pa-webinar/lobby/emotes';
import { CODICI_SEGRETI } from '@pa-webinar/lobby/segreti';
import { UMORE_GLIFO, UMORI, type Umore } from '@pa-webinar/lobby/umori';

import { MarkdownRenderer } from '@/components/ui/markdown';
import { markMaterialOpened, materialOpenHandlers } from '@/components/materials/material-request';

/** Quello che la bacheca mostra: già tradotto dalla sala d'attesa. */
export interface DatiBacheca {
  titolo: string;
  voci: { etichetta: string; valore: string }[];
  descrizione: string | null;
}

export interface Presente {
  nome: string;
  look: AvatarLook;
  io: boolean;
}

/**
 * Una finestra della piazza, aperta da fuori con `apriRef.current()`.
 *
 * Sta nel corpo della pagina, non dentro la scena: la scena è una regione
 * `role="application"`, e un lettore di schermo non leggerebbe come testo
 * quello che c'è dentro (la bacheca, la legenda).
 */
export function FinestraPiazza({
  titolo,
  apriRef,
  onApri,
  onChiudi,
  nota,
  className = '',
  children,
}: {
  titolo: string;
  apriRef: MutableRefObject<(() => void) | null>;
  onApri?: () => void;
  onChiudi?: () => void;
  /** Una riga nel piede, accanto a «Fatto». */
  nota?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const t = useTranslations('waiting.piazza.editor');
  const ref = useRef<HTMLDialogElement>(null);
  const titoloId = useId();
  const chiudi = useCallback(() => ref.current?.close(), []);
  const [corpo, setCorpo] = useState<HTMLElement | null>(null);
  useEffect(() => setCorpo(document.body), []);

  useEffect(() => {
    apriRef.current = () => {
      onApri?.();
      ref.current?.showModal();
    };
    return () => {
      apriRef.current = null;
    };
  }, [apriRef, onApri]);

  if (!corpo) return null;
  return createPortal(
    <dialog
      ref={ref}
      className={`wr-finestra ${className}`}
      aria-labelledby={titoloId}
      onClose={onChiudi}
      onClick={(e) => {
        // Un clic sullo sfondo chiude la finestra.
        if (e.target === ref.current) chiudi();
      }}
    >
      <div className="wr-finestra__testa">
        <h2 id={titoloId} className="h5 mb-0">
          {titolo}
        </h2>
        <button type="button" className="btn btn-link p-0" onClick={chiudi} aria-label={t('close')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      <div className="wr-finestra__corpo">{children}</div>
      <div className={`wr-finestra__piede${nota ? '' : ' wr-finestra__piede--fine'}`}>
        {nota && <p className="mb-0">{nota}</p>}
        <button type="button" className="btn btn-primary btn-sm" onClick={chiudi}>
          {t('done')}
        </button>
      </div>
    </dialog>,
    corpo,
  );
}

interface VoceProgramma {
  id: string;
  label: string;
  status: string;
  plannedMinutes: number | null;
}

interface Materiale {
  id: string;
  title: string;
  url: string;
  description: string | null;
}

/** Bearer solo con un token vero: `Bearer ` vuoto non è un'identità. */
function intestazioni(token: string | undefined): HeadersInit | undefined {
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

export function BachecaPiazza({
  dati,
  slug,
  token,
  apriRef,
}: {
  dati: DatiBacheca;
  slug: string;
  /** Il token di sala, se c'è: i materiali di un evento protetto lo chiedono. */
  token?: string;
  apriRef: MutableRefObject<(() => void) | null>;
}) {
  const t = useTranslations('waiting.piazza.bacheca');
  // Il programma e i materiali si leggono quando si apre la bacheca: sono
  // le stesse letture pubbliche della sala (l'agenda leggera e l'elenco dei
  // materiali visibili adesso).
  const [programma, setProgramma] = useState<VoceProgramma[]>([]);
  const [materiali, setMateriali] = useState<Materiale[]>([]);
  const leggi = useCallback(() => {
    const base = `/api/events/${encodeURIComponent(slug)}`;
    void fetch(`${base}/agenda?lite=1`, { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<{ agendaEnabled?: boolean; items?: VoceProgramma[] }>) : null))
      .then((d) => setProgramma(d?.agendaEnabled ? (d.items ?? []) : []))
      .catch(() => setProgramma([]));
    void fetch(`${base}/materials`, { cache: 'no-store', headers: intestazioni(token) })
      .then((r) => (r.ok ? (r.json() as Promise<{ materials?: Materiale[] }>) : null))
      .then((d) => setMateriali(d?.materials ?? []))
      .catch(() => setMateriali([]));
  }, [slug, token]);
  return (
    <FinestraPiazza titolo={t('title')} apriRef={apriRef} onApri={leggi} className="wr-finestra--bacheca">
      <p className="wr-bacheca__titolo">{dati.titolo}</p>
      <dl className="wr-bacheca__voci">
        {dati.voci.map((v) => (
          <div key={v.etichetta}>
            <dt>{v.etichetta}</dt>
            <dd>{v.valore}</dd>
          </div>
        ))}
      </dl>
      {programma.length > 0 && (
        <section className="wr-bacheca__sezione">
          <h3>{t('program')}</h3>
          <ol className="wr-bacheca__programma">
            {programma.map((v) => (
              <li key={v.id} className={`is-${v.status.toLowerCase()}`}>
                <span>{v.label}</span>
                {v.status === 'CURRENT' && <span className="wr-bacheca__stato">{t('now')}</span>}
                {v.status === 'DONE' && <span className="wr-bacheca__stato is-fatto">{t('done')}</span>}
                {v.plannedMinutes ? <span className="wr-bacheca__minuti">{t('minutes', { n: v.plannedMinutes })}</span> : null}
              </li>
            ))}
          </ol>
        </section>
      )}
      {materiali.length > 0 && (
        <section className="wr-bacheca__sezione">
          <h3>{t('materials')}</h3>
          <ul className="wr-bacheca__materiali">
            {materiali.map((m) => (
              <li key={m.id}>
                <a
                  href={m.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  {...materialOpenHandlers(() => markMaterialOpened(slug, m.id, token))}
                >
                  {m.title}
                </a>
                {m.description && <span>{m.description}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {dati.descrizione && (
        <section className="wr-bacheca__sezione" aria-label={t('about')}>
          <h3>{t('about')}</h3>
          <MarkdownRenderer content={dati.descrizione} />
        </section>
      )}
    </FinestraPiazza>
  );
}

/** Il ritratto di una persona: il suo personaggio, di fronte. */
function Ritratto({ look, etichetta }: { look: AvatarLook; etichetta: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const scala = 1.5;
    c.width = AV_W * scala * dpr;
    c.height = AV_H * scala * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, AV_W * scala, AV_H * scala);
    disegnaPersonaggio(ctx, look, 'down', 0, false, scala);
  }, [look]);
  return <canvas ref={ref} role="img" aria-label={etichetta} style={{ width: AV_W * 1.5, height: AV_H * 1.5 }} />;
}

/** Quello che la galleria espone dell'evento: le sue immagini e i loghi di
 *  chi lo organizza. */
export interface MostraGalleria {
  immagini: { src: string; alt: string }[];
  loghi: { src: string; alt: string }[];
}

export function GalleriaPiazza({
  presenti,
  mostra,
  aggiorna,
  apriRef,
}: {
  presenti: Presente[];
  mostra?: MostraGalleria;
  /** Rilegge chi c'è, all'apertura. */
  aggiorna: () => void;
  apriRef: MutableRefObject<(() => void) | null>;
}) {
  const t = useTranslations('waiting.piazza.galleria');
  const opere = mostra ? [...mostra.immagini, ...mostra.loghi] : [];
  return (
    <FinestraPiazza titolo={t('title')} apriRef={apriRef} onApri={aggiorna} className="wr-finestra--galleria">
      {opere.length > 0 && (
        <section className="wr-bacheca__sezione">
          <h3>{t('exhibition')}</h3>
          <ul className="wr-mostra">
            {mostra?.immagini.map((im) => (
              <li key={im.src} className="wr-mostra__quadro">
                {/* eslint-disable-next-line @next/next/no-img-element -- immagini dell'evento, già servite dall'app */}
                <img src={im.src} alt={im.alt} loading="lazy" />
              </li>
            ))}
            {mostra?.loghi.map((l) => (
              <li key={l.src} className="wr-mostra__logo">
                {/* eslint-disable-next-line @next/next/no-img-element -- loghi degli enti, già serviti dall'app */}
                <img src={l.src} alt={l.alt} loading="lazy" />
              </li>
            ))}
          </ul>
        </section>
      )}
      <h3 className="wr-galleria__titolo">{t('portraits')}</h3>
      <p className="mb-3">{presenti.length > 1 ? t('intro') : t('alone')}</p>
      <ul className="wr-galleria">
        {presenti.map((p, i) => {
          const nome = p.nome.trim() || '…';
          return (
            <li key={`${i}-${nome}`} className={p.io ? 'is-io' : undefined}>
              <Ritratto look={p.look} etichetta={nome} />
              <span>
                {nome}
                {p.io && <span className="wr-galleria__io"> ({t('you')})</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </FinestraPiazza>
  );
}

/** Il laboratorio: l'umore della piazza (si vedono solo i conteggi) e il
 *  guardaroba del personaggio. */
export function LaboratorioPiazza({
  umore,
  conti,
  onUmore,
  aggiorna,
  onPersonaggio,
  apriRef,
}: {
  umore: Umore | null;
  conti: Record<Umore, number>;
  onUmore: (u: Umore | null) => void;
  aggiorna: () => void;
  onPersonaggio: () => void;
  apriRef: MutableRefObject<(() => void) | null>;
}) {
  const t = useTranslations('waiting.piazza.laboratorio');
  // Finché la finestra è aperta i conteggi si rileggono: arrivano col giro
  // delle presenze, anche il proprio voto.
  const timer = useRef<number | null>(null);
  const apri = useCallback(() => {
    aggiorna();
    if (timer.current === null) timer.current = window.setInterval(aggiorna, 1000);
  }, [aggiorna]);
  const chiudi = useCallback(() => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => chiudi, [chiudi]);
  return (
    <FinestraPiazza
      titolo={t('title')}
      apriRef={apriRef}
      onApri={apri}
      onChiudi={chiudi}
      className="wr-finestra--laboratorio"
    >
      <section className="wr-bacheca__sezione">
        <h3>{t('moodTitle')}</h3>
        <p className="mb-2">{t('moodIntro')}</p>
        <div className="wr-umori" role="group" aria-label={t('moodTitle')}>
          {UMORI.map((u) => (
            <button
              key={u}
              type="button"
              className={`wr-umori__scelta${umore === u ? ' is-on' : ''}`}
              aria-pressed={umore === u}
              onClick={() => onUmore(umore === u ? null : u)}
            >
              <span className="wr-umori__glifo" aria-hidden="true">{UMORE_GLIFO[u]}</span>
              <span>{t(`moods.${u}`)}</span>
              <span className="wr-umori__conto">{t('count', { n: conti[u] })}</span>
            </button>
          ))}
        </div>
        <p className="wr-umori__nota">{t('moodNote')}</p>
      </section>
      <section className="wr-bacheca__sezione">
        <h3>{t('wardrobeTitle')}</h3>
        <p className="mb-2">{t('wardrobeIntro')}</p>
        <button type="button" className="btn btn-outline-primary btn-sm" onClick={onPersonaggio}>
          {t('wardrobeOpen')}
        </button>
      </section>
    </FinestraPiazza>
  );
}

const FRECCE: Record<string, string> = { arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→' };

/** I comandi della piazza e i suoi segreti, da provare. */
export function LegendaPiazza({ apriRef }: { apriRef: MutableRefObject<(() => void) | null> }) {
  const t = useTranslations('waiting.piazza.legenda');
  const tasto = (k: string) => <kbd>{k}</kbd>;
  const righe: [ReactNode, string][] = [
    [<>{tasto('↑')} {tasto('↓')} {tasto('←')} {tasto('→')} · {tasto('W')} {tasto('A')} {tasto('S')} {tasto('D')}</>, t('move')],
    [tasto(t('space')), t('jump')],
    [<>{EMOTE_BARRA.map((g) => <span key={g}>{tasto(EMOTE_KEY[g].toUpperCase())} </span>)}</>, t('gestures')],
    [tasto(t('enter')), t('act')],
  ];
  // I codici vengono dallo stesso modulo che li riconosce nella piazza.
  const sequenza = (codice: readonly string[]) => <>{codice.map((k, i) => <span key={i}>{tasto(FRECCE[k] ?? k.toUpperCase())}</span>)}</>;
  const segreti: [ReactNode, string][] = [
    [sequenza(CODICI_SEGRETI.festa), t('secretParty')],
    [sequenza(CODICI_SEGRETI.fuochi), t('secretFireworks')],
    [sequenza(CODICI_SEGRETI.neve), t('secretSnow')],
    [<span key="pozzo" aria-hidden="true">🪙 🪙 🪙</span>, t('secretWell')],
  ];
  const tabella = (voci: [ReactNode, string][]) => (
    <dl className="wr-legenda">
      {voci.map(([k, v]) => (
        <div key={v}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
  return (
    <FinestraPiazza titolo={t('title')} apriRef={apriRef} className="wr-finestra--legenda">
      <section className="wr-bacheca__sezione">
        <h3>{t('commands')}</h3>
        {tabella(righe)}
      </section>
      <section className="wr-bacheca__sezione">
        <h3>{t('secrets')}</h3>
        <p className="mb-2">{t('secretsIntro')}</p>
        {tabella(segreti)}
      </section>
    </FinestraPiazza>
  );
}
