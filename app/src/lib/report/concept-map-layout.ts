/**
 * La disposizione della mappa concettuale del resoconto, senza librerie: i
 * temi su un anello interno attorno al titolo, gli altri nodi (concetti,
 * soggetti, esiti) su un anello esterno, ciascuno vicino ai temi a cui e'
 * collegato. Deterministica: la stessa mappa si disegna sempre uguale, sul
 * server e nel browser.
 */
import type { ConceptKind, ReportNarrative } from './types';

export interface NodoDisposto {
  id: string;
  label: string;
  kind: ConceptKind | 'center';
  x: number;
  y: number;
  /** Le righe dell'etichetta, gia' spezzate. */
  righe: string[];
  larghezza: number;
  altezza: number;
}

export interface ArcoDisposto {
  from: string;
  to: string;
  label: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface MappaDisposta {
  width: number;
  height: number;
  nodes: NodoDisposto[];
  edges: ArcoDisposto[];
}

const LARGHEZZA = 900;
const ALTEZZA = 640;
const CARATTERI_RIGA = 18;
const PX_CARATTERE = 7.9;
const ALTEZZA_RIGA = 18;

/** L'etichetta in al piu' due righe, spezzando tra le parole. */
export function righeEtichetta(label: string, max: number = CARATTERI_RIGA): string[] {
  const parole = label.split(/\s+/).filter(Boolean);
  const righe: string[] = [];
  let corrente = '';
  for (const p of parole) {
    const prova = corrente ? `${corrente} ${p}` : p;
    if (prova.length <= max || !corrente) corrente = prova;
    else {
      righe.push(corrente);
      corrente = p;
    }
  }
  if (corrente) righe.push(corrente);
  if (righe.length <= 2)
    return righe.map((r) => (r.length > max + 6 ? `${r.slice(0, max + 5)}…` : r));
  const seconda = righe.slice(1).join(' ');
  return [righe[0]!, seconda.length > max ? `${seconda.slice(0, max - 1)}…` : seconda];
}

function scatola(label: string): { righe: string[]; larghezza: number; altezza: number } {
  const righe = righeEtichetta(label);
  const piuLunga = Math.max(...righe.map((r) => r.length), 4);
  return {
    righe,
    larghezza: Math.round(piuLunga * PX_CARATTERE + 26),
    altezza: righe.length * ALTEZZA_RIGA + 14,
  };
}

/** Angoli distribuiti attorno a un desiderato, con una distanza minima. */
function distribuisci(desiderati: number[], minimo: number): number[] {
  const ordine = desiderati.map((a, i) => ({ a, i })).sort((p, q) => p.a - q.a);
  const out = new Array<number>(desiderati.length);
  // Due passate: avanti spinge in avanti, poi si ricentra sul gruppo.
  const posti: number[] = [];
  for (const { a } of ordine) {
    const prima = posti[posti.length - 1];
    posti.push(prima !== undefined && a - prima < minimo ? prima + minimo : a);
  }
  const scarto =
    posti.length > 0 ? (posti[posti.length - 1]! - ordine[ordine.length - 1]!.a) / 2 : 0;
  ordine.forEach(({ i }, k) => {
    out[i] = posti[k]! - scarto;
  });
  return out;
}

/** Dentro il disegno, con il margine della scatola. */
function dentro(n: NodoDisposto, width: number, height: number): void {
  n.x = Math.min(width - n.larghezza / 2 - 4, Math.max(n.larghezza / 2 + 4, n.x));
  n.y = Math.min(height - n.altezza / 2 - 4, Math.max(n.altezza / 2 + 4, n.y));
}

/**
 * Le scatole che si sovrappongono si allontanano, lungo l'asse dove si
 * sovrappongono meno, finche' non c'e' spazio tra tutte (o finiscono i giri).
 * Il titolo al centro resta fermo. Deterministica.
 */
function separa(nodes: NodoDisposto[], width: number, height: number): void {
  const spazio = 8;
  for (const n of nodes) dentro(n, width, height);
  for (let giro = 0; giro < 120; giro++) {
    let mosso = false;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        const sx = (a.larghezza + b.larghezza) / 2 + spazio - Math.abs(a.x - b.x);
        const sy = (a.altezza + b.altezza) / 2 + spazio - Math.abs(a.y - b.y);
        if (sx <= 0 || sy <= 0) continue;
        mosso = true;
        const fermoA = a.kind === 'center';
        const fermoB = b.kind === 'center';
        const quotaA = fermoA ? 0 : fermoB ? 1 : 0.5;
        const quotaB = 1 - quotaA;
        // Si sposta lungo l'asse con la sovrapposizione minore (pesata: in
        // verticale le scatole sono basse, basta poco).
        if (sy <= sx * 0.6) {
          const verso = a.y < b.y || (a.y === b.y && i < j) ? -1 : 1;
          a.y += verso * sy * quotaA;
          b.y -= verso * sy * quotaB;
        } else {
          const verso = a.x < b.x || (a.x === b.x && i < j) ? -1 : 1;
          a.x += verso * sx * quotaA;
          b.x -= verso * sx * quotaB;
        }
        dentro(a, width, height);
        dentro(b, width, height);
      }
    }
    if (!mosso) return;
  }
}

