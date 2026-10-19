/**
 * Le traduzioni automatiche di titolo e descrizione come proposta
 * (Event.textTranslations): la forma salvata, la pulizia del testo che
 * arriva dal motore, e quali lingue di un modulo una proposta puo' riempire.
 *
 * Una proposta non sostituisce mai un testo scritto da una persona: riempie
 * solo i campi vuoti, e solo se viene dallo stesso testo di partenza
 * (`sourceHash`, lib/text-translation/source). Il salvataggio del wizard e'
 * la revisione umana.
 *
 * Funzioni pure, usate dal portale e dal wizard.
 */

export interface TextTranslations {
  version: 1;
  sourceLanguage: string;
  sourceHash: string;
  generatedAt: string;
  model: { id: string | null; version: string | null };
  /** Una voce per lingua tradotta; manca se il testo di partenza era vuoto. */
  title: Record<string, string>;
  description: Record<string, string>;
}

/** Il massimo che si salva per lingua: il doppio del testo di partenza ammesso. */
export const TITOLO_TRADOTTO_MAX = 600;
export const DESCRIZIONE_TRADOTTA_MAX = 20_000;

const LINGUA = /^[a-z]{2,3}(-[a-z]{2,4})?$/;

function testi(valore: unknown): Record<string, string> {
  if (!valore || typeof valore !== 'object' || Array.isArray(valore)) return {};
  const out: Record<string, string> = {};
  for (const [lingua, testo] of Object.entries(valore as Record<string, unknown>)) {
    if (LINGUA.test(lingua) && typeof testo === 'string' && testo.trim())
      out[lingua] = testo;
  }
  return out;
}

/** La proposta salvata, se ha la forma attesa. */
export function letturaTraduzioni(valore: unknown): TextTranslations | null {
  if (!valore || typeof valore !== 'object' || Array.isArray(valore)) return null;
  const v = valore as Partial<TextTranslations>;
  if (
    v.version !== 1 ||
    typeof v.sourceLanguage !== 'string' ||
    typeof v.sourceHash !== 'string'
  )
    return null;
  const model =
    v.model && typeof v.model === 'object' ? v.model : { id: null, version: null };
  return {
    version: 1,
    sourceLanguage: v.sourceLanguage,
    sourceHash: v.sourceHash,
    generatedAt: typeof v.generatedAt === 'string' ? v.generatedAt : '',
    model: {
      id: typeof model.id === 'string' ? model.id : null,
      version: typeof model.version === 'string' ? model.version : null,
    },
    title: testi(v.title),
    description: testi(v.description),
  };
}

// I caratteri di controllo, tranne a capo e tabulazione.
const CONTROLLO = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/**
 * Il titolo tradotto: una riga, e al piu' un «|» (il separatore del
 * sopratitolo, lib/utils/title-kicker), solo se il titolo di partenza ne ha
 * uno. Un «|» in piu' inventato dal modello sposterebbe il sopratitolo.
 */
export function normalizzaTitolo(tradotto: string, sorgente: string): string {
  let t = tradotto.replace(CONTROLLO, ' ').replace(/\s+/g, ' ').trim();
  const primo = t.indexOf('|');
  if (primo !== -1) {
    const prima = t.slice(0, primo);
    const dopo = t.slice(primo + 1).replace(/\|/g, ' ');
    t = (sorgente.includes('|') ? `${prima}|${dopo}` : `${prima} ${dopo}`)
      .replace(/ {2,}/g, ' ')
      .trim();
  }
  return t.slice(0, TITOLO_TRADOTTO_MAX).trim();
}

/**
 * La descrizione tradotta (Markdown): a capo uniformi, niente caratteri di
 * controllo. Gli spazi in fondo a una riga restano: in Markdown due spazi
 * vanno a capo.
 */
export function normalizzaDescrizione(tradotto: string): string {
  return tradotto
    .replace(/\r\n?/g, '\n')
    .replace(CONTROLLO, '')
    .trim()
    .slice(0, DESCRIZIONE_TRADOTTA_MAX)
    .trim();
}

const vuoto = (testo: string | undefined) => !testo || !testo.trim();

/**
 * Le lingue in cui la proposta riempie almeno un campo vuoto, se viene dal
 * testo di partenza che ha l'impronta `impronta`.
 */
export function proposteApplicabili(
  proposta: TextTranslations | null,
  impronta: string | null,
  titoli: Record<string, string>,
  descrizioni: Record<string, string>
): string[] {
  if (!proposta || !impronta || proposta.sourceHash !== impronta) return [];
  const lingue = new Set([
    ...Object.keys(proposta.title),
    ...Object.keys(proposta.description),
  ]);
  lingue.delete(proposta.sourceLanguage);
  return [...lingue]
    .filter(
      (l) =>
        (proposta.title[l] && vuoto(titoli[l])) ||
        (proposta.description[l] && vuoto(descrizioni[l]))
    )
    .sort();
}

/**
 * I testi del modulo con la proposta nei campi ancora vuoti delle `lingue`;
 * `riempite` sono le lingue in cui almeno un campo e' cambiato.
 */
export function applicaProposta(
  proposta: TextTranslations,
  lingue: readonly string[],
  titoli: Record<string, string>,
  descrizioni: Record<string, string>
): {
  title: Record<string, string>;
  description: Record<string, string>;
  riempite: string[];
} {
  const title = { ...titoli };
  const description = { ...descrizioni };
  const riempite: string[] = [];
  for (const l of lingue) {
    if (l === proposta.sourceLanguage) continue;
    let cambiata = false;
    if (proposta.title[l] && vuoto(title[l])) {
      title[l] = proposta.title[l];
      cambiata = true;
    }
    if (proposta.description[l] && vuoto(description[l])) {
      description[l] = proposta.description[l];
      cambiata = true;
    }
    if (cambiata) riempite.push(l);
  }
  return { title, description, riempite };
}
