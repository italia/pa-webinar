'use client';

/**
 * La mappa concettuale del resoconto, in SVG: il titolo al centro, i temi
 * attorno, concetti, soggetti ed esiti all'esterno (lib/report/concept-map-layout).
 * Al passaggio del puntatore un concetto mette in evidenza i suoi
 * collegamenti, con le loro etichette; un clic, un tocco o Invio lo tengono in
 * evidenza e un secondo lo toglie (Esc con la tastiera). L'anello del focus
 * compare solo con la tastiera. Per chi usa un lettore di schermo la mappa e'
 * anche un elenco: ogni concetto con i suoi collegamenti.
 */
import { useState, type FocusEvent, type KeyboardEvent } from 'react';

import { disponiMappa, type ArcoDisposto } from '@/lib/report/concept-map-layout';
import type { ConceptKind, ReportNarrative } from '@/lib/report/types';

import { COLORI } from './charts';

const STILI: Record<
  ConceptKind | 'center',
  { fondo: string; bordo: string; testo: string }
> = {
  center: { fondo: COLORI.scuro, bordo: COLORI.scuro, testo: '#FFFFFF' },
  topic: { fondo: COLORI.primario, bordo: COLORI.primario, testo: '#FFFFFF' },
  concept: { fondo: '#E6F0FA', bordo: COLORI.primario, testo: COLORI.scuro },
  actor: { fondo: '#FFF4D6', bordo: '#A66300', testo: COLORI.scuro },
  outcome: { fondo: '#E3F4EC', bordo: COLORI.verde, testo: COLORI.scuro },
};

/** Un arco leggermente curvo, verso l'esterno: meno sovrapposizioni al centro. */
function percorso(
  e: ArcoDisposto,
  cx: number,
  cy: number
): { d: string; mx: number; my: number } {
  const mx = (e.x1 + e.x2) / 2;
  const my = (e.y1 + e.y2) / 2;
  const qx = mx + (mx - cx) * 0.18;
  const qy = my + (my - cy) * 0.18;
  return {
    d: `M ${e.x1} ${e.y1} Q ${qx} ${qy} ${e.x2} ${e.y2}`,
    mx: (e.x1 + 2 * qx + e.x2) / 4,
    my: (e.y1 + 2 * qy + e.y2) / 4,
  };
}

