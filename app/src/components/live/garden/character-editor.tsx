'use client';

/**
 * Il personaggio della piazza: si sceglie ogni parte (carnagione, capelli,
 * vestiti, scarpe, cappello, occhiali, colori), partendo se si vuole da uno
 * dei tre stili — maschile, femminile, non dichiarato — che riempiono le parti
 * e poi si cambiano liberamente. L'anteprima gira e cammina; ogni scelta vale
 * subito anche nella piazza.
 *
 * La finestra è quella comune della piazza (FinestraPiazza): nativa, fuori
 * dalla scena, con fuoco intrappolato ed Esc per chiudere dati dal browser. Le scelte sono controlli veri (select e gruppi di radio), con il
 * nome di ogni colore per chi usa un lettore di schermo.
 */

import { useEffect, useId, useRef, useState, type MutableRefObject } from 'react';
import { useTranslations } from 'next-intl';
import {
  CAPELLI,
  CAPPELLI,
  COLORI_CAPELLI,
  COLORI_SCARPE,
  COLORI_SOTTO,
  COLORI_VESTITI,
  AV_H,
  AV_W,
  disegnaPersonaggio,
  lookCasuale,
  MAGLIE,
  OCCHIALI,
  PELLI,
  PRESET,
  SOTTO,
  STILI,
  stessoLook,
  type AvatarLook,
  type DirezioneDisegnata,
  type Stile,
  type Tinta,
} from '@pa-webinar/lobby/avatar';

import { FinestraPiazza } from './piazza-luoghi';

/** L'anteprima: il personaggio ingrandito, con un po' d'aria attorno. */
const SCALA_ANTEPRIMA = 2.6;
const LARGO_ANTEPRIMA = 160;
const ALTO_ANTEPRIMA = 190;
/** L'ordine in cui l'anteprima gira su sé stessa. */
const GIRO: { dir: DirezioneDisegnata; specchio: boolean }[] = [
  { dir: 'down', specchio: false },
  { dir: 'left', specchio: false },
  { dir: 'up', specchio: false },
  { dir: 'left', specchio: true },
];
const CAMMINATA = [1, 0, 2, 0];

