// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

'use client';

/**
 * L'editor di rimozione: il video della registrazione (aperto in deroga, ogni
 * apertura tracciata), le proposte di dove la persona compare o parla, e gli
 * intervalli da coprire, che lo staff corregge sulla linea del tempo o a mano.
 * L'anteprima mostra il cartello e toglie l'audio dentro gli intervalli,
 * come sara' il video ripulito; il video vero lo produce il worker.
 */
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { useTranslations } from 'next-intl';
import { Button } from 'design-react-kit';

import { useConfirm } from '@/components/ui/confirm-dialog';
import { Icon } from '@/components/ui/icon';
import {
  secondiCoperti,
  unisciIntervalli,
  type FonteIntervallo,
  type Intervallo,
  type IntervalloProposto,
} from '@/lib/recording/redaction/intervals';
import { formatTempo, leggiTempo } from '@/lib/recording/redaction/time';

/** I colori della linea del tempo, uno per fonte, e quello degli intervalli da coprire. */
const COLORI: Record<FonteIntervallo | 'selected', string> = {
  presence: '#0066CC',
  speech: '#008055',
  track: '#CC7A00',
  selected: '#D1344C',
};
const FONTI: readonly FonteIntervallo[] = ['presence', 'speech', 'track'];
const PASSO_TASTIERA_S = 5;
const NUOVO_INTERVALLO_S = 5;

interface Riga extends Intervallo {
  /** Il testo che si sta scrivendo, prima che diventi un tempo. */
  bozzaStart?: string;
  bozzaEnd?: string;
}

const dentro = (intervalli: readonly Intervallo[], t: number) =>
  intervalli.some((i) => t >= i.start && t < i.end);