export default function ConceptMap({
  mappa,
  titolo,
  descrizione,
  legenda,
}: {
  mappa: ReportNarrative['conceptMap'];
  titolo: string;
  descrizione: string;
  legenda: Record<ConceptKind, string>;
}) {
  const [sopra, setSopra] = useState<string | null>(null);
  const [anello, setAnello] = useState<string | null>(null);
  const [fissato, setFissato] = useState<string | null>(null);
  const attivo = sopra ?? fissato;
  const alterna = (id: string) => {
    if (fissato === id) {
      // Tolto: anche il passaggio del puntatore (o il tocco) si spegne.
      setFissato(null);
      setSopra(null);
    } else setFissato(id);
  };
  const tasto = (id: string) => (e: KeyboardEvent) => {
    // Chi usa la tastiera vede sempre dove si trova.
    setAnello(id);
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      alterna(id);
    } else if (e.key === 'Escape') setFissato(null);
  };
  // L'anello solo per il focus da tastiera, non al clic.
  const fuoco = (id: string) => (e: FocusEvent<SVGGElement>) => {
    let daTastiera = true;
    try {
      daTastiera = e.currentTarget.matches(':focus-visible');
    } catch {
      /* browser senza :focus-visible: l'anello si mostra sempre */
    }
    setAnello(daTastiera ? id : null);
  };
  const d = disponiMappa(mappa, titolo);
  const cx = d.width / 2;
  const cy = d.height / 2;
  const etichetta = new Map(mappa.nodes.map((n) => [n.id, n.label]));
  const collegato = (e: ArcoDisposto) =>
    attivo !== null && (e.from === attivo || e.to === attivo);
  const vicini = new Set(
    attivo ? d.edges.filter(collegato).flatMap((e) => [e.from, e.to]) : []
  );
  return (
    <figure className="report-chart mb-0">
      <svg
        viewBox={`0 0 ${d.width} ${d.height}`}
        role="group"
        aria-label={descrizione}
        className="w-100 h-auto report-map"
      >
        {d.edges.map((e, i) => {
          const { d: dd } = percorso(e, cx, cy);
          const centro = e.from === '__centro';
          const acceso = collegato(e);
          return (
            <path
              key={i}
              d={dd}
              fill="none"
              stroke={acceso ? COLORI.primario : centro ? '#B9C7D5' : '#8FA3B6'}
              strokeWidth={acceso ? 2.2 : centro ? 1.4 : 1.1}
              strokeDasharray={centro ? '4 4' : undefined}
              opacity={attivo && !acceso ? 0.15 : centro ? 0.9 : 0.55}
            />
          );
        })}
        {attivo &&
          d.edges
            .filter((e) => collegato(e) && e.label)
            .map((e, i) => {
              const { mx, my } = percorso(e, cx, cy);
              return (
                <text
                  key={`l${i}`}
                  x={mx}
                  y={my - 4}
                  textAnchor="middle"
                  fontSize="13"
                  fontWeight={600}
                  fill={COLORI.scuro}
                  paintOrder="stroke"
                  stroke="#FFFFFF"
                  strokeWidth={4}
                >
                  {e.label}
                </text>
              );
            })}
        {d.nodes.map((n) => {
          const s = STILI[n.kind];
          const spento =
            attivo !== null && n.id !== attivo && !vicini.has(n.id) && n.id !== anello;
          const interattivo = n.kind !== 'center';
          return (
            <g
              key={n.id}
              transform={`translate(${n.x - n.larghezza / 2} ${n.y - n.altezza / 2})`}
              opacity={spento ? 0.35 : 1}
              tabIndex={interattivo ? 0 : undefined}
              role={interattivo ? 'button' : undefined}
              aria-pressed={interattivo ? fissato === n.id : undefined}
              aria-label={
                interattivo ? `${n.label} (${legenda[n.kind as ConceptKind]})` : undefined
              }
              aria-hidden={interattivo ? undefined : true}
              onMouseEnter={interattivo ? () => setSopra(n.id) : undefined}
              onMouseLeave={interattivo ? () => setSopra(null) : undefined}
              onFocus={interattivo ? fuoco(n.id) : undefined}
              onBlur={interattivo ? () => setAnello(null) : undefined}
              onClick={interattivo ? () => alterna(n.id) : undefined}
              onKeyDown={interattivo ? tasto(n.id) : undefined}
              className={interattivo ? 'report-map-node' : undefined}
            >
              {/* L'anello del focus, ben visibile attorno alla scatola. */}
              {anello === n.id && (
                <rect
                  x={-5}
                  y={-5}
                  width={n.larghezza + 10}
                  height={n.altezza + 10}
                  rx={12}
                  fill="none"
                  stroke={COLORI.scuro}
                  strokeWidth={3}
                />
              )}
              <rect
                width={n.larghezza}
                height={n.altezza}
                rx={n.kind === 'topic' || n.kind === 'center' ? 10 : 7}
                fill={s.fondo}
                stroke={n.id === attivo ? COLORI.scuro : s.bordo}
                strokeWidth={n.id === attivo ? 2.5 : 1.5}
              />
              {n.righe.map((r, i) => (
                <text
                  key={i}
                  x={n.larghezza / 2}
                  y={7 + 14 + i * 18}
                  textAnchor="middle"
                  fontSize="14"
                  fontWeight={n.kind === 'topic' || n.kind === 'center' ? 600 : 400}
                  fill={s.testo}
                >
                  {r}
                </text>
              ))}
            </g>
          );
        })}
      </svg>
      <figcaption className="d-flex flex-wrap gap-3 small text-secondary mt-2">
        {(Object.keys(legenda) as ConceptKind[]).map((k) => (
          <span key={k} className="d-inline-flex align-items-center gap-1">
            <span
              aria-hidden="true"
              className="report-legend-dot"
              style={{
                background: STILI[k].fondo,
                border: `1.5px solid ${STILI[k].bordo}`,
              }}
            />
            {legenda[k]}
          </span>
        ))}
      </figcaption>
      <ul className="visually-hidden">
        {mappa.nodes.map((n) => (
          <li key={n.id}>
            {n.label} ({legenda[n.kind]})
            {mappa.edges
              .filter((e) => e.from === n.id)
              .map((e) => ` — ${e.label} ${etichetta.get(e.to) ?? ''}`)
              .join(';')}
          </li>
        ))}
      </ul>
    </figure>
  );
}
