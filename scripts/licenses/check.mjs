#!/usr/bin/env node
/**
 * Controlla le licenze delle dipendenze di produzione leggendo i lockfile:
 * nessuna famiglia vietata (vedi policy.mjs) e nessuna licenza assente o
 * illeggibile senza una verifica registrata in exceptions.json.
 *
 * Legge i lockfile e non node_modules: non serve installare nulla e il
 * risultato non dipende dalla piattaforma. Copre l'albero dei workspace
 * (app, lobby) e i pacchetti npm fuori dai workspace che finiscono in
 * un'immagine (recorder, controller, gateway dei sottotitoli). Le dipendenze
 * di solo sviluppo (`dev`) non entrano nelle immagini e sono escluse; quelle
 * `devOptional` si controllano lo stesso, per prudenza.
 *
 * Uso: node scripts/licenses/check.mjs
 * Esce con 1 se trova una violazione.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { valuta } from './policy.mjs';

const qui = dirname(fileURLToPath(import.meta.url));
const radice = resolve(qui, '..', '..');

export const LOCKFILE = [
  'package-lock.json',
  'infra/recorder/package-lock.json',
  'infra/recorder-controller/package-lock.json',
  'infra/captions/gateway/package-lock.json',
];

/** I pacchetti di produzione di un lockfile v2/v3: { nome, versione, licenza }. */
export function pacchettiDiProduzione(lock) {
  const out = [];
  for (const [percorso, voce] of Object.entries(lock.packages ?? {})) {
    if (!percorso.includes('node_modules/') || voce.link || voce.dev) continue;
    const nome = voce.name ?? percorso.slice(percorso.lastIndexOf('node_modules/') + 13);
    out.push({ nome, versione: voce.version, licenza: voce.license });
  }
  return out;
}

/**
 * Le violazioni di un insieme di pacchetti, con le eccezioni applicate.
 * Un'eccezione vale solo per una licenza dichiarata sconosciuta (assente,
 * non SPDX): la sostituisce con quella verificata a mano, che viene valutata
 * comunque. Una licenza dichiarata vietata resta vietata, con o senza
 * eccezione.
 */
export function violazioni(pacchetti, eccezioni, usate = new Set()) {
  const trovate = [];
  for (const p of pacchetti) {
    const chiave = `${p.nome}@${p.versione}`;
    const eccezione = eccezioni[chiave];
    let licenza = p.licenza;
    let { esito, vietate } = valuta(licenza);
    if (esito === 'sconosciuta' && eccezione) {
      usate.add(chiave);
      licenza = eccezione.license;
      ({ esito, vietate } = valuta(licenza));
    }
    if (esito === 'vietata') {
      trovate.push({
        chiave,
        motivo: `forbidden license ${vietate.join(', ')} (declared: ${licenza})`,
      });
    } else if (esito === 'sconosciuta') {
      trovate.push({
        chiave,
        motivo: `license missing, not SPDX or not on the allowed list (declared: ${licenza ?? 'none'})`,
      });
    }
  }
  return trovate;
}

function principale() {
  const eccezioni = JSON.parse(readFileSync(resolve(qui, 'exceptions.json'), 'utf8'));
  const usate = new Set();
  let totale = 0;
  let errori = 0;
  for (const relativo of LOCKFILE) {
    const percorso = resolve(radice, relativo);
    if (!existsSync(percorso)) {
      console.error(`✗ ${relativo}: lockfile not found`);
      errori += 1;
      continue;
    }
    const lock = JSON.parse(readFileSync(percorso, 'utf8'));
    // Solo i lockfile v2 e v3 hanno la mappa `packages` con le licenze: uno
    // piu' vecchio, o troncato, non deve passare senza controlli.
    if (!lock.packages || (lock.lockfileVersion ?? 1) < 2) {
      console.error(
        `✗ ${relativo}: lockfileVersion 2 or later expected (run npm install with npm 7+)`
      );
      errori += 1;
      continue;
    }
    const pacchetti = pacchettiDiProduzione(lock);
    totale += pacchetti.length;
    for (const v of violazioni(pacchetti, eccezioni, usate)) {
      console.error(`✗ ${relativo}: ${v.chiave}: ${v.motivo}`);
      errori += 1;
    }
  }
  for (const chiave of Object.keys(eccezioni)) {
    if (!usate.has(chiave)) {
      console.warn(
        `! exceptions.json: ${chiave} is not needed (no package at that version lacks a valid license); remove it`
      );
    }
  }
  if (errori > 0) {
    console.error(
      `\n${errori} problem(s). Replace the dependency, or verify its real license and record it ` +
        'in scripts/licenses/exceptions.json (see THIRD-PARTY-LICENSES.md).'
    );
    process.exit(1);
  }
  console.log(
    `Licenses: ${totale} production packages in ${LOCKFILE.length} lockfiles, none forbidden or unknown.`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principale();
}
