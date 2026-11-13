#!/usr/bin/env node
// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * Intestazione SPDX dei file sorgente: licenza e titolare in testa a ogni file,
 * come chiede l'Allegato A delle linee guida AgID su acquisizione e riuso.
 *
 *   npm run license:headers            elenca i file tracciati senza intestazione
 *   npm run license:headers -- --fix   la aggiunge
 *
 * Il controllo sull'intero repository sta in headers.test.mjs, che la CI esegue
 * in Lint & Typecheck; l'hook pre-commit guarda i file nuovi.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Le righe dell'intestazione del progetto. */
export function intestazione(anno = new Date().getFullYear()) {
  return [
    'SPDX-License-Identifier: EUPL-1.2',
    `SPDX-FileCopyrightText: ${anno} Dipartimento per la Trasformazione Digitale`,
  ];
}

/** L'intestazione conta solo se sta in cima al file. */
const RIGHE_DI_TESTA = 8;

/** Fin dove si cerca l'avviso di licenza di un file di terzi. */
const RIGHE_AVVISO = 30;

const HASH = { apre: '# ', chiude: '' };
const SLASH = { apre: '// ', chiude: '' };
const TRATTINI = { apre: '-- ', chiude: '' };

/** Commenti di Go: non finiscono nei manifesti che il chart produce. */
const TEMPLATE_HELM = { apre: '{{- /* ', chiude: ' */ -}}' };

const PER_ESTENSIONE = {
  '.cjs': SLASH,
  '.conf': HASH,
  '.css': { apre: '/* ', chiude: ' */' },
  '.cts': SLASH,
  '.hcl': HASH,
  '.html': { apre: '<!-- ', chiude: ' -->' },
  '.js': SLASH,
  '.jsx': SLASH,
  '.lua': TRATTINI,
  '.mjs': SLASH,
  '.mts': SLASH,
  '.prisma': SLASH,
  '.ps1': HASH,
  '.py': HASH,
  '.scss': SLASH,
  '.sh': HASH,
  '.sql': TRATTINI,
  '.tf': HASH,
  '.tftpl': HASH,
  '.toml': HASH,
  '.ts': SLASH,
  '.tsx': SLASH,
  '.yaml': HASH,
  '.yml': HASH,
};

const ESCLUSI = [
  /^\.github\//, // configurazione della CI, non fa parte del software distribuito
  /^publiccode\.yml$/, // metadati: la licenza sta nel campo legal.license
  /^app\/next-env\.d\.ts$/, // generato da Next.js
  /^app\/prisma\/migrations\//, // una migrazione applicata non si tocca: Prisma ne confronta il checksum
  /^app\/public\//, // asset e file di terzi, ciascuno con la propria licenza
  /(^|\/)\.terraform\.lock\.hcl$/, // generato da OpenTofu
];

/** Le righe che devono restare prime: shebang, doctype, direttive di Docker, cloud-init e Python. */
const IN_CIMA =
  /^(#!|<!doctype|<\?xml|#\s*(syntax|escape|check)\s*=|#cloud-config|#.*coding[:=])/i;

/**
 * Con quale commento si scrive l'intestazione; null se il file non ne ha
 * bisogno. Il testo serve per gli script senza estensione, riconosciuti dallo
 * shebang.
 */
export function commentoDi(percorso, testo = '') {
  if (ESCLUSI.some((re) => re.test(percorso))) return null;
  if (/^infra\/helm\/[^/]+\/templates\/.+\.(ya?ml|tpl)$/.test(percorso))
    return TEMPLATE_HELM;
  if (/(^|\.)Dockerfile(\.|$)/.test(basename(percorso))) return HASH;
  if (extname(percorso) === '' && testo.startsWith('#!')) return HASH;
  return PER_ESTENSIONE[extname(percorso)] ?? null;
}

export function richiedeIntestazione(percorso, testo = '') {
  return commentoDi(percorso, testo) !== null;
}

/** Licenza e titolare in cima al file, quali che siano: un file di terzi tiene i suoi. */
export function haIntestazione(testo) {
  const testa = testo.split('\n', RIGHE_DI_TESTA).join('\n');
  return (
    /SPDX-License-Identifier:\s*\S/.test(testa) &&
    /SPDX-FileCopyrightText:\s*\S/.test(testa)
  );
}

/** Un avviso di licenza gia' presente: quella del progetto sarebbe una dichiarazione falsa. */
export function haAltroAvviso(testo) {
  const testa = testo.split('\n', RIGHE_AVVISO).join('\n');
  return /SPDX-|@license|©|\(c\)\s*(\d{4}|[A-Z])|\bcopyright\b|\blicen[sc]e[sd]?\b/i.test(
    testa
  );
}

function righeInCima(righe) {
  let n = 0;
  while (n < righe.length && IN_CIMA.test(righe[n])) n += 1;
  return n;
}

/** Il testo con l'intestazione; invariato se c'e' gia' o se il file ha un altro avviso. */
export function conIntestazione(percorso, testo, anno) {
  const commento = commentoDi(percorso, testo);
  if (!commento || haIntestazione(testo) || haAltroAvviso(testo)) return testo;
  const righe = testo.split('\n');
  const cima = righeInCima(righe);
  const blocco = intestazione(anno).map((r) => `${commento.apre}${r}${commento.chiude}`);
  const resto = righe.slice(cima);
  const separatore = resto.join('').trim() === '' ? [] : [''];
  return [...righe.slice(0, cima), ...blocco, ...separatore, ...resto].join('\n');
}

/** I file tracciati da Git che dovrebbero avere l'intestazione e non l'hanno. */
export function senzaIntestazione(radice) {
  const elenco = spawnSync('git', ['ls-files', '-z'], {
    cwd: radice,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (elenco.status !== 0) throw new Error(`git ls-files: ${elenco.stderr}`);
  return elenco.stdout
    .split('\0')
    .filter(Boolean)
    .filter((f) => existsSync(`${radice}/${f}`))
    .filter((f) => {
      const testo = readFileSync(`${radice}/${f}`, 'utf8');
      return richiedeIntestazione(f, testo) && !haIntestazione(testo);
    });
}

function principale() {
  const radice = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
  const mancanti = senzaIntestazione(radice);
  if (process.argv.includes('--fix')) {
    const saltati = [];
    for (const f of mancanti) {
      const percorso = `${radice}/${f}`;
      const byte = readFileSync(percorso);
      const testo = byte.toString('utf8');
      const nuovo = conIntestazione(f, testo);
      // Riscrivere un file non UTF-8 ne rovinerebbe i byte.
      if (nuovo === testo || !Buffer.from(testo, 'utf8').equals(byte)) saltati.push(f);
      else writeFileSync(percorso, nuovo);
    }
    process.stdout.write(
      `SPDX header added to ${mancanti.length - saltati.length} files.\n`
    );
    if (saltati.length) {
      process.stderr.write(
        `${saltati.map((f) => `${f}: not changed`).join('\n')}\n` +
          'These files carry another notice or are not UTF-8: write their SPDX header by hand.\n'
      );
      process.exitCode = 1;
    }
    return;
  }
  if (mancanti.length === 0) {
    process.stdout.write('Every source file has its SPDX header.\n');
    return;
  }
  process.stderr.write(
    `${mancanti.map((f) => `${f}: no SPDX header`).join('\n')}\n` +
      'Run npm run license:headers -- --fix to add it.\n'
  );
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  principale();
}
