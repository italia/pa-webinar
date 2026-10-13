#!/usr/bin/env node
/**
 * Esecutore dei git hook del repository (installati da `npm install` con
 * install.mjs, che imposta `core.hooksPath` su scripts/git-hooks se non e'
 * gia' impostato altrove; per forzarlo: `npm run hooks:install`).
 *
 *   pre-commit  controlli veloci sui file in stage: segreti, marcatori di
 *               conflitto, file troppo grandi, lint dei file toccati, tipi,
 *               test collegati, parita' delle lingue, migrazione per lo
 *               schema, licenze, formattazione dei file nuovi, tipi dei
 *               servizi e chart Helm quando sono toccati
 *   commit-msg  formato del messaggio (Conventional Commits, 72 caratteri)
 *   pre-push    gli stessi comandi della CI: lint, tipi e test sempre, gli
 *               altri job per le aree toccate dai commit che si stanno
 *               pubblicando, Trivy su una copia pulita di ogni commit
 *               (docs/development/methodology.md)
 *
 * Un controllo che richiede uno strumento assente (helm, trivy, pytest, un
 * database di prova) viene saltato con un avviso: la CI lo esegue comunque.
 * Per saltare gli hook in un caso eccezionale: `git commit --no-verify`,
 * `git push --no-verify`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  conflittiAggiunti,
  controlliPerFile,
  daFormattare,
  erroriMessaggio,
  righeAggiunte,
  segretiAggiunti,
} from './rules.mjs';

const RADICE = git(['rev-parse', '--show-toplevel']).trim();
const WINDOWS = process.platform === 'win32';
const LIMITE_FILE = 5 * 1024 * 1024;

const esito = { falliti: [], saltati: [], eseguiti: [] };

function git(args, opzioni = {}) {
  const r = spawnSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    ...opzioni,
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

function disponibile(comando, args = ['--version']) {
  const r = spawnSync(comando, args, { stdio: 'ignore', shell: WINDOWS });
  return r.status === 0;
}

/** Esegue un controllo e ne registra l'esito; l'output va dritto al terminale. */
function controllo(nome, comando, args, cwd = RADICE, env = {}) {
  process.stdout.write(`\n▶ ${nome}\n`);
  const inizio = Date.now();
  const r = spawnSync(comando, args, {
    cwd,
    stdio: 'inherit',
    shell: WINDOWS,
    env: { ...process.env, ...env },
  });
  const secondi = ((Date.now() - inizio) / 1000).toFixed(1);
  if (r.status === 0) {
    esito.eseguiti.push(`${nome} (${secondi}s)`);
  } else {
    esito.falliti.push(nome);
  }
}

function salta(nome, motivo) {
  esito.saltati.push(`${nome}: ${motivo}`);
}

function errore(nome, righe) {
  process.stdout.write(`\n✗ ${nome}\n${righe.map((r) => `  ${r}`).join('\n')}\n`);
  esito.falliti.push(nome);
}

function riepilogo(hook) {
  const out = [`\n── ${hook} ──`];
  for (const e of esito.eseguiti) out.push(`  ✓ ${e}`);
  for (const s of esito.saltati) out.push(`  - skipped ${s}`);
  for (const f of esito.falliti) out.push(`  ✗ ${f}`);
  if (esito.falliti.length) {
    out.push(
      `\n${hook} failed. Fix the problems above, or skip the hook once with --no-verify.`
    );
  }
  process.stdout.write(`${out.join('\n')}\n`);
  process.exit(esito.falliti.length ? 1 : 0);
}

const relativo = (dir, file) => file.map((f) => f.slice(dir.length + 1));

// ───────────────────────── controlli condivisi ─────────────────────────

function controlliLicenze(c, { report }) {
  if (!c.licenze) return;
  controllo('Dependency licenses', 'node', ['scripts/licenses/check.mjs']);
  if (report && c.reportLicenze) {
    if (!existsSync(join(RADICE, 'node_modules'))) {
      salta('license-report.json', 'node_modules missing: run npm ci');
      return;
    }
    controllo('license-report.json up to date', 'npm', ['run', 'license:report']);
    const diff = spawnSync('git', ['diff', '--quiet', '--', 'license-report.json'], {
      cwd: RADICE,
    });
    if (diff.status !== 0) {
      errore('license-report.json up to date', [
        'The report changed: review it and add license-report.json to the commit.',
      ]);
    }
  }
}

