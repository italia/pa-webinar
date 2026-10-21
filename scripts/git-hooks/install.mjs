#!/usr/bin/env node
/**
 * Installa i git hook del repository impostando `core.hooksPath` su
 * scripts/git-hooks. Lo lancia `npm install` (script `prepare`).
 *
 * Non sovrascrive un `core.hooksPath` gia' impostato su un'altra cartella
 * (gli hook di chi sviluppa o della sua organizzazione): avvisa e basta.
 * `--force` (npm run hooks:install) lo imposta comunque. Fuori da un
 * repository git, o senza git, non fa nulla e non fallisce.
 */
import { spawnSync } from 'node:child_process';

const CARTELLA = 'scripts/git-hooks';
const forza = process.argv.includes('--force');

const attuale = spawnSync('git', ['config', '--get', 'core.hooksPath'], {
  encoding: 'utf8',
});
if (attuale.error) process.exit(0);
const valore = (attuale.stdout ?? '').trim();

if (valore && valore !== CARTELLA && !forza) {
  console.warn(
    `core.hooksPath is set to "${valore}": the hooks of this repository are not installed. ` +
      'Run "npm run hooks:install" to use them instead.'
  );
  process.exit(0);
}
if (valore !== CARTELLA) {
  spawnSync('git', ['config', 'core.hooksPath', CARTELLA], { stdio: 'ignore' });
}