export function disponiMappa(
  mappa: ReportNarrative['conceptMap'],
  titolo: string,
  dimensioni: { width?: number; height?: number } = {}
): MappaDisposta {
  const width = dimensioni.width ?? LARGHEZZA;
  const height = dimensioni.height ?? ALTEZZA;
  const cx = width / 2;
  const cy = height / 2;
  const temi = mappa.nodes.filter((n) => n.kind === 'topic');
  const altri = mappa.nodes.filter((n) => n.kind !== 'topic');
  // Ellissi che usano tutto il disegno: l'interno per i temi, l'esterno per il resto.
  const interno =
    altri.length > 0
      ? { rx: width * 0.25, ry: height * 0.27 }
      : { rx: width * 0.36, ry: height * 0.38 };
  const esterno = { rx: width * 0.41, ry: height * 0.42 };

  const posizioni = new Map<string, { x: number; y: number; angolo: number }>();
  const anello = (
    lista: typeof mappa.nodes,
    raggi: { rx: number; ry: number },
    angoli: number[]
  ) => {
    lista.forEach((n, i) => {
      const a = angoli[i]!;
      posizioni.set(n.id, {
        x: cx + raggi.rx * Math.cos(a),
        y: cy + raggi.ry * Math.sin(a),
        angolo: a,
      });
    });
  };
  // Senza temi, tutti sull'anello interno.
  const interni = temi.length > 0 ? temi : altri;
  const esterni = temi.length > 0 ? altri : [];
  const inizio = -Math.PI / 2;
  anello(
    interni,
    interno,
    interni.map((_, i) => inizio + (2 * Math.PI * i) / Math.max(1, interni.length))
  );

  // Ogni nodo esterno verso la media degli angoli dei temi a cui e' collegato.
  const vicini = (id: string) =>
    mappa.edges
      .filter((e) => e.from === id || e.to === id)
      .map((e) => (e.from === id ? e.to : e.from))
      .filter((v) => posizioni.has(v));
  const desiderati = esterni.map((n, i) => {
    const angoli = vicini(n.id).map((v) => posizioni.get(v)!.angolo);
    if (angoli.length === 0)
      return inizio + (2 * Math.PI * (i + 0.5)) / Math.max(1, esterni.length);
    const sx = angoli.reduce((t, a) => t + Math.cos(a), 0);
    const sy = angoli.reduce((t, a) => t + Math.sin(a), 0);
    return Math.atan2(sy, sx);
  });
  const minimo = Math.min((2 * Math.PI) / Math.max(1, esterni.length), 0.42);
  anello(esterni, esterno, distribuisci(desiderati, minimo));

  const nodes: NodoDisposto[] = [];
  const conCentro = temi.length > 0 && titolo.trim().length > 0;
  if (conCentro) {
    const s = scatola(titolo);
    nodes.push({ id: '__centro', label: titolo, kind: 'center', x: cx, y: cy, ...s });
  }
  for (const n of mappa.nodes) {
    const p = posizioni.get(n.id);
    if (!p) continue;
    nodes.push({ id: n.id, label: n.label, kind: n.kind, x: p.x, y: p.y, ...scatola(n.label) });
  }
  separa(nodes, width, height);
  const dove = new Map(nodes.map((n) => [n.id, n]));
  const edges: ArcoDisposto[] = [];
  if (conCentro) {
    for (const t of temi) {
      const b = dove.get(t.id)!;
      edges.push({
        from: '__centro',
        to: t.id,
        label: '',
        x1: cx,
        y1: cy,
        x2: b.x,
        y2: b.y,
      });
    }
  }
  for (const e of mappa.edges) {
    const a = dove.get(e.from);
    const b = dove.get(e.to);
    if (!a || !b) continue;
    edges.push({
      from: e.from,
      to: e.to,
      label: e.label,
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
    });
  }
  return { width, height, nodes, edges };
}
