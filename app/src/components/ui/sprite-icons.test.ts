import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Ogni icona chiesta al foglio di sprite deve esistere nello sprite.
 *
 * `Icon` disegna `<use href="/svg/sprites.svg#<nome>">`: con un nome che lo
 * sprite non ha, il browser non segnala nulla e al posto dell'icona resta un
 * riquadro vuoto. Lo sprite servito dall'app e' la copia di quello di
 * bootstrap-italia (script `copy-sprites`), quindi il confronto si fa con
 * l'originale del pacchetto.
 *
 * Si raccolgono i nomi `it-…` scritti dove finiscono nello sprite: la prop
 * `icon` (anche dentro un'espressione, es. un ternario), la proprieta'
 * `icon`/`id` degli elenchi che la alimentano, l'`id` di `SvgIcon` e i
 * riferimenti diretti `sprites.svg#…`. Le classi CSS di .italia che iniziano
 * anch'esse per `it-` (es. `it-footer`) restano fuori.
 */

const require = createRequire(import.meta.url);
const APP = path.resolve(__dirname, '../../..');
const SRC = path.join(APP, 'src');

function simboliDelloSprite(): Set<string> {
  const sprite = readFileSync(require.resolve('bootstrap-italia/dist/svg/sprites.svg'), 'utf8');
  return new Set(Array.from(sprite.matchAll(/<symbol\b[^>]*\bid="([^"]+)"/g), (m) => m[1] ?? ''));
}

function sorgenti(): string[] {
  const file = (readdirSync(SRC, { recursive: true }) as string[])
    .map((f) => f.replace(/\\/g, '/'))
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.(test|spec)\.(ts|tsx)$/.test(f))
    .map((f) => path.join(SRC, f));
  // I modelli di evento del seed finiscono anch'essi in `Icon`.
  return [...file, path.join(APP, 'prisma/seed.ts')];
}

const LETTERALE = /['"`](it-[a-z0-9-]+)['"`]/g;

/** Il contenuto di `{ … }` a partire dalla graffa aperta in `inizio`. */
function espressione(testo: string, inizio: number): string {
  let profondita = 0;
  for (let i = inizio; i < testo.length; i++) {
    const c = testo[i];
    if (c === '{') profondita++;
    else if (c === '}') {
      profondita--;
      if (profondita === 0) return testo.slice(inizio + 1, i);
    }
  }
  return '';
}

function nomiDiIcona(testo: string): string[] {
  const nomi: string[] = [];
  const aggiungi = (re: RegExp) => {
    for (const m of testo.matchAll(re)) nomi.push(m[1] ?? '');
  };
  // <Icon icon="it-…" /> e simili.
  aggiungi(/\bicon\s*=\s*["'](it-[a-z0-9-]+)["']/g);
  // <Icon icon={cond ? 'it-a' : 'it-b'} />
  for (const m of testo.matchAll(/\bicon\s*=\s*\{/g)) {
    const dentro = espressione(testo, (m.index ?? 0) + m[0].length - 1);
    for (const l of dentro.matchAll(LETTERALE)) nomi.push(l[1] ?? '');
  }
  // Elenchi che alimentano le icone: { icon: 'it-…' }, { id: 'it-…' }.
  aggiungi(/\b(?:icon|id)\s*:\s*['"](it-[a-z0-9-]+)['"]/g);
  // <SvgIcon id="it-…" />
  aggiungi(/<SvgIcon\b[^>]*?\bid\s*=\s*["'](it-[a-z0-9-]+)["']/g);
  // Riferimenti diretti allo sprite.
  aggiungi(/sprites\.svg#(it-[a-z0-9-]+)/g);
  return nomi;
}

describe('icone dello sprite', () => {
  it('il raccoglitore riconosce le forme in uso', () => {
    const esempio = [
      `<Icon icon="it-copy" size="sm" />`,
      `<Icon icon={aperto ? 'it-collapse' : 'it-expand'} />`,
      `const voci = [{ href: '/admin', icon: 'it-settings' }];`,
      `const badge = [{ id: 'it-video', label: 'x' }];`,
      `<SvgIcon id="it-arrow-right" className="icon-sm" />`,
      `<div className="it-footer-main">`,
    ].join('\n');
    expect(nomiDiIcona(esempio).sort()).toEqual(
      ['it-arrow-right', 'it-collapse', 'it-copy', 'it-expand', 'it-settings', 'it-video'].sort(),
    );
  });

  it('ogni nome usato dal codice esiste nello sprite', () => {
    const simboli = simboliDelloSprite();
    expect(simboli.size).toBeGreaterThan(100);

    const mancanti: string[] = [];
    let trovati = 0;
    for (const f of sorgenti()) {
      const testo = readFileSync(f, 'utf8');
      for (const nome of nomiDiIcona(testo)) {
        trovati++;
        if (!simboli.has(nome)) mancanti.push(`${path.relative(APP, f)}: ${nome}`);
      }
    }
    // Se il raccoglitore smettesse di trovare qualcosa, il test passerebbe
    // senza controllare nulla.
    expect(trovati).toBeGreaterThan(50);
    expect(mancanti).toEqual([]);
  });
});
