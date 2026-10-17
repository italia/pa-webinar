// Regole dei git hook. Si esegue con `npm run test:scripts`.
// I segreti di prova sono costruiti a pezzi, perche' nessuno scanner li
// scambi per segreti veri nel repository.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  conflittiAggiunti,
  controlliPerFile,
  daFormattare,
  erroriMessaggio,
  MARCATORE_CONSENTITO,
  righeAggiunte,
  segretiAggiunti,
  soloCommentiSchema,
} from './rules.mjs';

describe('erroriMessaggio', () => {
  it('accetta Conventional Commits con o senza ambito, e i messaggi di git', () => {
    for (const m of [
      'feat(live): sottotitoli dal vivo',
      'fix(admin,events): conferma prima di archiviare',
      'docs: guida al riuso',
      'chore(release): v0.14.0',
      'feat(api)!: nuovo formato della risposta',
      'Merge branch dev into main',
      'Revert "feat(avatar): foto dei partecipanti"',
      'fixup! fix(live): timer',
    ]) {
      assert.deepEqual(erroriMessaggio(m), [], m);
    }
  });

  it('accetta un corpo dopo una riga vuota e ignora commenti e forbice', () => {
    const m = [
      'fix(live): timer',
      '',
      'Cosa cambia e perche.',
      '# Please enter the commit message',
      '# ------------------------ >8 ------------------------',
      'diff --git a/x b/x',
    ].join('\n');
    assert.deepEqual(erroriMessaggio(m), []);
  });

  it('rifiuta tipo sconosciuto, oggetto lungo, emoji, punto finale', () => {
    assert.equal(erroriMessaggio('update stuff').length, 1);
    assert.equal(erroriMessaggio('feature(live): x').length, 1);
    assert.match(erroriMessaggio(`fix(live): ${'a'.repeat(70)}`)[0], /characters long/);
    assert.match(erroriMessaggio('feat(live): sala nuova \u{1F680}')[0], /emoji/);
    assert.match(erroriMessaggio('fix(live): timer.')[0], /period/);
  });

  it('chiede la riga vuota prima del corpo e rifiuta i trailer di attribuzione', () => {
    assert.match(erroriMessaggio('fix(live): timer\ncorpo attaccato')[0], /blank line/);
    const conTrailer =
      'fix(live): timer\n\nCorpo.\n\nCo-authored-by: Nome <n@example.org>';
    assert.match(erroriMessaggio(conTrailer)[0], /Attribution/);
  });

  it('un messaggio vuoto non passa', () => {
    assert.match(erroriMessaggio('# solo commenti\n\n')[0], /empty/);
  });
});

describe('righe aggiunte, segreti e conflitti', () => {
  const chiave = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');
  const aws = 'AKIA' + 'Q'.repeat(16);
  const diff = [
    'diff --git a/conf.env b/conf.env',
    '--- a/conf.env',
    '+++ b/conf.env',
    '@@ -1,0 +1,3 @@',
    `+${chiave}`,
    `+ID=${aws}`,
    `+ID=${aws} # ${MARCATORE_CONSENTITO}`,
    'diff --git a/x.ts b/x.ts',
    '--- a/x.ts',
    '+++ b/x.ts',
    '@@ -10,0 +11,2 @@',
    '+<<<<<<< HEAD',
    '+=======',
  ].join('\n');

  it('legge file e numeri di riga dal diff', () => {
    const perFile = righeAggiunte(diff);
    assert.deepEqual([...perFile.keys()], ['conf.env', 'x.ts']);
    assert.deepEqual(
      perFile.get('x.ts').map((r) => r.numero),
      [11, 12]
    );
  });

  it('trova chiavi e token, salvo le righe marcate come consentite', () => {
    const trovati = segretiAggiunti(righeAggiunte(diff));
    assert.deepEqual(
      trovati.map((s) => `${s.file}:${s.numero}:${s.tipo}`),
      ['conf.env:1:private key', 'conf.env:2:AWS access key']
    );
  });

  it('trova i marcatori di conflitto nel codice', () => {
    assert.deepEqual(
      conflittiAggiunti(righeAggiunte(diff)).map((m) => `${m.file}:${m.numero}`),
      ['x.ts:11', 'x.ts:12']
    );
  });

  it('i segnaposto di sviluppo non sono segreti', () => {
    const perFile = new Map([
      [
        'docker-compose.yml',
        [{ numero: 1, testo: 'PII_ENCRYPTION_KEY: 0123456789abcdef' }],
      ],
    ]);
    assert.deepEqual(segretiAggiunti(perFile), []);
  });
});

