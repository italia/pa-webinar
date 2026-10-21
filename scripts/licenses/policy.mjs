/**
 * Politica delle licenze per le dipendenze di produzione: quali licenze sono
 * ammesse, quali vietate, e come si valuta un'espressione SPDX.
 *
 * Un identificatore e' ammesso solo se e' nell'elenco AMMESSE (licenze
 * permissive, copyleft debole, la EUPL del progetto); e' vietato se
 * appartiene a una famiglia vietata (copyleft forte e licenze "source
 * available"); altrimenti e' sconosciuto: nomi non SPDX, LicenseRef,
 * "Proprietary". Nelle espressioni:
 *   - `A OR B` e' ammessa se almeno una delle due lo e': si sceglie quella;
 *   - `A AND B` e' ammessa se lo sono entrambe;
 *   - `A WITH eccezione` vale come `A`.
 * Un'espressione sconosciuta va verificata a mano e registrata tra le
 * eccezioni (exceptions.json); una vietata no.
 */

/** Licenze ammesse: permissive, copyleft debole (LGPL, MPL), EUPL. */
const ELENCO_AMMESSE = [
  'MIT',
  'MIT-0',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'Apache-2.0',
  'CC0-1.0',
  'CC-BY-3.0',
  'CC-BY-4.0',
  'BlueOak-1.0.0',
  'Python-2.0',
  'Unlicense',
  'Zlib',
  'BSL-1.0',
  'LGPL-2.1',
  'LGPL-2.1-only',
  'LGPL-2.1-or-later',
  'LGPL-3.0',
  'LGPL-3.0-only',
  'LGPL-3.0-or-later',
  'MPL-2.0',
  'EUPL-1.2',
];
export const AMMESSE = new Map(ELENCO_AMMESSE.map((id) => [id.toUpperCase(), id]));

/** Famiglie non ammesse. */
export const FAMIGLIE_VIETATE = [
  { nome: 'GPL', re: /^GPL(?:-|v|$)/i },
  { nome: 'AGPL', re: /^AGPL(?:-|v|$)/i },
  { nome: 'SSPL', re: /^SSPL(?:-|v|$)/i },
  { nome: 'Business Source License', re: /^BUSL-/i },
  { nome: 'Elastic License', re: /^Elastic-/i },
  { nome: 'PolyForm', re: /^PolyForm-/i },
  { nome: 'Creative Commons NonCommercial', re: /^CC-BY-NC/i },
  { nome: 'Commons Clause', re: /^Commons-Clause/i },
];

/** La famiglia vietata a cui appartiene un identificatore, o null. */
export function famigliaVietata(id) {
  const pulito = id.replace(/\+$/, '');
  return FAMIGLIE_VIETATE.find((f) => f.re.test(pulito))?.nome ?? null;
}

/** Vero se l'identificatore e' nell'elenco delle ammesse (`+` vale `-or-later`). */
export function ammessa(id) {
  const chiave = id.toUpperCase();
  return AMMESSE.has(chiave) || AMMESSE.has(chiave.replace(/\+$/, '-OR-LATER'));
}

const IDENTIFICATORE = /^[A-Za-z0-9.+-]+$/;

function tokenizza(testo) {
  return testo
    .replace(/\(/g, ' ( ')
    .replace(/\)/g, ' ) ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Analizza un'espressione SPDX in un albero:
 *   { tipo: 'id', id } | { tipo: 'or' | 'and', parti: [...] }
 * Lancia un errore se l'espressione non e' leggibile.
 */
export function analizza(testo) {
  const token = tokenizza(testo);
  let i = 0;
  const op = (nome) => token[i]?.toUpperCase() === nome;

  function fattore() {
    if (token[i] === '(') {
      i += 1;
      const dentro = espressione();
      if (token[i] !== ')') throw new Error('parentesi non chiusa');
      i += 1;
      return dentro;
    }
    const id = token[i];
    if (
      !id ||
      !IDENTIFICATORE.test(id) ||
      ['AND', 'OR', 'WITH'].includes(id.toUpperCase())
    ) {
      throw new Error(`identificatore atteso, trovato ${id ?? 'la fine'}`);
    }
    i += 1;
    if (op('WITH')) {
      i += 1;
      if (!token[i] || !IDENTIFICATORE.test(token[i]))
        throw new Error('eccezione mancante');
      i += 1;
    }
    return { tipo: 'id', id };
  }

  function termine() {
    const parti = [fattore()];
    while (op('AND')) {
      i += 1;
      parti.push(fattore());
    }
    return parti.length === 1 ? parti[0] : { tipo: 'and', parti };
  }

  function espressione() {
    const parti = [termine()];
    while (op('OR')) {
      i += 1;
      parti.push(termine());
    }
    return parti.length === 1 ? parti[0] : { tipo: 'or', parti };
  }

  if (token.length === 0) throw new Error('espressione vuota');
  const albero = espressione();
  if (i !== token.length) throw new Error(`testo in piu': ${token.slice(i).join(' ')}`);
  return albero;
}

function valutaAlbero(nodo) {
  if (nodo.tipo === 'id') {
    if (nodo.id.toUpperCase() === 'UNLICENSED')
      return { esito: 'sconosciuta', vietate: [] };
    const famiglia = famigliaVietata(nodo.id);
    if (famiglia) return { esito: 'vietata', vietate: [`${nodo.id} (${famiglia})`] };
    return { esito: ammessa(nodo.id) ? 'ammessa' : 'sconosciuta', vietate: [] };
  }
  const esiti = nodo.parti.map(valutaAlbero);
  const vietate = esiti.flatMap((e) => e.vietate);
  if (nodo.tipo === 'or') {
    if (esiti.some((e) => e.esito === 'ammessa'))
      return { esito: 'ammessa', vietate: [] };
    return {
      esito: esiti.some((e) => e.esito === 'vietata') ? 'vietata' : 'sconosciuta',
      vietate,
    };
  }
  if (esiti.some((e) => e.esito === 'vietata')) return { esito: 'vietata', vietate };
  if (esiti.some((e) => e.esito === 'sconosciuta'))
    return { esito: 'sconosciuta', vietate };
  return { esito: 'ammessa', vietate: [] };
}

/**
 * Valuta la licenza dichiarata da un pacchetto.
 * @returns {{ esito: 'ammessa' | 'vietata' | 'sconosciuta', vietate: string[] }}
 */
export function valuta(licenza) {
  if (typeof licenza !== 'string' || !licenza.trim())
    return { esito: 'sconosciuta', vietate: [] };
  try {
    return valutaAlbero(analizza(licenza));
  } catch {
    return { esito: 'sconosciuta', vietate: [] };
  }
}
