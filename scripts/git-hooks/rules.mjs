/**
 * Regole dei git hook, come funzioni pure (testate in rules.test.mjs):
 * formato del messaggio di commit, controlli sulle righe aggiunte (segreti,
 * marcatori di conflitto) e scelta dei controlli in base ai file toccati.
 * L'esecuzione dei comandi sta in hooks.mjs.
 */

export const TIPI = [
  'feat',
  'fix',
  'docs',
  'chore',
  'refactor',
  'perf',
  'test',
  'ci',
  'build',
  'security',
  'i18n',
  'style',
  'revert',
];

const AMBITO = '[a-z0-9._/-]+(?:,\\s?[a-z0-9._/-]+)*';
const OGGETTO = new RegExp(`^(${TIPI.join('|')})(\\(${AMBITO}\\))?!?: \\S`);
const SENZA_FORMATO = /^(Merge |Revert "|fixup! |squash! |amend! )/;
const EMOJI = /\p{Extended_Pictographic}/u;
export const LUNGHEZZA_OGGETTO = 72;

/** Toglie i commenti e la parte sotto la forbice, come fa git. */
export function pulisciMessaggio(testo, commento = '#') {
  const righe = [];
  for (const riga of testo.replace(/\r\n/g, '\n').split('\n')) {
    if (riga.startsWith(`${commento} ------------------------ >8`)) break;
    if (riga.startsWith(commento)) continue;
    righe.push(riga);
  }
  while (righe.length && !righe[righe.length - 1].trim()) righe.pop();
  while (righe.length && !righe[0].trim()) righe.shift();
  return righe;
}

/**
 * Gli errori di un messaggio di commit (vuoto se e' valido): Conventional
 * Commits con ambito facoltativo, oggetto entro 72 caratteri senza emoji ne'
 * punto finale, riga vuota prima del corpo, nessun trailer di attribuzione.
 */
export function erroriMessaggio(testo, commento = '#') {
  const righe = pulisciMessaggio(testo, commento);
  if (righe.length === 0) return ['The commit message is empty.'];
  const [oggetto] = righe;
  if (SENZA_FORMATO.test(oggetto)) return [];
  const errori = [];
  if (!OGGETTO.test(oggetto)) {
    errori.push(
      `The subject must read "type(scope): subject" with type one of ${TIPI.join(', ')} ` +
        '(the scope is optional).'
    );
  }
  const lunghezza = [...oggetto].length;
  if (lunghezza > LUNGHEZZA_OGGETTO) {
    errori.push(
      `The subject is ${lunghezza} characters long; the limit is ${LUNGHEZZA_OGGETTO}.`
    );
  }
  if (EMOJI.test(oggetto)) errori.push('The subject contains an emoji.');
  if (/\.$/.test(oggetto.trim())) errori.push('The subject ends with a period.');
  if (righe.length > 1 && righe[1].trim()) {
    errori.push('Leave a blank line between the subject and the body.');
  }
  if (righe.some((r) => /^co-authored-by:/i.test(r.trim()))) {
    errori.push(
      'Attribution trailers (Co-authored-by) are not used: Git already records authorship.'
    );
  }
  return errori;
}

/**
 * Le righe aggiunte di un diff unificato (`git diff -U0`), per file:
 * Map<file, Array<{ numero, testo }>>.
 */
export function righeAggiunte(diff) {
  const perFile = new Map();
  let file = null;
  let numero = 0;
  for (const riga of diff.split('\n')) {
    if (riga.startsWith('+++ ')) {
      file = riga === '+++ /dev/null' ? null : riga.slice(4).replace(/^b\//, '');
      if (file && !perFile.has(file)) perFile.set(file, []);
      continue;
    }
    const blocco = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(riga);
    if (blocco) {
      numero = Number(blocco[1]);
      continue;
    }
    if (file && riga.startsWith('+')) {
      perFile.get(file).push({ numero, testo: riga.slice(1) });
      numero += 1;
    }
  }
  return perFile;
}

/** Una riga che contiene questo marcatore e' esclusa dalla ricerca dei segreti. */
export const MARCATORE_CONSENTITO = 'secret-scan: allow';

const SEGRETI = [
  {
    tipo: 'private key',
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----/,
  },
  { tipo: 'AWS access key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  {
    tipo: 'GitHub token',
    re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})/,
  },
  { tipo: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { tipo: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { tipo: 'Hugging Face token', re: /\bhf_[A-Za-z0-9]{34,}\b/ },
  { tipo: 'Stripe live key', re: /\b[rs]k_live_[0-9A-Za-z]{24,}/ },
  { tipo: 'Azure storage account key', re: /AccountKey=[A-Za-z0-9+/]{80,}={0,2}/ },
];

/** I possibili segreti tra le righe aggiunte: [{ file, numero, tipo }]. */
export function segretiAggiunti(perFile) {
  const trovati = [];
  for (const [file, righe] of perFile) {
    for (const { numero, testo } of righe) {
      if (testo.includes(MARCATORE_CONSENTITO)) continue;
      for (const { tipo, re } of SEGRETI) {
        if (re.test(testo)) trovati.push({ file, numero, tipo });
      }
    }
  }
  return trovati;
}

/** Marcatori di conflitto lasciati da un merge: [{ file, numero }]. */
export function conflittiAggiunti(perFile) {
  const trovati = [];
  for (const [file, righe] of perFile) {
    if (/\.(md|markdown|txt)$/i.test(file)) continue;
    for (const { numero, testo } of righe) {
      if (/^(<{7}|>{7})( |$)/.test(testo) || /^={7}$/.test(testo))
        trovati.push({ file, numero });
    }
  }
  return trovati;
}

export const SERVIZI_NODE = [
  'infra/recorder',
  'infra/recorder-controller',
  'infra/captions/gateway',
];

const CODICE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

/**
 * Cosa controllare, dato l'elenco dei file toccati. Ogni chiave e' un
 * controllo; i valori dicono su quali file (o se) va eseguito.
 */
export function controlliPerFile(file) {
  const sotto = (dir) => file.filter((f) => f.startsWith(`${dir}/`));
  const app = sotto('app');
  const radiceNpm = file.some((f) => ['package.json', 'package-lock.json'].includes(f));
  const lockfile = file.filter((f) => /(^|\/)package(-lock)?\.json$/.test(f));
  return {
    app: app.length > 0 || radiceNpm,
    appCodice: app.filter((f) => CODICE.test(f) && !f.startsWith('app/public/')),
    appSorgenti: app.filter(
      (f) => f.startsWith('app/src/') && /\.(ts|tsx|json)$/.test(f)
    ),
    messaggi: app.some((f) => f.startsWith('app/src/i18n/messages/')),
    schema: file.includes('app/prisma/schema.prisma'),
    migrazioni: app.some((f) => f.startsWith('app/prisma/migrations/')),
    prisma: app.some((f) => f.startsWith('app/prisma/')),
    lobby: sotto('lobby').length > 0,
    servizi: SERVIZI_NODE.filter((dir) => sotto(dir).length > 0),
    chart: sotto('infra/helm').length > 0,
    worker: sotto('infra/ai/worker').length > 0,
    licenze: lockfile.length > 0,
    reportLicenze: file.includes('package-lock.json'),
    immagine:
      radiceNpm ||
      file.some((f) => /^Dockerfile/.test(f)) ||
      app.some((f) => !f.startsWith('app/e2e/')),
    salaLive: app.some((f) =>
      /^app\/(src\/components\/live\/|src\/lib\/jitsi\/|src\/hooks\/use-recording|e2e\/)/.test(
        f
      )
    ),
  };
}

/** I file nuovi su cui controllare la formattazione (mai quelli esistenti). */
export function daFormattare(nuovi) {
  return nuovi.filter(
    (f) => /\.(ts|tsx|js|jsx|mjs|cjs|scss|css)$/.test(f) && !f.startsWith('app/public/')
  );
}

/**
 * La modifica allo schema tocca solo commenti o righe vuote: il modello del
 * database non cambia, e non serve una migrazione. `diff` è l'output di
 * `git diff --cached -U0` sul file dello schema.
 */
export function soloCommentiSchema(diff) {
  const righe = diff
    .split('\n')
    .filter((r) => (r.startsWith('+') || r.startsWith('-')) && !r.startsWith('+++') && !r.startsWith('---'))
    .map((r) => r.slice(1).trim());
  return righe.length > 0 && righe.every((r) => r === '' || r.startsWith('//'));
}
