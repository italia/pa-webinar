import fs from 'fs';
import path from 'path';

import { describe, it, expect } from 'vitest';

/**
 * Le lingue in cui si chiede un CONSENSO devono essere complete. Tutte.
 *
 * I cataloghi non-it/en sono fermi a snapshot più vecchi e `request.ts` copre i
 * buchi ricadendo sull'italiano — il che evita la chiave grezza a schermo, ma
 * significa che dove manca la traduzione l'utente legge ITALIANO. Per il grosso
 * del prodotto è un difetto estetico; per queste tre aree no:
 *
 *   • `waiting` — la sala d'attesa è la schermata dove si preme "Entra", e
 *     ospita l'informativa sulla registrazione e quella sull'elaborazione AI;
 *   • `gdpr` — i testi di consenso veri e propri, compreso quello alla traccia
 *     audio separata (art. 9 GDPR), che è un hard-gate all'ingresso;
 *   • `legal` — privacy e accessibilità, i documenti che l'ente pubblica.
 *
 * Chiedere a una persona bulgara di acconsentire in italiano non è un consenso
 * informato. Questo test è il motivo per cui non può ricapitare in silenzio:
 * una chiave nuova in una di queste aree fallisce la suite finché non esiste in
 * tutte le lingue che il sito dichiara di parlare (ADR-008).
 *
 * Il resto del catalogo NON è coperto qui di proposito: ha ancora un arretrato
 * consistente (soprattutto `admin`, rivolto a chi opera), e un test che fallisce
 * sempre non lo leggerebbe più nessuno.
 */

const MESSAGES_DIR = path.resolve(__dirname, 'messages');
const CONSENT_NAMESPACES = ['waiting', 'gdpr', 'legal'] as const;

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

const LOCALES = fs
  .readdirSync(MESSAGES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''))
  .sort();

const italian = load('it');

describe('cataloghi di consenso', () => {
  it('il sito dichiara 24 lingue', () => {
    // Se questo numero cambia, è una decisione — non una svista.
    expect(LOCALES.length).toBe(24);
  });

  for (const locale of LOCALES) {
    if (locale === 'it') continue;
    it(`${locale}: nessuna chiave di consenso manca`, () => {
      const catalogue = load(locale);
      const missing = Object.keys(italian)
        .filter((k) => CONSENT_NAMESPACES.some((ns) => k.startsWith(`${ns}.`)))
        .filter((k) => !(k in catalogue));
      expect(missing, `${locale} leggerebbe in italiano: ${missing.join(', ')}`).toEqual([]);
    });

    it(`${locale}: nessuna chiave di consenso è vuota`, () => {
      // Una stringa vuota supera il controllo di presenza ma in `request.ts`
      // ricade comunque sull'italiano: sarebbe un buco che non si vede.
      const catalogue = load(locale);
      const blank = Object.entries(catalogue)
        .filter(([k]) => CONSENT_NAMESPACES.some((ns) => k.startsWith(`${ns}.`)))
        .filter(([, v]) => typeof v === 'string' && v.trim().length === 0)
        .map(([k]) => k);
      expect(blank).toEqual([]);
    });
  }
});