function controlloChart(c) {
  if (!c.chart) return;
  if (!disponibile('helm', ['version', '--short'])) {
    salta('Helm chart', 'helm not installed (CI validates the chart)');
    return;
  }
  controllo('Helm chart', 'bash', ['scripts/validate-chart.sh']);
}

function tipiServizi(c) {
  for (const dir of c.servizi) {
    if (!existsSync(join(RADICE, dir, 'node_modules'))) {
      salta(`Typecheck ${dir}`, `node_modules missing: run npm ci in ${dir}`);
      continue;
    }
    controllo(
      `Typecheck ${dir}`,
      'npx',
      ['tsc', '--noEmit', '-p', 'tsconfig.json'],
      join(RADICE, dir)
    );
  }
}

// ───────────────────────── pre-commit ─────────────────────────

/** I file in stage oltre il limite, con due sole chiamate a git. */
function fileGrandi(inStage) {
  const voluti = new Set(inStage);
  const oggetti = new Map();
  for (const voce of git(['ls-files', '--stage', '-z']).split('\0').filter(Boolean)) {
    const [meta, percorso] = voce.split('\t');
    if (voluti.has(percorso)) oggetti.set(meta.split(' ')[1], percorso);
  }
  if (oggetti.size === 0) return [];
  const dimensioni = git(['cat-file', '--batch-check=%(objectname) %(objectsize)'], {
    input: [...oggetti.keys()].join('\n') + '\n',
  });
  return dimensioni
    .split('\n')
    .map((r) => r.split(' '))
    .filter(
      ([oggetto, dimensione]) => oggetti.has(oggetto) && Number(dimensione) > LIMITE_FILE
    )
    .map(([oggetto]) => oggetti.get(oggetto));
}

function preCommit() {
  const inStage = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
    .split('\0')
    .filter(Boolean);
  if (inStage.length === 0) riepilogo('pre-commit');
  const nuovi = git(['diff', '--cached', '--name-only', '--diff-filter=A', '-z'])
    .split('\0')
    .filter(Boolean);

  // Contenuto: segreti, conflitti, dimensioni.
  const aggiunte = righeAggiunte(
    git(['diff', '--cached', '-U0', '--no-color', '--no-ext-diff', '--diff-filter=ACMR'])
  );
  const segreti = segretiAggiunti(aggiunte);
  if (segreti.length) {
    errore(
      'Secrets',
      segreti
        .map((s) => `${s.file}:${s.numero}: possible ${s.tipo}`)
        .concat(
          'Keep secrets out of the repository; for a known false positive add "secret-scan: allow" on that line.'
        )
    );
  }
  const conflitti = conflittiAggiunti(aggiunte);
  if (conflitti.length) {
    errore(
      'Merge conflict markers',
      conflitti.map((m) => `${m.file}:${m.numero}`)
    );
  }
  const grandi = fileGrandi(inStage);
  if (grandi.length) {
    errore(
      'Large files',
      grandi.map((f) => `${f} is larger than 5 MB: keep it out of Git`)
    );
  }

  // I controlli che seguono leggono la copia di lavoro: se un file in stage ha
  // anche modifiche non in stage, controllano piu' di quello che si committa.
  const nonInStage = new Set(
    git(['diff', '--name-only', '-z']).split('\0').filter(Boolean)
  );
  const parziali = inStage.filter((f) => nonInStage.has(f));
  if (parziali.length) {
    process.stdout.write(
      `\n! These staged files also have unstaged changes; the checks below read the working tree:\n` +
        parziali.map((f) => `  ${f}`).join('\n') +
        '\n'
    );
  }

  const c = controlliPerFile(inStage);

  if (c.appCodice.length) {
    controllo(
      'ESLint (staged files)',
      'npx',
      ['eslint', '--no-warn-ignored', ...relativo('app', c.appCodice)],
      join(RADICE, 'app')
    );
  }
  if (c.app) {
    controllo('TypeScript (app)', 'npx', [
      'tsc',
      '--noEmit',
      '--project',
      'app/tsconfig.json',
    ]);
  }
  if (c.appSorgenti.length) {
    controllo(
      'Related unit tests',
      'npx',
      [
        'vitest',
        'related',
        '--run',
        '--passWithNoTests',
        ...relativo('app', c.appSorgenti),
      ],
      join(RADICE, 'app')
    );
  }
  if (c.messaggi) {
    controllo(
      'Language parity (24 catalogs)',
      'npx',
      ['vitest', 'run', 'src/i18n/locale-parity.test.ts'],
      join(RADICE, 'app')
    );
  }
  if (c.schema && !c.migrazioni) {
    errore('Database migration', [
      'app/prisma/schema.prisma changed but no migration is staged.',
      'Run npm run db:migrate:dev --workspace=app and add the generated SQL.',
    ]);
  }
  if (c.lobby) controllo('TypeScript (lobby)', 'npm', ['run', 'lobby:typecheck']);
  tipiServizi(c);
  controlliLicenze(c, { report: true });
  controlloChart(c);

  const formattare = daFormattare(nuovi);
  if (formattare.length) {
    controllo('Prettier (new files only)', 'npx', ['prettier', '--check', ...formattare]);
  }
  riepilogo('pre-commit');
}

