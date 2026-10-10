/**
 * Il testo del resoconto come arriva dal worker, ricondotto alla forma che la
 * pagina sa disegnare (lib/report/types). Il worker normalizza gia', ma un
 * modello linguistico puo' sempre rispondere fuori forma: qui si tengono solo
 * stringhe, nei limiti, con gli enumerati riconosciuti, e una mappa
 * concettuale con archi tra nodi che esistono.
 *
 * Tutto e' testo semplice: la pagina non lo interpreta come HTML ne' come
 * Markdown.
 */
import type { Agreement, ConceptKind, ReportNarrative, Stance } from './types';

const LIMITI = {
  titolo: 140,
  abstract: 900,
  sintesi: 6000,
  voce: 400,
  spiegazione: 1600,
  elenco: 8,
  temi: 8,
  punti: 6,
  posizioni: 6,
  citazioni: 5,
  nodi: 24,
  archi: 40,
  etichetta: 60,
  etichettaArco: 40,
} as const;

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+/gu;
// Un telefono internazionale: "+", il prefisso del paese, il prefisso locale
// anche tra parentesi, poi gruppi di cifre.
const INTERNAZIONALE = /(?<![\w+])\+\d{1,3}[ .\-]?(?:\(\d{1,4}\)[ .\-]?)?\d{1,5}(?:[ .\-]?\d{2,5}){1,4}(?![\d.,])/g;
// Un telefono nazionale: comincia per 0 o 3, ha da 9 a 11 cifre.
const NAZIONALE = /(?<![\w.,])[03]\d(?:[ .\-]?\d){7,10}(?![\d.,])/g;
const cifre = (m: string) => m.replace(/\D/g, '').length;
// Davanti a un codice pubblico (CIG, CUP, partita IVA, numeri di atti) il
// numero non e' un telefono.
const CODICE = /(?:\bCIG|\bCUP|\bIVA|\bfiscale|\bn\.|\bnr\.?|\bnum(?:ero)?\.?|\bart\.?|\bprot\.?)\s*[:°]?\s*$/i;

/**
 * Un importo a gruppi di tre ("300 000 000", "+1.500.000"), una data, due anni
 * di seguito o un codice pubblico non sono un telefono.
 */
function sembraTelefono(m: string, prima: string, minimo: number): boolean {
  const n = cifre(m);
  if (n < minimo || n > 15) return false;
  const nudo = m.replace(/^\+/, '');
  if (/^\d{1,3}(?:[ .]\d{3})+$/.test(nudo)) return false;
  if (/^\d{1,2}[.\-]\d{1,2}[.\-]\d{2,4}/.test(nudo)) return false;
  if ((nudo.match(/(?:^|\D)(?:19|20)\d{2}(?=\D|$)/g) ?? []).length >= 2) return false;
  // Un numero tutto attaccato che comincia per 0 e' piu' spesso un codice
  // (partita IVA, CIG) che un telefono, scritto di solito a gruppi.
  if (/^0\d+$/.test(nudo)) return false;
  return !CODICE.test(prima);
}

/**
 * Indirizzi email e numeri di telefono non entrano nel resoconto, anche se il
 * modello li riprende dalla chat o dai commenti. Gli importi, gli anni, le
 * date e i codici pubblici restano.
 */
function senzaRecapiti(t: string): string {
  const sostituisci = (minimo: number) => (m: string, inizio: number, tutto: string) =>
    sembraTelefono(m, tutto.slice(Math.max(0, inizio - 24), inizio), minimo) ? '[…]' : m;
  return t
    .replace(EMAIL, '[…]')
    .replace(INTERNAZIONALE, sostituisci(8))
    .replace(NAZIONALE, sostituisci(9));
}

function testo(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  // Niente caratteri di controllo (tranne a capo), spazi ripuliti.
  const pulito = senzaRecapiti(v)
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return pulito.length > max ? `${pulito.slice(0, max - 1).trimEnd()}…` : pulito;
}

