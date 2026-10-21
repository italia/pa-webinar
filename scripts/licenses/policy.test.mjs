// Politica delle licenze: valutazione delle espressioni SPDX e lettura dei
// lockfile. Si esegue con `npm run test:scripts`.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { pacchettiDiProduzione, violazioni } from './check.mjs';
import { analizza, famigliaVietata, valuta } from './policy.mjs';

describe('valuta', () => {
  it('ammette le licenze permissive e il copyleft debole', () => {
    for (const l of [
      'MIT',
      'Apache-2.0',
      'BSD-3-Clause',
      'ISC',
      'LGPL-3.0-or-later',
      'MPL-2.0',
      'EUPL-1.2',
    ]) {
      assert.equal(valuta(l).esito, 'ammessa', l);
    }
  });

  it('vieta GPL, AGPL e SSPL in ogni variante SPDX', () => {
    for (const l of [
      'GPL-2.0',
      'GPL-3.0-only',
      'GPL-3.0-or-later',
      'GPL-2.0+',
      'AGPL-3.0',
      'AGPL-3.0-or-later',
      'SSPL-1.0',
    ]) {
      assert.equal(valuta(l).esito, 'vietata', l);
    }
    assert.equal(famigliaVietata('LGPL-2.1-only'), null);
  });

  it('gli identificatori si confrontano senza maiuscole, e `+` vale `-or-later`', () => {
    assert.equal(valuta('apache-2.0').esito, 'ammessa');
    assert.equal(valuta('LGPL-2.1+').esito, 'ammessa');
  });

  it('con OR basta una licenza ammessa; con AND serve che lo siano tutte', () => {
    assert.equal(valuta('(MIT OR GPL-3.0)').esito, 'ammessa');
    assert.equal(valuta('MIT AND GPL-3.0-only').esito, 'vietata');
    assert.equal(valuta('Apache-2.0 AND LGPL-3.0-or-later AND MIT').esito, 'ammessa');
    assert.equal(valuta('(GPL-2.0 OR SSPL-1.0)').esito, 'vietata');
    assert.equal(valuta('mit or apache-2.0').esito, 'ammessa');
  });

  it("un'eccezione WITH non cambia la famiglia", () => {
    assert.equal(valuta('GPL-2.0-only WITH Classpath-exception-2.0').esito, 'vietata');
    assert.equal(valuta('Apache-2.0 WITH LLVM-exception').esito, 'ammessa');
  });

  it('licenza assente, proprietaria, non SPDX o illeggibile: da verificare a mano', () => {
    for (const l of [
      undefined,
      '',
      'UNLICENSED',
      'Proprietary',
      'Commercial',
      'None',
      'BSD',
      'LicenseRef-interna',
      'SEE LICENSE IN LICENSE.md',
      '(MIT',
      'MIT AND',
      'MIT AND Commercial',
    ]) {
      assert.equal(valuta(l).esito, 'sconosciuta', String(l));
    }
    assert.throws(() => analizza('MIT OR'));
  });
});

describe('pacchettiDiProduzione', () => {
  it('esclude la radice, i collegamenti ai workspace e le dipendenze di solo sviluppo', () => {
    const lock = {
      packages: {
        '': { name: 'radice' },
        app: { name: '@pa-webinar/app' },
        'node_modules/@pa-webinar/app': { link: true },
        'node_modules/a': { version: '1.0.0', license: 'MIT' },
        'node_modules/b': { version: '2.0.0', license: 'GPL-3.0', dev: true },
        'node_modules/c': { version: '3.0.0', license: 'ISC', devOptional: true },
        'node_modules/a/node_modules/@s/d': { version: '4.0.0', license: 'MIT' },
      },
    };
    assert.deepEqual(
      pacchettiDiProduzione(lock).map((p) => `${p.nome}@${p.versione}`),
      ['a@1.0.0', 'c@3.0.0', '@s/d@4.0.0']
    );
  });
});

describe('violazioni', () => {
  const pacchetti = [
    { nome: 'buono', versione: '1.0.0', licenza: 'MIT' },
    { nome: 'senza', versione: '1.0.0', licenza: undefined },
    { nome: 'copyleft', versione: '1.0.0', licenza: 'AGPL-3.0-only' },
  ];

  it('segnala le licenze vietate e quelle assenti', () => {
    assert.deepEqual(
      violazioni(pacchetti, {}).map((v) => v.chiave),
      ['senza@1.0.0', 'copyleft@1.0.0']
    );
  });

  it("un'eccezione vale solo per una licenza sconosciuta, mai per una vietata", () => {
    const usate = new Set();
    const trovate = violazioni(
      pacchetti,
      {
        'senza@1.0.0': { license: 'MIT' },
        'copyleft@1.0.0': { license: 'MIT' },
        'buono@1.0.0': { license: 'MIT' },
      },
      usate
    );
    assert.deepEqual(
      trovate.map((v) => v.chiave),
      ['copyleft@1.0.0']
    );
    // Le eccezioni per il pacchetto vietato e per quello gia' in regola non si usano.
    assert.deepEqual([...usate], ['senza@1.0.0']);
  });

  it("un'eccezione che dichiara a sua volta una licenza vietata non ammette nulla", () => {
    const trovate = violazioni([{ nome: 'senza', versione: '1.0.0' }], {
      'senza@1.0.0': { license: 'GPL-3.0-only' },
    });
    assert.match(trovate[0].motivo, /forbidden/);
  });

  it("un'eccezione vale solo per quella versione", () => {
    const trovate = violazioni([{ nome: 'senza', versione: '2.0.0' }], {
      'senza@1.0.0': { license: 'MIT' },
    });
    assert.equal(trovate.length, 1);
  });
});