// ───────────────────────── commit-msg ─────────────────────────

function commitMsg(percorso) {
  let commento = '#';
  try {
    const valore = git(['config', '--get', 'core.commentChar']).trim();
    if (valore && valore !== 'auto') commento = valore;
  } catch {
    // core.commentChar non impostato: resta '#'.
  }
  const errori = erroriMessaggio(readFileSync(percorso, 'utf8'), commento);
  if (errori.length) {
    errore('Commit message', [
      ...errori,
      'Example: feat(live): sottotitoli dal vivo con il nome di chi parla',
      'See docs/development/methodology.md#commits.',
    ]);
  }
  riepilogo('commit-msg');
}

// ───────────────────────── pre-push ─────────────────────────

const ZERO = /^0+$/;

/** I file toccati dai commit che si stanno pubblicando. */
function fileDaPubblicare(righe) {
  const file = new Set();
  for (const riga of righe) {
    const [, locale, , remoto] = riga.trim().split(/\s+/);
    if (!locale || ZERO.test(locale)) continue;
    let base = remoto && !ZERO.test(remoto) ? remoto : null;
    if (base) {
      try {
        git(['cat-file', '-e', `${base}^{commit}`]);
      } catch {
        base = null;
      }
    }
    if (!base) {
      for (const ramo of ['origin/dev', 'origin/main']) {
        try {
          base = git(['merge-base', locale, ramo]).trim();
          break;
        } catch {
          // ramo remoto assente in questo clone: si prova il successivo.
        }
      }
    }
    const elenco = base
      ? git(['diff', '--name-only', '-z', `${base}..${locale}`])
      : git(['ls-tree', '-r', '--name-only', '-z', locale]);
    for (const f of elenco.split('\0').filter(Boolean)) file.add(f);
  }
  return [...file];
}

/** I commit da pubblicare, senza le cancellazioni di rami, senza doppioni. */
function commitPubblicati(righe) {
  const commit = new Set();
  for (const riga of righe) {
    const locale = riga.trim().split(/\s+/)[1];
    if (locale && !ZERO.test(locale)) commit.add(locale);
  }
  return [...commit];
}