function elenco(
  v: unknown,
  max: number = LIMITI.elenco,
  lunghezza: number = LIMITI.voce
): string[] {
  if (!Array.isArray(v)) return [];
  const visti = new Set<string>();
  const out: string[] = [];
  for (const x of v) {
    const t = testo(
      typeof x === 'object' && x !== null && 'text' in x
        ? (x as { text: unknown }).text
        : x,
      lunghezza
    );
    if (!t || visti.has(t.toLowerCase())) continue;
    visti.add(t.toLowerCase());
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

const STANZE: Record<string, Stance> = {
  support: 'support',
  favore: 'support',
  favorevole: 'support',
  pro: 'support',
  agree: 'support',
  concern: 'concern',
  contrario: 'concern',
  contro: 'concern',
  preoccupazione: 'concern',
  disagree: 'concern',
  critica: 'concern',
  question: 'question',
  domanda: 'question',
  dubbio: 'question',
};

const ACCORDI: Record<string, Agreement> = {
  high: 'high',
  alto: 'high',
  ampio: 'high',
  mixed: 'mixed',
  misto: 'mixed',
  diviso: 'mixed',
  low: 'low',
  basso: 'low',
  unknown: 'unknown',
  sconosciuto: 'unknown',
};

const TIPI_NODO: Record<string, ConceptKind> = {
  topic: 'topic',
  tema: 'topic',
  argomento: 'topic',
  concept: 'concept',
  concetto: 'concept',
  actor: 'actor',
  attore: 'actor',
  soggetto: 'actor',
  outcome: 'outcome',
  risultato: 'outcome',
  esito: 'outcome',
};

const chiave = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

function oggetto(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

const MINUTO = /^(\d{1,2}:)?\d{1,2}:\d{2}$/;

function idNodo(v: unknown): string {
  const t = typeof v === 'string' || typeof v === 'number' ? String(v) : '';
  return (
    t
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      // Lettere e cifre di ogni alfabeto: una mappa in greco o in bulgaro resta.
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40)
  );
}

/** Il testo del resoconto in forma; null se non c'e' niente da mostrare. */
export function normalizzaNarrativa(grezzo: unknown): ReportNarrative | null {
  const d = oggetto(grezzo);
  const temi = (Array.isArray(d.topics) ? d.topics : [])
    .map((x) => {
      const t = oggetto(x);
      const titolo = testo(t.title, LIMITI.titolo);
      if (!titolo) return null;
      const start =
        typeof t.start === 'string' && MINUTO.test(t.start.trim())
          ? t.start.trim()
          : null;
      const posizioni = (Array.isArray(t.positions) ? t.positions : [])
        .map((p) => {
          const o = oggetto(p);
          const text = testo(o.text, LIMITI.voce);
          const stance = STANZE[chiave(o.stance)];
          return text && stance ? { stance, text } : null;
        })
        .filter((p): p is { stance: Stance; text: string } => p !== null)
        .slice(0, LIMITI.posizioni);
      return {
        title: titolo,
        explanation: testo(t.explanation, LIMITI.spiegazione),
        keyPoints: elenco(t.keyPoints, LIMITI.punti),
        start,
        agreement: ACCORDI[chiave(t.agreement)] ?? 'unknown',
        positions: posizioni,
      };
    })
    .filter((t): t is ReportNarrative['topics'][number] => t !== null)
    .slice(0, LIMITI.temi);

  const mappa = oggetto(d.conceptMap);
  const nodi: ReportNarrative['conceptMap']['nodes'] = [];
  const idVisti = new Set<string>();
  for (const x of Array.isArray(mappa.nodes) ? mappa.nodes : []) {
    const n = oggetto(x);
    const label = testo(n.label, LIMITI.etichetta);
    const id = idNodo(n.id) || idNodo(label);
    if (!label || !id || idVisti.has(id)) continue;
    idVisti.add(id);
    nodi.push({ id, label, kind: TIPI_NODO[chiave(n.kind)] ?? 'concept' });
    if (nodi.length >= LIMITI.nodi) break;
  }
  const archi: ReportNarrative['conceptMap']['edges'] = [];
  const coppie = new Set<string>();
  for (const x of Array.isArray(mappa.edges) ? mappa.edges : []) {
    const e = oggetto(x);
    const from = idNodo(e.from);
    const to = idNodo(e.to);
    if (!idVisti.has(from) || !idVisti.has(to) || from === to) continue;
    const coppia = [from, to].sort().join('|');
    if (coppie.has(coppia)) continue;
    coppie.add(coppia);
    archi.push({ from, to, label: testo(e.label, LIMITI.etichettaArco) });
    if (archi.length >= LIMITI.archi) break;
  }

  const consenso = oggetto(d.consensus);
  const partecipazione = oggetto(d.engagement);
  const benefici = oggetto(d.benefits);
  const valutazioni = oggetto(d.feedback);

  const narrativa: ReportNarrative = {
    title: testo(d.title, LIMITI.titolo),
    abstract: testo(d.abstract, LIMITI.abstract),
    summary: testo(d.summary, LIMITI.sintesi),
    highlights: elenco(d.highlights),
    topics: temi,
    conceptMap: { nodes: nodi, edges: archi },
    consensus: {
      summary: testo(consenso.summary, LIMITI.spiegazione),
      agreements: elenco(consenso.agreements),
      disagreements: elenco(consenso.disagreements),
    },
    engagement: {
      summary: testo(partecipazione.summary, LIMITI.spiegazione),
      observations: elenco(partecipazione.observations),
    },
    benefits: {
      summary: testo(benefici.summary, LIMITI.spiegazione),
      items: elenco(benefici.items),
    },
    feedback: {
      summary: testo(valutazioni.summary, LIMITI.spiegazione),
      strengths: elenco(valutazioni.strengths),
      improvements: elenco(valutazioni.improvements),
      quotes: elenco(valutazioni.quotes, LIMITI.citazioni, 300),
    },
    openQuestions: elenco(d.openQuestions),
    nextSteps: elenco(d.nextSteps),
  };
  if (!narrativa.abstract && !narrativa.summary && narrativa.topics.length === 0)
    return null;
  return narrativa;
}
