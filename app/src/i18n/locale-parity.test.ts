import fs from 'fs';
import path from 'path';

import { describe, it, expect } from 'vitest';

/**
 * Le 24 lingue che il sito dichiara di parlare devono essere COMPLETE.
 *
 * Fino al 22 luglio 2026 non lo erano: 21 cataloghi su 24 mancavano esattamente
 * 664 chiavi su 2.945 (77% di copertura). Non si vedeva nulla di rotto, perché
 * `request.ts` copre i buchi ricadendo sull'italiano — quindi il difetto non era
 * una chiave grezza a schermo, era la LINGUA SBAGLIATA. Chiedere a una persona
 * bulgara di acconsentire alla registrazione della propria voce leggendo un
 * testo in italiano non è un consenso informato; e tre namespace interi
 * (`postprod`, `agenda`, `changelog`) erano assenti ovunque.
 *
 * Questo test è la ragione per cui l'arretrato non può ricrescere in silenzio.
 * Una chiave nuova aggiunta all'italiano fa fallire la suite finché non esiste
 * in tutte e 24 — che è scomodo, ed è il punto: la scomodità sta prima del
 * rilascio invece che addosso a chi legge.
 *
 * Il fallback in `request.ts` resta, come rete: serve alle chiavi che vengono
 * aggiunte e tradotte nello stesso cambiamento, non come politica.
 */

const MESSAGES_DIR = path.resolve(__dirname, 'messages');

/**
 * Un segnaposto ICU è `{nome}` o `{nome, tipo, …}` — NON il testo dentro un ramo
 * plurale. `{nessun voto}` è un messaggio: confonderlo con un argomento fa
 * gridare al lupo su ogni traduzione corretta di un plurale.
 */
const PLACEHOLDER = /\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:\}|,)/g;

type Catalogue = Record<string, unknown>;

function flatten(obj: Catalogue, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flatten(v as Catalogue, key));
    } else {
      out[key] = v;
    }
  }
  return out;
}

function load(locale: string): Record<string, unknown> {
  return flatten(
    JSON.parse(fs.readFileSync(path.join(MESSAGES_DIR, `${locale}.json`), 'utf-8')),
  );
}

/**
 * L'INSIEME dei nomi, non la lista.
 *
 * Il polacco ha quattro categorie plurali dove l'italiano ne ha due, quindi
 * ripete `{count}` in più rami — ed è esattamente ciò che deve fare. Contare le
 * occorrenze avrebbe bocciato la traduzione più corretta delle due.
 */
function placeholders(s: string): string[] {
  return [...new Set([...s.matchAll(PLACEHOLDER)].map((m) => m[1]!))].sort();
}

const LOCALES = fs
  .readdirSync(MESSAGES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''))
  .sort();

const italian = load('it');
const italianKeys = Object.keys(italian);

describe('cataloghi i18n', () => {
  it('il sito dichiara 24 lingue', () => {
    // Se questo numero cambia è una decisione, non una svista.
    expect(LOCALES.length).toBe(24);
  });

  for (const locale of LOCALES) {
    if (locale === 'it') continue;

    it(`${locale}: nessuna chiave manca`, () => {
      const catalogue = load(locale);
      const missing = italianKeys.filter((k) => !(k in catalogue));
      expect(
        missing,
        `${locale} leggerebbe in italiano ${missing.length} stringhe: ${missing.slice(0, 5).join(', ')}…`,
      ).toEqual([]);
    });

    it(`${locale}: nessuna stringa vuota`, () => {
      // Una stringa vuota supera il controllo di presenza ma in `request.ts`
      // ricade comunque sull'italiano: sarebbe un buco che non si vede.
      const catalogue = load(locale);
      const blank = Object.entries(catalogue)
        .filter(([, v]) => typeof v === 'string' && v.trim().length === 0)
        .map(([k]) => k);
      expect(blank).toEqual([]);
    });

    it(`${locale}: i segnaposto coincidono con l'originale`, () => {
      // È l'errore che rompe la pagina a runtime, non a schermo: un {count}
      // perso in traduzione diventa un messaggio senza il suo numero, o un
      // errore di formattazione ICU. Si confrontano i NOMI usati, non quante
      // volte: vedi `placeholders`.
      const catalogue = load(locale);
      const wrong: string[] = [];
      for (const key of italianKeys) {
        const src = italian[key];
        const dst = catalogue[key];
        if (typeof src !== 'string' || typeof dst !== 'string') continue;
        const a = placeholders(src);
        const b = placeholders(dst);
        if (a.join('|') !== b.join('|')) {
          wrong.push(`${key}: attesi [${a}], trovati [${b}]`);
        }
      }
      expect(wrong).toEqual([]);
    });
  }
});