describe('controlliPerFile', () => {
  it('solo documentazione: nessun controllo pesante', () => {
    const c = controlliPerFile(['docs/README.md', 'README.md']);
    assert.equal(c.app, false);
    assert.equal(c.licenze, false);
    assert.equal(c.immagine, false);
    assert.deepEqual(c.servizi, []);
  });

  it("riconosce le aree dell'app e chiede la migrazione con lo schema", () => {
    const c = controlliPerFile([
      'app/src/lib/x.ts',
      'app/src/i18n/messages/it.json',
      'app/prisma/schema.prisma',
      'app/public/sw.js',
    ]);
    assert.equal(c.app, true);
    assert.deepEqual(c.appCodice, ['app/src/lib/x.ts']);
    assert.deepEqual(c.appSorgenti, [
      'app/src/lib/x.ts',
      'app/src/i18n/messages/it.json',
    ]);
    assert.equal(c.messaggi, true);
    assert.equal(c.schema, true);
    assert.equal(c.migrazioni, false);
  });

  it('servizi, chart, worker, licenze e sala dal vivo', () => {
    const c = controlliPerFile([
      'infra/captions/gateway/src/a.ts',
      'infra/recorder-controller/package-lock.json',
      'infra/helm/pa-webinar/values.yaml',
      'infra/ai/worker/x.py',
      'app/src/components/live/room.tsx',
    ]);
    assert.deepEqual(c.servizi, ['infra/recorder-controller', 'infra/captions/gateway']);
    assert.equal(c.chart, true);
    assert.equal(c.worker, true);
    assert.equal(c.licenze, true);
    assert.equal(c.reportLicenze, false);
    assert.equal(c.salaLive, true);
  });

  it('il lockfile della radice tocca app, licenze, report e immagine', () => {
    const c = controlliPerFile(['package-lock.json']);
    assert.equal(c.app, true);
    assert.equal(c.reportLicenze, true);
    assert.equal(c.immagine, true);
  });
});

describe('daFormattare', () => {
  it('solo codice e stili nuovi, mai documenti o file pubblici', () => {
    assert.deepEqual(
      daFormattare(['a.ts', 'b.md', 'c.json', 'app/public/x.js', 'd.scss']),
      ['a.ts', 'd.scss']
    );
  });
});

describe('soloCommentiSchema', () => {
  const diff = (...righe) =>
    ['diff --git a/app/prisma/schema.prisma b/app/prisma/schema.prisma', '--- a/app/prisma/schema.prisma', '+++ b/app/prisma/schema.prisma', '@@ -10 +10 @@', ...righe].join('\n');

  it('commenti e righe vuote non chiedono una migrazione', () => {
    assert.equal(soloCommentiSchema(diff('-  // vecchio commento', '+  // commento nuovo', '+')), true);
  });

  it('un campo, un attributo o un modello la chiedono', () => {
    assert.equal(soloCommentiSchema(diff('+  nota String? @map("nota")')), false);
    assert.equal(soloCommentiSchema(diff('-  // commento', '+  aiConsent Boolean @ignore')), false);
    assert.equal(soloCommentiSchema(diff('+  campo Int // con commento in coda')), false);
  });

  it('un diff vuoto non è «solo commenti»', () => {
    assert.equal(soloCommentiSchema(''), false);
  });
});