function Anteprima({ look, etichetta }: { look: AvatarLook; etichetta: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [verso, setVerso] = useState(0);
  const [passo, setPasso] = useState(0);
  const t = useTranslations('waiting.piazza.editor');

  // Cammina sul posto, a meno che chi guarda abbia chiesto meno movimento.
  useEffect(() => {
    let ridotto = false;
    try {
      ridotto = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      /* nessuna preferenza leggibile */
    }
    if (ridotto) return;
    let i = 0;
    const timer = window.setInterval(() => {
      i = (i + 1) % CAMMINATA.length;
      setPasso(CAMMINATA[i] ?? 0);
    }, 200);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const c = canvasRef.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const { dir, specchio } = GIRO[verso] ?? GIRO[0]!;
    // Nitido anche sugli schermi ad alta densità.
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    c.width = LARGO_ANTEPRIMA * dpr;
    c.height = ALTO_ANTEPRIMA * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, LARGO_ANTEPRIMA, ALTO_ANTEPRIMA);
    // L'ombra sotto i piedi.
    const piediY = (ALTO_ANTEPRIMA + AV_H * SCALA_ANTEPRIMA) / 2;
    ctx.fillStyle = 'rgba(23, 50, 77, 0.14)';
    ctx.beginPath();
    ctx.ellipse(LARGO_ANTEPRIMA / 2, piediY - 4, 36, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    const ox = (LARGO_ANTEPRIMA - AV_W * SCALA_ANTEPRIMA) / 2;
    const oy = (ALTO_ANTEPRIMA - AV_H * SCALA_ANTEPRIMA) / 2;
    if (specchio) {
      ctx.translate(LARGO_ANTEPRIMA, 0);
      ctx.scale(-1, 1);
    }
    disegnaPersonaggio(ctx, look, dir, passo, false, SCALA_ANTEPRIMA, ox, oy);
  }, [look, verso, passo]);

  return (
    <div className="wr-personaggio__anteprima">
      <canvas
        ref={canvasRef}
        width={LARGO_ANTEPRIMA}
        height={ALTO_ANTEPRIMA}
        role="img"
        aria-label={etichetta}
      />
      <button
        type="button"
        className="btn btn-outline-primary btn-sm"
        onClick={() => setVerso((v) => (v + 1) % GIRO.length)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
             strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="me-1">
          <path d="M21 12a9 9 0 1 1-3-6.7" />
          <polyline points="21 3 21 9 15 9" />
        </svg>
        {t('rotate')}
      </button>
    </div>
  );
}

/** Un gruppo di colori: radio veri, ognuno col suo nome. */
function Colori({
  legenda,
  tinte,
  valore,
  onScelta,
  nome,
}: {
  legenda: string;
  tinte: readonly { colore: string; nome?: string }[];
  valore: number;
  onScelta: (i: number) => void;
  nome: (i: number) => string;
}) {
  const gruppo = useId();
  return (
    <fieldset className="wr-personaggio__colori">
      <legend>{legenda}</legend>
      <div className="wr-personaggio__tinte">
        {tinte.map((tinta, i) => (
          <label key={i} className="wr-personaggio__tinta" title={nome(i)}>
            <input
              type="radio"
              name={gruppo}
              checked={valore === i}
              onChange={() => onScelta(i)}
              aria-label={nome(i)}
            />
            <span style={{ background: tinta.colore }} aria-hidden="true" />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Scelta<T extends string>({
  etichetta,
  opzioni,
  valore,
  onScelta,
  nome,
}: {
  etichetta: string;
  opzioni: readonly T[];
  valore: number;
  onScelta: (i: number) => void;
  nome: (o: T) => string;
}) {
  const id = useId();
  return (
    <div className="wr-personaggio__scelta">
      <label htmlFor={id}>{etichetta}</label>
      <select
        id={id}
        className="form-select form-select-sm"
        value={valore}
        onChange={(e) => onScelta(Number(e.target.value))}
      >
        {opzioni.map((o, i) => (
          <option key={o} value={i}>
            {nome(o)}
          </option>
        ))}
      </select>
    </div>
  );
}

export interface CharacterEditorProps {
  look: AvatarLook;
  onChange: (look: AvatarLook) => void;
  /** La corona si sblocca trovando un segreto nella piazza. */
  coronaSbloccata?: boolean;
  /** Per aprire l'editor da fuori (il laboratorio della piazza). */
  apriRef?: MutableRefObject<(() => void) | null>;
}

export default function CharacterEditor({ look, onChange, coronaSbloccata = false, apriRef }: CharacterEditorProps) {
  const t = useTranslations('waiting.piazza.editor');
  // Si apre dal pulsante della barra o da fuori (il laboratorio): lo stesso
  // riferimento, quello della finestra.
  const proprio = useRef<(() => void) | null>(null);
  const apriFinestra = apriRef ?? proprio;

  const cambia = (parte: Partial<AvatarLook>) => onChange({ ...look, ...parte });
  const stile: Stile | null = STILI.find((s) => stessoLook({ ...PRESET[s], pelle: look.pelle }, look)) ?? null;
  const cappelli: readonly (typeof CAPPELLI)[number][] = coronaSbloccata
    ? CAPPELLI
    : CAPPELLI.filter((c) => c !== 'corona');
  const coloreCappelloConta = ['berretto', 'cuffia', 'cappello', 'cuffie'].includes(CAPPELLI[look.cappello] ?? '');
  const vestito = MAGLIE[look.maglia] === 'vestito';
  const nomeColore = (tinte: readonly Tinta[]) => (i: number) => t(`colors.${tinte[i]?.nome ?? 'nero'}`);

  return (
    <>
      <button
        type="button"
        className="wr-piazza-azioni__personaggio"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => apriFinestra.current?.()}
        aria-haspopup="dialog"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
             strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20.4 6.6 16 4l-1.5 1.5a3.5 3.5 0 0 1-5 0L8 4 3.6 6.6l1.6 4 2.3-1V20h9V9.6l2.3 1z" />
        </svg>
        <span>{t('open')}</span>
      </button>
      <FinestraPiazza
        titolo={t('title')}
        apriRef={apriFinestra}
        nota={t('hint')}
        className="wr-personaggio"
      >
        <div className="wr-personaggio__corpo">
          <Anteprima look={look} etichetta={t('preview')} />
          <div className="wr-personaggio__parti">
            <fieldset className="wr-personaggio__stili">
              <legend>{t('start')}</legend>
              <div className="wr-personaggio__stili-scelte">
                {STILI.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`btn btn-sm ${stile === s ? 'btn-primary' : 'btn-outline-primary'}`}
                    aria-pressed={stile === s}
                    // Lo stile riempie le parti, ma la carnagione resta quella scelta.
                    onClick={() => onChange({ ...PRESET[s], pelle: look.pelle })}
                  >
                    {t(`styles.${s}`)}
                  </button>
                ))}
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  onClick={() => onChange({ ...lookCasuale(), pelle: look.pelle })}
                >
                  {t('random')}
                </button>
              </div>
            </fieldset>

            <Colori
              legenda={t('skin')}
              tinte={PELLI}
              valore={look.pelle}
              onScelta={(i) => cambia({ pelle: i })}
              nome={(i) => t('skinTone', { n: i + 1 })}
            />

            <div className="wr-personaggio__riga">
              <Scelta
                etichetta={t('hair')}
                opzioni={CAPELLI}
                valore={look.capelli}
                onScelta={(i) => cambia({ capelli: i })}
                nome={(o) => t(`hairStyles.${o}`)}
              />
            </div>
            {CAPELLI[look.capelli] !== 'calvo' && (
              <Colori
                legenda={t('hairColor')}
                tinte={COLORI_CAPELLI}
                valore={look.coloreCapelli}
                onScelta={(i) => cambia({ coloreCapelli: i })}
                nome={nomeColore(COLORI_CAPELLI)}
              />
            )}

            <div className="wr-personaggio__riga">
              <Scelta
                etichetta={t('top')}
                opzioni={MAGLIE}
                valore={look.maglia}
                onScelta={(i) => cambia({ maglia: i })}
                nome={(o) => t(`tops.${o}`)}
              />
              {!vestito && (
                <Scelta
                  etichetta={t('bottom')}
                  opzioni={SOTTO}
                  valore={look.sotto}
                  onScelta={(i) => cambia({ sotto: i })}
                  nome={(o) => t(`bottoms.${o}`)}
                />
              )}
            </div>
            <Colori
              legenda={t('topColor')}
              tinte={COLORI_VESTITI}
              valore={look.coloreMaglia}
              onScelta={(i) => cambia({ coloreMaglia: i })}
              nome={nomeColore(COLORI_VESTITI)}
            />
            {!vestito && (
              <Colori
                legenda={t('bottomColor')}
                tinte={COLORI_SOTTO}
                valore={look.coloreSotto}
                onScelta={(i) => cambia({ coloreSotto: i })}
                nome={nomeColore(COLORI_SOTTO)}
              />
            )}
            <Colori
              legenda={t('shoes')}
              tinte={COLORI_SCARPE}
              valore={look.scarpe}
              onScelta={(i) => cambia({ scarpe: i })}
              nome={nomeColore(COLORI_SCARPE)}
            />

            <div className="wr-personaggio__riga">
              <Scelta
                etichetta={t('hat')}
                opzioni={cappelli}
                valore={Math.max(0, cappelli.indexOf(CAPPELLI[look.cappello] ?? 'nessuno'))}
                onScelta={(i) => cambia({ cappello: CAPPELLI.indexOf(cappelli[i] ?? 'nessuno') })}
                nome={(o) => t(`hats.${o}`)}
              />
              <Scelta
                etichetta={t('glasses')}
                opzioni={OCCHIALI}
                valore={look.occhiali}
                onScelta={(i) => cambia({ occhiali: i })}
                nome={(o) => t(`glassesStyles.${o}`)}
              />
            </div>
            {coloreCappelloConta && (
              <Colori
                legenda={t('hatColor')}
                tinte={COLORI_VESTITI}
                valore={look.coloreCappello}
                onScelta={(i) => cambia({ coloreCappello: i })}
                nome={nomeColore(COLORI_VESTITI)}
              />
            )}
          </div>
        </div>
      </FinestraPiazza>
    </>
  );
}
