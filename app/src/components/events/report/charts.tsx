/**
 * I grafici del resoconto dell'evento: SVG disegnati qui, senza librerie
 * esterne. Ogni grafico ha una descrizione per chi usa un lettore di schermo e
 * i suoi dati in una tabella nascosta alla vista.
 *
 * Colori della palette .italia, su superficie bianca (l'app e' solo a tema
 * chiaro).
 */
import type { ReactNode } from 'react';

export const COLORI = {
  primario: '#0066CC',
  scuro: '#17324D',
  secondario: '#5C6F82',
  verde: '#008758',
  ambra: '#F2A900',
  turchese: '#00838F',
  rosso: '#D9364F',
  griglia: '#E3E9EF',
  fondo: '#F5F7FB',
} as const;

function TabellaDati({
  titolo,
  colonne,
  righe,
}: {
  titolo: string;
  colonne: string[];
  righe: Array<Array<string | number>>;
}) {
  return (
    <table className="visually-hidden">
      <caption>{titolo}</caption>
      <thead>
        <tr>
          {colonne.map((c) => (
            <th key={c} scope="col">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {righe.map((r, i) => (
          <tr key={i}>
            {r.map((v, j) =>
              j === 0 ? (
                <th key={j} scope="row">
                  {v}
                </th>
              ) : (
                <td key={j}>{v}</td>
              )
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export interface Serie {
  chiave: string;
  etichetta: string;
  colore: string;
}

/** Colonne impilate nel tempo: le interazioni per intervallo, per tipo. */
export function GraficoAndamento({
  titolo,
  serie,
  punti,
  piccoIndice,
  etichettaTempo,
}: {
  titolo: string;
  serie: Serie[];
  punti: Array<{ etichetta: string; valori: Record<string, number> }>;
  piccoIndice: number;
  etichettaTempo: string;
}) {
  const W = 720;
  const H = 220;
  const margine = { sx: 34, dx: 8, alto: 12, basso: 26 };
  const larghezzaUtile = W - margine.sx - margine.dx;
  const altezzaUtile = H - margine.alto - margine.basso;
  const totali = punti.map((p) =>
    serie.reduce((t, s) => t + (p.valori[s.chiave] ?? 0), 0)
  );
  const massimo = Math.max(1, ...totali);
  const passo = larghezzaUtile / Math.max(1, punti.length);
  const larghezzaColonna = Math.max(2, passo * 0.72);
  const tacche = [0, Math.round(massimo / 2), massimo].filter(
    (v, i, a) => a.indexOf(v) === i
  );
  const ogni = Math.max(1, Math.ceil(punti.length / 8));
  return (
    <figure className="report-chart mb-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={titolo}
        className="w-100 h-auto"
      >
        {tacche.map((v) => {
          const y = margine.alto + altezzaUtile - (v / massimo) * altezzaUtile;
          return (
            <g key={v}>
              <line
                x1={margine.sx}
                x2={W - margine.dx}
                y1={y}
                y2={y}
                stroke={COLORI.griglia}
              />
              <text
                x={margine.sx - 6}
                y={y + 4}
                textAnchor="end"
                fontSize="11"
                fill={COLORI.secondario}
              >
                {v}
              </text>
            </g>
          );
        })}
        {punti.map((p, i) => {
          let base = margine.alto + altezzaUtile;
          const x = margine.sx + i * passo + (passo - larghezzaColonna) / 2;
          return (
            <g key={i}>
              {i === piccoIndice && totali[i]! > 0 && (
                <rect
                  x={margine.sx + i * passo}
                  y={margine.alto}
                  width={passo}
                  height={altezzaUtile}
                  fill={COLORI.fondo}
                />
              )}
              {serie.map((s) => {
                const v = p.valori[s.chiave] ?? 0;
                if (v <= 0) return null;
                const h = (v / massimo) * altezzaUtile;
                base -= h;
                return (
                  <rect
                    key={s.chiave}
                    x={x}
                    y={base}
                    width={larghezzaColonna}
                    height={h}
                    fill={s.colore}
                    rx={1}
                  />
                );
              })}
              {i % ogni === 0 && (
                <text
                  x={margine.sx + i * passo + passo / 2}
                  y={H - 8}
                  textAnchor="middle"
                  fontSize="11"
                  fill={COLORI.secondario}
                >
                  {p.etichetta}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="d-flex flex-wrap gap-3 small text-secondary mt-1">
        {serie.map((s) => (
          <span key={s.chiave} className="d-inline-flex align-items-center gap-1">
            <span
              aria-hidden="true"
              className="report-legend-dot"
              style={{ background: s.colore }}
            />
            {s.etichetta}
          </span>
        ))}
      </figcaption>
      <TabellaDati
        titolo={titolo}
        colonne={[etichettaTempo, ...serie.map((s) => s.etichetta)]}
        righe={punti.map((p) => [
          p.etichetta,
          ...serie.map((s) => p.valori[s.chiave] ?? 0),
        ])}
      />
    </figure>
  );
}

/** Barre orizzontali con il valore e la quota sul totale. */
export function BarreOrizzontali({
  titolo,
  voci,
  colore = COLORI.primario,
  formato,
}: {
  titolo: string;
  voci: Array<{ etichetta: string; valore: number }>;
  colore?: string;
  formato: (valore: number, quota: number | null) => string;
}) {
  const totale = voci.reduce((t, v) => t + v.valore, 0);
  const massimo = Math.max(1, ...voci.map((v) => v.valore));
  return (
    <div role="group" aria-label={titolo} className="report-bars">
      {voci.map((v) => {
        const quota = totale > 0 ? Math.round((v.valore / totale) * 100) : null;
        return (
          <div key={v.etichetta} className="mb-2">
            <div className="d-flex justify-content-between gap-3 small">
              <span>{v.etichetta}</span>
              <span className="fw-semibold text-nowrap">{formato(v.valore, quota)}</span>
            </div>
            <div className="report-bar-track" aria-hidden="true">
              <div
                className="report-bar-fill"
                style={{ width: `${(v.valore / massimo) * 100}%`, background: colore }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Accordo e disaccordo per voce, in barre divergenti dal centro. */
export function BarreAccordo({
  titolo,
  voci,
  etichettaAccordo,
  etichettaDisaccordo,
}: {
  titolo: string;
  voci: Array<{ etichetta: string; accordo: number; disaccordo: number }>;
  etichettaAccordo: string;
  etichettaDisaccordo: string;
}) {
  const massimo = Math.max(1, ...voci.map((v) => Math.max(v.accordo, v.disaccordo)));
  return (
    <figure className="report-chart mb-0">
      <div role="img" aria-label={titolo} className="report-diverging">
        <div className="report-diverging-head small text-secondary" aria-hidden="true">
          <span style={{ color: COLORI.rosso }}>{etichettaDisaccordo}</span>
          <span />
          <span style={{ color: COLORI.verde }}>{etichettaAccordo}</span>
        </div>
        {voci.map((v) => (
          <div key={v.etichetta} className="report-diverging-row">
            <div
              className="report-diverging-side report-diverging-left"
              aria-hidden="true"
            >
              <span className="small fw-semibold">{v.disaccordo || ''}</span>
              <div
                style={{
                  width: `${(v.disaccordo / massimo) * 100}%`,
                  background: COLORI.rosso,
                }}
              />
            </div>
            <div className="report-diverging-label small">{v.etichetta}</div>
            <div className="report-diverging-side" aria-hidden="true">
              <div
                style={{
                  width: `${(v.accordo / massimo) * 100}%`,
                  background: COLORI.verde,
                }}
              />
              <span className="small fw-semibold">{v.accordo || ''}</span>
            </div>
          </div>
        ))}
      </div>
      <TabellaDati
        titolo={titolo}
        colonne={['', etichettaAccordo, etichettaDisaccordo]}
        righe={voci.map((v) => [v.etichetta, v.accordo, v.disaccordo])}
      />
    </figure>
  );
}

/** La distribuzione delle risposte su una scala, in una barra al 100%. */
export function Distribuzione({
  titolo,
  scalaMin,
  distribuzione,
  descrizione,
}: {
  titolo: string;
  scalaMin: number;
  distribuzione: number[];
  descrizione: ReactNode;
}) {
  const totale = distribuzione.reduce((t, n) => t + n, 0);
  const n = distribuzione.length;
  // Dal rosso al verde passando per l'ambra, sui gradini della scala.
  const colore = (i: number) => {
    if (n <= 1) return COLORI.primario;
    const q = i / (n - 1);
    return q < 0.34 ? COLORI.rosso : q < 0.67 ? COLORI.ambra : COLORI.verde;
  };
  // Sul verde e sul rosso il numero va in bianco, sull'ambra in scuro.
  const testo = (i: number) => (colore(i) === COLORI.ambra ? COLORI.scuro : '#FFFFFF');
  return (
    <figure className="report-chart mb-3">
      <figcaption className="small mb-1">{descrizione}</figcaption>
      <div className="report-stack" role="img" aria-label={titolo}>
        {distribuzione.map((c, i) =>
          c > 0 ? (
            <div
              key={i}
              className="report-stack-part"
              style={{
                width: `${(c / Math.max(1, totale)) * 100}%`,
                background: colore(i),
                color: testo(i),
              }}
              title={`${scalaMin + i}: ${c}`}
            >
              {c / Math.max(1, totale) >= 0.08 ? scalaMin + i : ''}
            </div>
          ) : null
        )}
      </div>
      <TabellaDati
        titolo={titolo}
        colonne={['', '']}
        righe={distribuzione.map((c, i) => [String(scalaMin + i), c])}
      />
    </figure>
  );
}