export default function RedactionEditor({
  requestId,
  hasVideo,
  durationSec,
  proposals,
  initial,
  onSubmitted,
}: {
  requestId: string;
  hasVideo: boolean;
  durationSec: number | null;
  proposals: IntervalloProposto[];
  initial: Intervallo[];
  onSubmitted: (status: string) => void;
}) {
  const t = useTranslations('admin.recordingRemovals');
  const tCartello = useTranslations('recordingRemoval');
  const confirm = useConfirm();
  const id = useId();
  const video = useRef<HTMLVideoElement>(null);
  const [righe, setRighe] = useState<Riga[]>(() => initial.map((i) => ({ ...i })));
  const [ora, setOra] = useState(0);
  const [durataVideo, setDurataVideo] = useState<number | null>(null);
  const [anteprima, setAnteprima] = useState(false);
  const [erroreVideo, setErroreVideo] = useState(false);
  const [invio, setInvio] = useState(false);
  const [errore, setErrore] = useState<number | null>(null);

  // La forma d'onda, se la post-produzione l'ha prodotta: dove c'e' voce.
  const [onda, setOnda] = useState<number[] | null>(null);
  useEffect(() => {
    if (!hasVideo) return undefined;
    let annullato = false;
    void (async () => {
      try {
        const res = await fetch(`/api/admin/recording-removals/${requestId}/waveform`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const corpo = (await res.json()) as { peaks?: unknown };
        if (!annullato && Array.isArray(corpo.peaks)) {
          setOnda(corpo.peaks.filter((p): p is number => typeof p === 'number'));
        }
      } catch {
        // Senza forma d'onda la linea del tempo resta utilizzabile.
      }
    })();
    return () => {
      annullato = true;
    };
  }, [hasVideo, requestId]);

  const durata =
    durataVideo ??
    durationSec ??
    Math.max(60, ...proposals.map((p) => p.end), ...righe.map((r) => r.end));
  const intervalli = useMemo(() => unisciIntervalli(righe, durata), [righe, durata]);
  const coperto = anteprima && dentro(intervalli, ora);

  const vaiA = useCallback(
    (secondi: number) => {
      const s = Math.min(Math.max(0, secondi), durata);
      if (video.current) video.current.currentTime = s;
      setOra(s);
    },
    [durata]
  );

  function aggiorna(indice: number, campo: 'start' | 'end', valore: number) {
    setRighe((r) =>
      r.map((x, i) =>
        i === indice
          ? {
              ...x,
              [campo]: valore,
              [campo === 'start' ? 'bozzaStart' : 'bozzaEnd']: undefined,
            }
          : x
      )
    );
  }

  function scrivi(indice: number, campo: 'start' | 'end', testo: string) {
    setRighe((r) =>
      r.map((x, i) =>
        i === indice
          ? { ...x, [campo === 'start' ? 'bozzaStart' : 'bozzaEnd']: testo }
          : x
      )
    );
  }

  function conferma(indice: number, campo: 'start' | 'end') {
    const riga = righe[indice];
    const testo = campo === 'start' ? riga?.bozzaStart : riga?.bozzaEnd;
    if (testo === undefined) return;
    const valore = leggiTempo(testo);
    if (valore !== null) aggiorna(indice, campo, Math.min(valore, durata));
  }

  function suTempo() {
    const v = video.current;
    if (!v) return;
    setOra(v.currentTime);
    // Nell'anteprima l'audio tace dentro gli intervalli, come nel video ripulito.
    if (anteprima) v.muted = dentro(intervalli, v.currentTime);
  }

  function cambiaAnteprima(attiva: boolean) {
    setAnteprima(attiva);
    if (!attiva && video.current) video.current.muted = false;
  }

  function suClicLinea(e: MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width <= 0) return;
    vaiA(((e.clientX - r.left) / r.width) * durata);
  }

  function suTastoLinea(e: KeyboardEvent<HTMLDivElement>) {
    const passi: Record<string, number> = {
      ArrowRight: PASSO_TASTIERA_S,
      ArrowUp: PASSO_TASTIERA_S,
      ArrowLeft: -PASSO_TASTIERA_S,
      ArrowDown: -PASSO_TASTIERA_S,
    };
    if (e.key in passi) vaiA(ora + passi[e.key]!);
    else if (e.key === 'Home') vaiA(0);
    else if (e.key === 'End') vaiA(durata);
    else return;
    e.preventDefault();
  }

  async function invia() {
    const ok = await confirm({
      title: t('submit'),
      message: t('submitConfirm'),
      confirmLabel: t('submit'),
      danger: true,
    });
    if (!ok) return;
    setInvio(true);
    setErrore(null);
    try {
      const res = await fetch(`/api/admin/recording-removals/${requestId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intervals: hasVideo ? intervalli.map(({ start, end }) => ({ start, end })) : [],
        }),
      });
      if (!res.ok) {
        setErrore(res.status);
        return;
      }
      onSubmitted(((await res.json()) as { status: string }).status);
    } finally {
      setInvio(false);
    }
  }

  // Senza video non c'e' niente da coprire: si tolgono le tracce e le frasi
  // della persona (lo dice la pagina della richiesta), e basta inviare.
  if (!hasVideo) {
    return (
      <section aria-labelledby={`${id}-titolo`}>
        <h2 id={`${id}-titolo`} className="visually-hidden">
          {t('editorTitle')}
        </h2>
        {errore !== null && (
          <div className="alert alert-danger" role="alert">
            {t('actionError', { code: errore })}
          </div>
        )}
        <Button color="danger" disabled={invio} onClick={() => void invia()}>
          {t('submit')}
        </Button>
      </section>
    );
  }

  const percento = (s: number) => `${Math.min(100, Math.max(0, (s / durata) * 100))}%`;
  const fascia = (
    i: Intervallo,
    colore: string,
    top: number,
    altezza: number,
    chiave: string
  ) => (
    <div
      key={chiave}
      style={{
        position: 'absolute',
        left: percento(i.start),
        width: `calc(${percento(i.end)} - ${percento(i.start)})`,
        minWidth: 2,
        top,
        height: altezza,
        background: colore,
        borderRadius: 2,
      }}
    />
  );

  return (
    <section aria-labelledby={`${id}-titolo`}>
      <h2 id={`${id}-titolo`} className="h5 mb-1">
        {t('editorTitle')}
      </h2>
      <p className="text-muted small mb-3">{t('editorHint')}</p>

      {hasVideo && (
        <div
          className="position-relative mb-3"
          style={{ background: '#000', borderRadius: 4 }}
        >
          <video
            ref={video}
            src={`/api/admin/recording-removals/${requestId}/media`}
            controls
            preload="metadata"
            className="w-100 d-block"
            style={{ maxHeight: 420 }}
            onTimeUpdate={suTempo}
            onSeeked={suTempo}
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration;
              if (Number.isFinite(d) && d > 0) setDurataVideo(d);
            }}
            onError={() => setErroreVideo(true)}
          />
          {coperto && (
            <div
              aria-hidden="true"
              className="d-flex flex-column align-items-center justify-content-center text-center p-3"
              style={{
                position: 'absolute',
                inset: '0 0 48px 0',
                background: '#17324D',
                color: '#fff',
                pointerEvents: 'none',
              }}
            >
              <div className="fw-semibold fs-4">{tCartello('cardTitle')}</div>
              <div className="small mt-2" style={{ color: '#D9E4EF' }}>
                {tCartello('cardBody')}
              </div>
            </div>
          )}
        </div>
      )}
      {erroreVideo && (
        <div className="alert alert-warning" role="alert">
          {t('mediaError')}
        </div>
      )}

      <div
        role="slider"
        tabIndex={0}
        aria-label={t('timelineLabel')}
        aria-valuemin={0}
        aria-valuemax={Math.round(durata)}
        aria-valuenow={Math.round(ora)}
        aria-valuetext={formatTempo(ora)}
        onClick={suClicLinea}
        onKeyDown={suTastoLinea}
        className="position-relative mb-2"
        style={{
          height: 52,
          background: '#F5F6F7',
          border: '1px solid #C5C7C9',
          borderRadius: 4,
          cursor: 'pointer',
        }}
      >
        {onda && onda.length > 1 && (
          <svg
            aria-hidden="true"
            viewBox={`0 0 ${onda.length - 1} 2`}
            preserveAspectRatio="none"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              opacity: 0.25,
            }}
          >
            <polygon
              fill="#5C6F82"
              points={[
                ...onda.map((p, i) => `${i},${1 - Math.min(1, Math.max(0, p))}`),
                ...[...onda]
                  .reverse()
                  .map(
                    (p, i) => `${onda.length - 1 - i},${1 + Math.min(1, Math.max(0, p))}`
                  ),
              ].join(' ')}
            />
          </svg>
        )}
        {FONTI.map((f, n) =>
          proposals
            .filter((p) => p.source === f)
            .map((p, k) => fascia(p, COLORI[f], 4 + n * 8, 6, `${f}-${k}`))
        )}
        {intervalli.map((i, k) => fascia(i, COLORI.selected, 30, 16, `sel-${k}`))}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: percento(ora),
            top: 0,
            bottom: 0,
            width: 2,
            background: '#17324D',
          }}
        />
      </div>
      <ul className="list-inline small mb-3">
        {[...FONTI, 'selected' as const].map((f) => (
          <li key={f} className="list-inline-item me-3">
            <span
              aria-hidden="true"
              className="d-inline-block me-1 align-middle"
              style={{ width: 12, height: 12, background: COLORI[f], borderRadius: 2 }}
            />
            {f === 'presence'
              ? t('sourcePresence')
              : f === 'speech'
                ? t('sourceSpeech')
                : f === 'track'
                  ? t('sourceTrack')
                  : t('selectedLegend')}
          </li>
        ))}
        <li className="list-inline-item text-muted">
          {formatTempo(ora)} / {formatTempo(durata)}
        </li>
      </ul>

      <div className="d-flex flex-wrap gap-2 mb-3">
        <Button
          size="sm"
          color="primary"
          outline
          onClick={() =>
            setRighe((r) => [
              ...r,
              { start: ora, end: Math.min(durata, ora + NUOVO_INTERVALLO_S) },
            ])
          }
        >
          <Icon icon="it-plus" size="sm" className="me-1" color="primary" />
          {t('addInterval')}
        </Button>
        <Button
          size="sm"
          color="primary"
          outline
          disabled={proposals.length === 0}
          onClick={() => setRighe(unisciIntervalli(proposals, durata))}
        >
          {t('useProposals')}
        </Button>
        {hasVideo && (
          <div className="form-check form-check-inline ms-2 mb-0">
            <input
              id={`${id}-anteprima`}
              className="form-check-input"
              type="checkbox"
              checked={anteprima}
              onChange={(e) => cambiaAnteprima(e.target.checked)}
            />
            <label className="form-check-label" htmlFor={`${id}-anteprima`}>
              {t('preview')}
            </label>
          </div>
        )}
      </div>

      <p className="small text-muted mb-2">{t('timeHint')}</p>
      {righe.length === 0 ? (
        <p className="mb-3">{t('noIntervalsVideo')}</p>
      ) : (
        <ol className="list-unstyled mb-3">
          {righe.map((r, n) => {
            const bozze = [
              ['start', r.bozzaStart, r.start] as const,
              ['end', r.bozzaEnd, r.end] as const,
            ];
            return (
              <li
                key={n}
                className="d-flex flex-wrap align-items-end gap-2 mb-2 pb-2 border-bottom"
              >
                <span className="fw-semibold me-2 mb-2">
                  {t('intervalLabel', { n: n + 1 })}
                </span>
                {bozze.map(([campo, bozza, valore]) => {
                  const invalido = bozza !== undefined && leggiTempo(bozza) === null;
                  const idCampo = `${id}-${n}-${campo}`;
                  return (
                    <div key={campo} style={{ width: 130 }}>
                      <label htmlFor={idCampo} className="form-label small mb-1">
                        {campo === 'start' ? t('fieldStart') : t('fieldEnd')}
                      </label>
                      <input
                        id={idCampo}
                        className={`form-control form-control-sm${invalido ? ' is-invalid' : ''}`}
                        inputMode="decimal"
                        aria-invalid={invalido}
                        aria-describedby={invalido ? `${idCampo}-errore` : undefined}
                        value={bozza ?? formatTempo(valore)}
                        onChange={(e) => scrivi(n, campo, e.target.value)}
                        onBlur={() => conferma(n, campo)}
                      />
                      {invalido && (
                        <div id={`${idCampo}-errore`} className="invalid-feedback">
                          {t('invalidTime')}
                        </div>
                      )}
                    </div>
                  );
                })}
                <Button
                  size="xs"
                  color="primary"
                  outline
                  className="mb-1"
                  onClick={() => aggiorna(n, 'start', ora)}
                >
                  {t('setStart')}
                </Button>
                <Button
                  size="xs"
                  color="primary"
                  outline
                  className="mb-1"
                  onClick={() => aggiorna(n, 'end', ora)}
                >
                  {t('setEnd')}
                </Button>
                {hasVideo && (
                  <Button
                    size="xs"
                    color="primary"
                    outline
                    className="mb-1"
                    onClick={() => vaiA(r.start)}
                  >
                    {t('seek')}
                  </Button>
                )}
                <Button
                  size="xs"
                  color="danger"
                  outline
                  className="mb-1"
                  onClick={() => setRighe((x) => x.filter((_, i) => i !== n))}
                >
                  {t('remove')}
                </Button>
              </li>
            );
          })}
        </ol>
      )}
      <p className="mb-3" aria-live="polite">
        {t('total', { count: intervalli.length, seconds: secondiCoperti(intervalli) })}
      </p>
      {errore !== null && (
        <div className="alert alert-danger" role="alert">
          {t('actionError', { code: errore })}
        </div>
      )}
      <Button
        color="danger"
        disabled={invio || intervalli.length === 0}
        onClick={() => void invia()}
      >
        {t('submit')}
      </Button>
    </section>
  );
}