function prePush() {
  const righe = readFileSync(0, 'utf8')
    .split('\n')
    .filter((r) => r.trim());
  const file = fileDaPubblicare(righe);
  if (file.length === 0) riepilogo('pre-push');
  const c = controlliPerFile(file);

  // I controlli leggono la copia di lavoro: dirlo se non e' cio' che si pubblica.
  const testa = git(['rev-parse', 'HEAD']).trim();
  const pubblicati = commitPubblicati(righe);
  const sporca = git(['status', '--porcelain']).trim() !== '';
  if (sporca || pubblicati.some((sha) => sha !== testa)) {
    process.stdout.write(
      '\n! The checks read the working tree (HEAD plus local changes), which differs from ' +
        'what you are pushing. Commit or stash your changes, or check out the pushed branch, ' +
        'for an exact result.\n'
    );
  }

  // Come da tabella di parita' con la CI: lint, tipi e test non si saltano mai.
  controllo('Lint & Typecheck: lint', 'npm', ['run', 'lint', '--workspace=app']);
  controllo('Lint & Typecheck: tsc', 'npx', [
    'tsc',
    '--noEmit',
    '--project',
    'app/tsconfig.json',
  ]);
  controllo('Lint & Typecheck: script tests', 'npm', ['run', 'test:scripts']);
  controllo('Unit Tests (coverage thresholds)', 'npm', [
    'run',
    'test:coverage',
    '--workspace=app',
  ]);
  for (const dir of c.servizi) {
    const cwd = join(RADICE, dir);
    if (!existsSync(join(cwd, 'node_modules')))
      controllo(`npm ci (${dir})`, 'npm', ['ci', '--no-audit', '--no-fund'], cwd);
    controllo(
      `Unit Tests (${dir}): tsc`,
      'npx',
      ['tsc', '--noEmit', '-p', 'tsconfig.json'],
      cwd
    );
    controllo(`Unit Tests (${dir})`, 'npm', ['test'], cwd);
  }
  if (c.lobby) controllo('Typecheck (lobby)', 'npm', ['run', 'lobby:typecheck']);
  controlloChart(c);
  if (c.worker) {
    const cwd = join(RADICE, 'infra/ai/worker');
    const python = ['python3', 'python'].find((p) =>
      disponibile(p, ['-c', 'import pytest'])
    );
    if (python) controllo('Unit Tests (worker AI)', python, ['-m', 'pytest', '-q'], cwd);
    else
      salta(
        'Unit Tests (worker AI)',
        'pytest not available: pip install -r infra/ai/worker/requirements-test.txt'
      );
  }
  controlliLicenze(c, { report: true });
  if (c.prisma) {
    const shadow = process.env.SHADOW_DATABASE_URL;
    if (shadow) {
      controllo('Migration Integrity', 'npx', [
        'prisma',
        'migrate',
        'diff',
        '--from-migrations',
        'app/prisma/migrations',
        '--to-schema-datamodel',
        'app/prisma/schema.prisma',
        '--shadow-database-url',
        shadow,
        '--exit-code',
      ]);
    } else {
      salta(
        'Migration Integrity',
        'set SHADOW_DATABASE_URL to a throwaway database to run it'
      );
    }
  }
  if (disponibile('trivy')) {
    // Come la CI: una copia pulita di ogni commit da pubblicare, senza i file
    // locali (node_modules, build, risultati dei test) che la CI non vede.
    for (const [k, commit] of pubblicati.entries()) {
      const copia = join(tmpdir(), `pa-webinar-scan-${process.pid}-${k}`);
      try {
        git(['worktree', 'add', '--detach', '--quiet', copia, commit]);
        controllo(
          `Security Scan (trivy fs, ${commit.slice(0, 8)})`,
          'trivy',
          [
            'fs',
            '--severity',
            'CRITICAL,HIGH',
            '--exit-code',
            '1',
            '--quiet',
            '--cache-dir',
            join(tmpdir(), 'pa-webinar-trivy-cache'),
            '.',
          ],
          copia
        );
      } finally {
        spawnSync('git', ['worktree', 'remove', '--force', copia], { stdio: 'ignore' });
      }
    }
  } else {
    salta('Security Scan', 'trivy not installed (CI runs it on every pull request)');
  }
  if (c.immagine)
    salta(
      'Docker Build & Scan',
      'not run by the hook: docker build -t pa-webinar:local . && trivy image ...'
    );
  if (c.salaLive)
    salta(
      'E2E Smoke Tests',
      'live-room flows changed: run the Playwright suite (methodology.md)'
    );
  riepilogo('pre-push');
}

// ───────────────────────── avvio ─────────────────────────

process.chdir(RADICE);
const [hook, argomento] = process.argv.slice(2);
if (hook === 'pre-commit') preCommit();
else if (hook === 'commit-msg') commitMsg(resolve(argomento));
else if (hook === 'pre-push') prePush();
else {
  console.error(`Unknown hook: ${hook}`);
  process.exit(2);
}
