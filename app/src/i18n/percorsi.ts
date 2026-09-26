import { routing } from './routing';

/**
 * Riconoscimento di un percorso interno contro la mappa degli indirizzi.
 *
 * Il router vuole i percorsi dinamici come modello + parametri
 * (`{ pathname: '/events/[slug]', params: { slug } }`); il resto
 * dell'applicazione li costruisce come stringhe (`/events/${slug}`), e cosi'
 * li scrivono le email e il calendario. Questo modulo e' il ponte, e ce n'e'
 * uno solo: il router, i link e le email leggono la stessa mappa.
 */

export type PercorsoInterno = keyof typeof routing.pathnames;

/** I percorsi senza segnaposto: gli unici che un link accetta come stringa. */
export type PercorsoStatico = Exclude<PercorsoInterno, `${string}[${string}`>;

type Localizzati = Record<string, string | Record<string, string>>;

interface Modello {
  interno: PercorsoInterno;
  schema: RegExp;
  parametri: string[];
}

function compila(modello: string): { schema: RegExp; parametri: string[] } {
  const parametri: string[] = [];
  const corpo = modello
    .split('/')
    .map((seg) => {
      const m = /^\[(.+)\]$/.exec(seg);
      if (!m) return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      parametri.push(m[1] ?? '');
      return '([^/]+)';
    })
    .join('/');
  return { schema: new RegExp(`^${corpo}$`), parametri };
}

// Ogni percorso interno si riconosce anche nelle sue forme localizzate: gli
// indirizzi scritti nella configurazione del sito (il footer, per esempio)
// arrivano come li vede chi li ha digitati, cioe' gia' in italiano.
// I modelli senza segnaposto prima: `/admin/events/calls` e' una pagina a se',
// non il valore `calls` del segnaposto `/admin/events/[id]`. A parita', la
// forma interna prima di quelle localizzate.
const MODELLI: Modello[] = (
  Object.entries(routing.pathnames as Localizzati) as [PercorsoInterno, Localizzati[string]][]
)
  .flatMap(([interno, voce]) => {
    const forme = new Set<string>([interno]);
    if (typeof voce === 'string') forme.add(voce);
    else Object.values(voce).forEach((f) => forme.add(f));
    return [...forme].map((forma) => ({ interno, ...compila(forma) }));
  })
  .sort((a, b) => a.parametri.length - b.parametri.length);

export interface PercorsoRiconosciuto {
  pathname: PercorsoInterno;
  params: Record<string, string>;
  query: Record<string, string>;
  hash: string;
}

function separa(percorso: string): { base: string; query: string; hash: string } {
  const h = percorso.indexOf('#');
  const hash = h === -1 ? '' : percorso.slice(h + 1);
  const senzaHash = h === -1 ? percorso : percorso.slice(0, h);
  const q = senzaHash.indexOf('?');
  return {
    base: q === -1 ? senzaHash : senzaHash.slice(0, q),
    query: q === -1 ? '' : senzaHash.slice(q + 1),
    hash,
  };
}

// Un `%` isolato (un indirizzo scritto a mano nella configurazione) fa
// lanciare `decodeURIComponent`: il segmento resta com'e' invece di far cadere
// la pagina che lo sta disegnando.
function decodifica(segmento: string): string {
  try {
    return decodeURIComponent(segmento);
  } catch {
    return segmento;
  }
}

/** Il modello della mappa che corrisponde al percorso, oppure `null`. */
export function riconosci(percorso: string): PercorsoRiconosciuto | null {
  const { base, query, hash } = separa(percorso);
  for (const { interno, schema, parametri } of MODELLI) {
    const m = schema.exec(base);
    if (!m) continue;
    const params: Record<string, string> = {};
    parametri.forEach((nome, i) => {
      params[nome] = decodifica(m[i + 1] ?? '');
    });
    return {
      pathname: interno,
      params,
      query: Object.fromEntries(new URLSearchParams(query)),
      hash,
    };
  }
  return null;
}

/**
 * Il percorso con i segmenti nella lingua indicata, senza prefisso di lingua.
 * Un percorso che la mappa non conosce passa com'e'.
 */
export function traduci(percorso: string, locale: string): string {
  const { base, query, hash } = separa(percorso);
  const r = riconosci(base);
  if (!r) return percorso;
  const voce = (routing.pathnames as Localizzati)[r.pathname] ?? r.pathname;
  const modello = typeof voce === 'string' ? voce : (voce[locale] ?? r.pathname);
  const pieno = modello.replace(/\[([^\]]+)\]/g, (_, nome: string) =>
    encodeURIComponent(r.params[nome] ?? ''),
  );
  return `${pieno}${query ? `?${query}` : ''}${hash ? `#${hash}` : ''}`;
}
