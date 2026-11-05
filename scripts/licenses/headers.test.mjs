// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// Intestazione SPDX dei file sorgente. Si esegue con `npm run test:scripts`.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  commentoDi,
  conIntestazione,
  haAltroAvviso,
  haIntestazione,
  intestazione,
  richiedeIntestazione,
  senzaIntestazione,
} from './headers.mjs';

const RADICE = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const ANNO = 2026;

const blocco = (apre, chiude = '') =>
  intestazione(ANNO)
    .map((r) => `${apre}${r}${chiude}`)
    .join('\n');

describe('richiedeIntestazione', () => {
  it('copre il codice e i file di installazione', () => {
    for (const f of [
      'app/src/lib/env.ts',
      'app/src/app/layout.tsx',
      'app/prisma/schema.prisma',
      'app/src/styles/globals.scss',
      'infra/ai/worker/main.py',
      'infra/jitsi/jibri-finalize.sh',
      'infra/jitsi/prosody-plugins/mod_pa_occupants.lua',
      'infra/helm/pa-webinar/values.yaml',
      'infra/helm/pa-webinar/templates/_helpers.tpl',
      'infra/tofu/aks/main.tf',
      'infra/ai/Dockerfile.worker',
      'Dockerfile',
      'docker-compose.yml',
      'lobby/index.html',
      'scripts/deploy.ps1',
      'app/src/a.mts',
      'app/src/a.jsx',
      'infra/init.sql',
      'infra/worker.Dockerfile',
    ]) {
      assert.equal(richiedeIntestazione(f), true, f);
    }
  });

  it('riconosce dallo shebang gli script senza estensione', () => {
    assert.equal(
      richiedeIntestazione('scripts/git-hooks/pre-commit', '#!/bin/sh\n'),
      true
    );
    assert.equal(richiedeIntestazione('scripts/tool', '#!/usr/bin/env node\n'), true);
    assert.equal(
      richiedeIntestazione('LICENSE', 'EUROPEAN UNION PUBLIC LICENCE\n'),
      false
    );
    assert.equal(richiedeIntestazione('.gitignore', 'node_modules\n'), false);
  });

  it('esclude cio che non si puo o non si deve toccare', () => {
    for (const f of [
      '.github/workflows/ci.yml',
      'publiccode.yml',
      'app/next-env.d.ts',
      'app/prisma/migrations/20260101000000_init/migration.sql',
      'app/prisma/migrations/migration_lock.toml',
      'app/public/models/selfie-segmentation/selfie_segmenter_landscape.tflite',
      'infra/tofu/aks/.terraform.lock.hcl',
      'app/src/i18n/messages/it.json',
      'package-lock.json',
      'README.md',
      'LICENSE',
    ]) {
      assert.equal(richiedeIntestazione(f), false, f);
    }
  });
});

describe('conIntestazione', () => {
  it('la mette in cima, con una riga vuota prima del codice', () => {
    assert.equal(
      conIntestazione('app/src/a.ts', "'use client';\n", ANNO),
      `${blocco('// ')}\n\n'use client';\n`
    );
  });

  it('lascia prima lo shebang', () => {
    assert.equal(
      conIntestazione('scripts/a.sh', '#!/bin/sh\nset -eu\n', ANNO),
      `#!/bin/sh\n${blocco('# ')}\n\nset -eu\n`
    );
  });

  it('lascia prima il doctype e le direttive di Docker', () => {
    assert.equal(
      conIntestazione('lobby/index.html', '<!doctype html>\n<html></html>\n', ANNO),
      `<!doctype html>\n${blocco('<!-- ', ' -->')}\n\n<html></html>\n`
    );
    assert.equal(
      conIntestazione('Dockerfile', '# syntax=docker/dockerfile:1\nFROM node\n', ANNO),
      `# syntax=docker/dockerfile:1\n${blocco('# ')}\n\nFROM node\n`
    );
  });

  it('lascia prima le altre righe che contano solo se sono le prime', () => {
    for (const riga of [
      '#syntax=docker/dockerfile:1',
      '# check=error=true',
      '#cloud-config',
      '# -*- coding: latin-1 -*-',
    ]) {
      const nuovo = conIntestazione('infra/a.yaml', `${riga}\nx: 1\n`, ANNO);
      assert.ok(nuovo.startsWith(`${riga}\n${blocco('# ')}`), riga);
    }
  });

  it('nel codice normale non scambia una lambda per un avviso', () => {
    assert.equal(haAltroAvviso('const f = (c) => c + 1;\n'), false);
  });

  it('nei template Helm usa commenti che non finiscono nei manifesti', () => {
    const percorso = 'infra/helm/pa-webinar/templates/service.yaml';
    assert.deepEqual(commentoDi(percorso), { apre: '{{- /* ', chiude: ' */ -}}' });
    assert.equal(
      conIntestazione(percorso, 'kind: Service\n', ANNO),
      `${blocco('{{- /* ', ' */ -}}')}\n\nkind: Service\n`
    );
  });

  it('non la duplica', () => {
    const una = conIntestazione('app/src/a.ts', 'export {};\n', ANNO);
    assert.equal(conIntestazione('app/src/a.ts', una, ANNO), una);
  });

  it('non copre mai l avviso di licenza di un file di terzi', () => {
    for (const testo of [
      '// SPDX-License-Identifier: MIT\nexport {};\n',
      '-- Copyright (c) 2024 Someone Else\nlocal x = 1\n',
      '# Licensed under the Apache License, Version 2.0\nx = 1\n',
      '/*! lib v1 | (c) Acme | MIT License */\n',
      '// © 2021 Acme Inc.\n',
      '/** @license Acme */\n',
      '// SPDX-FileCopyrightText: 2024 Someone Else\n',
    ]) {
      assert.equal(haAltroAvviso(testo), true, testo);
      assert.equal(conIntestazione('infra/jitsi/mod_terzi.js', testo, ANNO), testo);
    }
  });

  it('scrive l anno corrente, se non ne riceve uno', () => {
    const anno = new Date().getFullYear();
    const testo = conIntestazione('app/src/a.ts', 'export {};\n');
    assert.ok(testo.includes(`SPDX-FileCopyrightText: ${anno} `));
  });

  it('non tocca un file che non la richiede', () => {
    assert.equal(conIntestazione('README.md', '# Title\n', ANNO), '# Title\n');
  });

  it('funziona su un file vuoto', () => {
    assert.equal(haIntestazione(conIntestazione('app/src/a.ts', '', ANNO)), true);
  });
});

describe('haIntestazione', () => {
  const [licenza, titolare] = intestazione(ANNO);

  it('vuole licenza e titolare, in cima al file', () => {
    assert.equal(haIntestazione(`// ${licenza}\n// ${titolare}\n`), true);
    assert.equal(haIntestazione(`// ${licenza}\n`), false);
    assert.equal(haIntestazione(`// ${titolare}\n`), false);
    assert.equal(
      haIntestazione(`${'\n'.repeat(20)}// ${licenza}\n// ${titolare}\n`),
      false
    );
  });

  it('accetta la licenza e il titolare di un file di terzi', () => {
    const testo =
      '// SPDX-License-Identifier: Apache-2.0\n// SPDX-FileCopyrightText: 2024 Someone Else\n';
    assert.equal(haIntestazione(testo), true);
  });
});

describe('repository', () => {
  it('ogni file sorgente tracciato ha l intestazione', () => {
    assert.deepEqual(senzaIntestazione(RADICE), []);
  });
});
