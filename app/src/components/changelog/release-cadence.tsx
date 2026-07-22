/**
 * Il ritmo dei rilasci: una tacca per versione lungo l'asse del tempo.
 *
 * Una "timeline" verticale accanto all'elenco sarebbe stata ridondante — la
 * pagina è GIÀ un elenco cronologico, e una linea con dei pallini non aggiunge
 * un'informazione: ridisegna un ordine che si vede da solo.
 *
 * Questa invece dice una cosa che l'elenco non può dire a colpo d'occhio: la
 * DENSITÀ. Trentasette versioni in meno di quattro mesi, ventisei delle quali in
 * un mese solo, raccontano che il progetto è vivo — che è esattamente la domanda
 * che si fa un'amministrazione prima di riusare software altrui, e la sola a cui
 * un elenco di trentasette schede non risponde senza scorrere fino in fondo.
 *
 * Niente JavaScript: è SVG servito dal server. Il `<title>` di ogni tacca dà il
 * tooltip nativo del browser, e l'insieme ha un equivalente testuale sopra —
 * perché un grafico non deve MAI essere l'unico posto in cui l'informazione
 * esiste (e infatti sotto c'è l'elenco completo).
 */

interface Release {
  version: string;
  date: string;
}

interface Props {
  releases: Release[];
  /** Versione in esecuzione, evidenziata. Vuota nelle build non taggate. */
  currentVersion: string;
  formatDate: (d: Date) => string;
  label: string;
}

const W = 720;
const H = 44;
const PAD = 8;

export default function ReleaseCadence({
  releases,
  currentVersion,
  formatDate,
  label,
}: Props) {
  const times = releases
    .map((r) => ({ ...r, t: new Date(r.date).getTime() }))
    .filter((r) => Number.isFinite(r.t))
    .sort((a, b) => a.t - b.t);

  // Meno di due punti non è un ritmo: è un punto. Non disegniamo nulla.
  if (times.length < 2) return null;

  const first = times[0]!.t;
  const last = times[times.length - 1]!.t;
  const span = Math.max(1, last - first);
  const x = (t: number) => PAD + ((t - first) / span) * (W - PAD * 2);

  // Confini di mese: danno la scala. Senza, la densità non si sa densità di che.
  const months: { at: number; label: string }[] = [];
  const cursor = new Date(first);
  cursor.setDate(1);
  cursor.setHours(0, 0, 0, 0);
  while (cursor.getTime() <= last) {
    const t = cursor.getTime();
    if (t >= first) {
      months.push({
        at: x(t),
        label: new Intl.DateTimeFormat('en', { month: 'short' })
          .format(cursor)
          .toUpperCase(),
      });
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      role="img"
      aria-label={label}
      style={{ display: 'block', overflow: 'visible' }}
    >
      <line
        x1={PAD}
        y1={H - 14}
        x2={W - PAD}
        y2={H - 14}
        stroke="#d4e0ec"
        strokeWidth={1}
      />
      {months.map((m) => (
        <g key={m.label + m.at}>
          <line x1={m.at} y1={H - 18} x2={m.at} y2={H - 10} stroke="#d4e0ec" strokeWidth={1} />
          <text x={m.at} y={H - 2} fontSize={9} fill="#5a6772" textAnchor="middle">
            {m.label}
          </text>
        </g>
      ))}
      {times.map((r) => {
        const isCurrent = r.version === currentVersion;
        return (
          <line
            key={r.version}
            x1={x(r.t)}
            y1={isCurrent ? 4 : 10}
            x2={x(r.t)}
            y2={H - 14}
            stroke={isCurrent ? '#008758' : 'var(--app-primary, #06c)'}
            strokeWidth={isCurrent ? 3 : 1.5}
            strokeLinecap="round"
            opacity={isCurrent ? 1 : 0.55}
          >
            <title>{`v${r.version} — ${formatDate(new Date(r.date))}`}</title>
          </line>
        );
      })}
    </svg>
  );
}
