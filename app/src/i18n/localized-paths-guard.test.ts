// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Nessun indirizzo localizzato costruito a mano.
 *
 * `/${locale}/events/…` scrive il segmento inglese anche nelle lingue che lo
 * traducono (`/it/eventi/…`): il link passa da una redirezione, o finisce su
 * una pagina che non esiste. Gli indirizzi si derivano dalla mappa del router,
 * con `percorso()` nei link e `localizedPath()`/`localizedUrl()` fuori dal
 * router; l'unico posto che antepone la lingua e' `lib/utils/localized-url`.
 */

const SRC = join(__dirname, '..');
const AMMESSI = new Set(['lib/utils/localized-url.ts']);
// Un segmento `/${…lingua…}/` dentro un template, seguito da un altro segmento.
const COSTRUITO_A_MANO = /\/\$\{[^}]*\b(locale|lang|lingua|pagina)\b[^}]*\}\//;

function sorgenti(dir: string): string[] {
  const out: string[] = [];
  for (const nome of readdirSync(dir)) {
    const pieno = join(dir, nome);
    if (statSync(pieno).isDirectory()) out.push(...sorgenti(pieno));
    else if (/\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome)) out.push(pieno);
  }
  return out;
}

describe('indirizzi localizzati', () => {
  it('nessun file antepone la lingua a mano', () => {
    const trovati: string[] = [];
    for (const file of sorgenti(SRC)) {
      const rel = relative(SRC, file).split('\\').join('/');
      if (AMMESSI.has(rel)) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((riga, i) => {
          if (COSTRUITO_A_MANO.test(riga)) trovati.push(`${rel}:${i + 1}: ${riga.trim()}`);
        });
    }
    expect(trovati).toEqual([]);
  });
});
