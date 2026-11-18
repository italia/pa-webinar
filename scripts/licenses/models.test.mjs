// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// Registro dei pesi dei modelli: regole sulle voci, modelli fuori dal
// registro e il registro reale del repository. Si esegue con
// `npm run test:scripts`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ambienteDelRepository,
  controllaRegistro,
  daScansionare,
  ESTENSIONI_PESI,
  modelliNonRegistrati,
  problemiDellaVoce,
  revisioneHf,
  sha256,
} from './models.mjs';

const REV = 'a'.repeat(40);
const SHA = 'b'.repeat(64);
const URL_FISSO = `https://huggingface.co/org/modello/resolve/${REV}/modello.gguf`;

/** Un ambiente in memoria: file di testo, impronte, documento. */
function ambiente(file = {}, documento = '') {
  return {
    leggi: (f) => (f in file ? file[f] : null),
    impronta: (f) => (f in file ? sha256(file[f]) : null),
    documento,
    tracciati: Object.keys(file),
  };
}

function scaricato(extra = {}) {
  return {
    name: 'org/modello',
    file: 'modello.gguf',
    use: 'prova',
    delivery: 'download',
    url: URL_FISSO,
    sha256: SHA,
    usedIn: ['values.yaml'],
    license: 'Apache-2.0',
    format: 'gguf',
    ...extra,
  };
}

const AMBIENTE_BASE = ambiente(
  { 'values.yaml': `url: "${URL_FISSO}"\nsha256: "${SHA}"` },
  'org/modello'
);
const problemi = (voce, amb = AMBIENTE_BASE) => problemiDellaVoce(voce, amb);
const contiene = (lista, testo) => lista.some((m) => m.includes(testo));

describe('problemiDellaVoce: voce corretta', () => {
  it('un modello scaricato, fissato, con licenza ammessa passa', () => {
    assert.deepEqual(problemi(scaricato()), []);
  });

  it('un campo sconosciuto e un campo mancante si segnalano', () => {
    const p = problemi(scaricato({ licence: 'MIT', use: '' }));
    assert.ok(contiene(p, 'unknown field "licence"'));
    assert.ok(contiene(p, '"use" is missing'));
  });

  it('una voce non descritta in THIRD-PARTY-LICENSES.md si segnala', () => {
    const p = problemi(scaricato(), ambiente({ 'values.yaml': SHA }, 'altro'));
    assert.ok(contiene(p, 'not described in THIRD-PARTY-LICENSES.md'));
  });
});

describe('problemiDellaVoce: licenza', () => {
  it('una licenza ammessa non vuole una valutazione a mano', () => {
    assert.ok(
      contiene(problemi(scaricato({ licenseReview: 'letta' })), 'only for a license')
    );
  });

  it('una licenza sconosciuta passa con la valutazione o con una lacuna, non senza', () => {
    const ignota = 'LicenseRef-Prova';
    assert.ok(
      contiene(problemi(scaricato({ license: ignota })), 'not on the allowed list')
    );
    assert.deepEqual(
      problemi(scaricato({ license: ignota, licenseReview: 'termini letti' })),
      []
    );
    assert.deepEqual(
      problemi(
        scaricato({
          license: 'NOASSERTION',
          gaps: [{ kind: 'license', note: 'da verificare' }],
        })
      ),
      []
    );
    assert.ok(
      contiene(
        problemi(
          scaricato({
            license: ignota,
            licenseReview: 'letta',
            gaps: [{ kind: 'license', note: 'aperta' }],
          })
        ),
        'both "licenseReview" and a "license" gap'
      )
    );
  });

  it('una licenza vietata passa solo come lacuna, mai con una valutazione', () => {
    const nc = 'CC-BY-NC-4.0';
    assert.ok(contiene(problemi(scaricato({ license: nc })), 'forbidden family'));
    assert.ok(
      contiene(
        problemi(scaricato({ license: nc, licenseReview: 'ok' })),
        'a review cannot clear it'
      )
    );
    assert.deepEqual(
      problemi(
        scaricato({ license: nc, gaps: [{ kind: 'license', note: 'punto aperto' }] })
      ),
      []
    );
    assert.ok(
      contiene(problemi(scaricato({ license: 'AGPL-3.0-only' })), 'forbidden family')
    );
  });

  it("un'espressione illeggibile si segnala", () => {
    assert.ok(
      contiene(
        problemi(scaricato({ license: 'MIT AND' })),
        'not a readable SPDX expression'
      )
    );
  });

  it('una lacuna senza nota o ripetuta si segnala', () => {
    assert.ok(
      contiene(
        problemi(scaricato({ gaps: [{ kind: 'license', note: ' ' }] })),
        'has no note'
      )
    );
    assert.ok(
      contiene(
        problemi(
          scaricato({
            gaps: [
              { kind: 'license', note: 'a' },
              { kind: 'license', note: 'b' },
            ],
          })
        ),
        'declared twice'
      )
    );
    assert.ok(
      contiene(problemi(scaricato({ gaps: [{ kind: 'altro', note: 'x' }] })), 'gap kind')
    );
  });
});

describe('problemiDellaVoce: formato', () => {
  it('un pickle di PyTorch passa solo come lacuna', () => {
    assert.ok(
      contiene(problemi(scaricato({ format: 'pytorch-pickle' })), 'runs code when loaded')
    );
    assert.deepEqual(
      problemi(
        scaricato({
          format: 'pytorch-pickle',
          gaps: [{ kind: 'format', note: 'solo pickle' }],
        })
      ),
      []
    );
  });

  it('una lacuna di formato su un formato sicuro va tolta', () => {
    assert.ok(
      contiene(
        problemi(scaricato({ gaps: [{ kind: 'format', note: 'x' }] })),
        'needs no "format" gap'
      )
    );
  });

  it('un formato fuori elenco si segnala', () => {
    assert.ok(
      contiene(problemi(scaricato({ format: 'pickle' })), '"format" must be one of')
    );
  });
});

describe('problemiDellaVoce: fissaggio', () => {
  it("un indirizzo su un ramo, o senza impronta, non e' fissato", () => {
    const ramo = 'https://huggingface.co/org/modello/resolve/main/modello.gguf';
    assert.ok(contiene(problemi(scaricato({ url: ramo })), 'not pinned'));
    const { sha256: _tolto, ...senza } = scaricato();
    assert.ok(
      contiene(
        problemi(senza, ambiente({ 'values.yaml': 'modello' }, 'org/modello')),
        'not pinned'
      )
    );
  });

  it('una lacuna di fissaggio copre un modello non fissato e va tolta quando lo diventa', () => {
    const lacuna = { gaps: [{ kind: 'pinning', note: 'ramo main' }] };
    const ramo = 'https://huggingface.co/org/modello/resolve/main/modello.gguf';
    const suRamo = ambiente(
      { 'values.yaml': `url: "${ramo}"\nsha256: "${SHA}"` },
      'org/modello'
    );
    assert.deepEqual(problemi(scaricato({ url: ramo, ...lacuna }), suRamo), []);
    assert.ok(contiene(problemi(scaricato(lacuna)), 'remove the "pinning" gap'));
  });

  it("un indirizzo fuori da Hugging Face con l'impronta e' fissato", () => {
    assert.deepEqual(
      problemi(scaricato({ url: 'https://mirror.example.org/modello.gguf' })),
      []
    );
  });

  it("i file in usedIn devono esistere e contenere l'impronta", () => {
    assert.ok(
      contiene(problemi(scaricato({ usedIn: ['manca.yaml'] })), 'does not exist')
    );
    const diverso = ambiente({ 'values.yaml': 'altra impronta' }, 'org/modello');
    assert.ok(contiene(problemi(scaricato(), diverso), 'does not contain its sha256'));
    assert.ok(contiene(problemi(scaricato({ usedIn: [] })), '"usedIn" must list'));
  });

  it('i file in usedIn devono scaricare la revisione del registro', () => {
    const altraRevisione = ambiente(
      {
        'values.yaml': `url: "https://huggingface.co/org/modello/resolve/${'c'.repeat(40)}/modello.gguf"\nsha256: "${SHA}"`,
      },
      'org/modello'
    );
    assert.ok(contiene(problemi(scaricato(), altraRevisione), `revision ${REV}`));
    // Un file che compone l'indirizzo da una costante con il commit passa.
    const costante = ambiente(
      { 'values.yaml': `REVISION = "${REV}"\nSHA = "${SHA}"` },
      'org/modello'
    );
    assert.deepEqual(problemi(scaricato(), costante), []);
    assert.equal(revisioneHf(URL_FISSO), REV);
    assert.equal(revisioneHf('https://mirror.example.org/x.gguf'), null);
  });

  it('una voce che passa da un ramo a un commit lascia il registro indietro', () => {
    const voce = scaricato({
      delivery: 'image',
      url: 'https://huggingface.co/org/voci/resolve/main/it/voce.onnx',
      file: 'voce.onnx',
      format: 'onnx',
      usedIn: ['Dockerfile'],
      gaps: [{ kind: 'pinning', note: 'ramo main' }],
    });
    delete voce.sha256;
    const fissato = ambiente(
      {
        Dockerfile: `base="https://huggingface.co/org/voci/resolve/${REV}"\n"it/it_IT/x/medium/voce:it"`,
      },
      'org/modello'
    );
    assert.ok(contiene(problemi(voce, fissato), 'does not download revision main'));
  });

  it('un indirizzo hf.co a revisione fissa vale come huggingface.co', () => {
    const url = `https://hf.co/org/modello/resolve/${REV}/modello.gguf`;
    assert.deepEqual(problemi(scaricato({ url })), []);
    assert.ok(
      contiene(
        problemi(scaricato({ url: 'https://hf.co/org/modello/resolve/main/m.gguf' })),
        'not pinned'
      )
    );
  });

  it('senza impronta, i file in usedIn devono nominare il file senza estensione', () => {
    const voce = scaricato({
      delivery: 'image',
      url: 'https://huggingface.co/org/voci/resolve/main/it/voce.onnx',
      file: 'voce.onnx',
      format: 'onnx',
      usedIn: ['Dockerfile'],
      gaps: [{ kind: 'pinning', note: 'ramo main' }],
    });
    delete voce.sha256;
    assert.deepEqual(
      problemi(
        voce,
        ambiente(
          {
            Dockerfile:
              'base="https://huggingface.co/org/voci/resolve/main"\n"it/it_IT/x/medium/voce:it"',
          },
          'org/modello'
        )
      ),
      []
    );
    assert.ok(
      contiene(
        problemi(voce, ambiente({ Dockerfile: 'nulla' }, 'org/modello')),
        'does not contain voce'
      )
    );
  });

  it("un file nel repository deve avere l'impronta registrata", () => {
    const voce = {
      name: 'org/modello',
      use: 'prova',
      delivery: 'repository',
      path: 'public/m.tflite',
      sha256: sha256('pesi'),
      license: 'Apache-2.0',
      format: 'tflite',
    };
    assert.deepEqual(
      problemi(voce, ambiente({ 'public/m.tflite': 'pesi' }, 'org/modello')),
      []
    );
    assert.ok(
      contiene(
        problemi(voce, ambiente({ 'public/m.tflite': 'altri pesi' }, 'org/modello')),
        'does not match'
      )
    );
    assert.ok(contiene(problemi(voce, ambiente({}, 'org/modello')), 'does not exist'));
  });

  it("un modello dell'operatore non ha indirizzo ne' impronta", () => {
    const voce = {
      name: 'org/modello',
      use: 'prova',
      delivery: 'operator',
      license: 'MIT',
      format: 'safetensors',
    };
    assert.deepEqual(problemi(voce), []);
    assert.ok(
      contiene(problemi({ ...voce, url: URL_FISSO }), 'not for delivery "operator"')
    );
  });
});

describe('modelliNonRegistrati', () => {
  const voci = [scaricato()];
  const cerca = (file) =>
    modelliNonRegistrati(voci, Object.keys(file), (f) => file[f] ?? null);

  it('un indirizzo Hugging Face completo fuori dal registro si segnala', () => {
    const altro = `https://huggingface.co/org/altro/resolve/${REV}/altro.gguf`;
    assert.deepEqual(cerca({ 'values.yaml': `url: "${URL_FISSO}"` }), []);
    assert.ok(
      contiene(cerca({ 'values.yaml': `url: "${altro}"` }), 'is not in the registry')
    );
  });

  it('non contano un prefisso, un indirizzo composto, un dataset, la documentazione e i test', () => {
    assert.deepEqual(
      cerca({
        Dockerfile: 'base="https://huggingface.co/org/voci/resolve/main"',
        'run.sh': 'curl "https://huggingface.co/org/voci/resolve/main/${voce}.onnx"',
        'common.py': `"https://huggingface.co/datasets/org/dati/resolve/${REV}/test.tsv"`,
        'README.md': `https://huggingface.co/org/altro/resolve/${REV}/altro.gguf`,
        'x.test.ts': `https://huggingface.co/org/altro/resolve/${REV}/altro.gguf`,
      }),
      []
    );
  });

  it('un modello caricato per nome fuori dal registro si segnala', () => {
    assert.ok(
      contiene(
        cerca({ 'w/a.py': 'hf_hub_download(repo_id="org/nuovo", filename="m.bin")' }),
        'loads model org/nuovo'
      )
    );
    assert.ok(
      contiene(cerca({ 'w/b.py': "AutoModel.from_pretrained('org/nuovo')" }), 'org/nuovo')
    );
    assert.ok(
      contiene(cerca({ 'w/c.py': 'torch.hub.load("org/repo", "m")' }), 'org/repo')
    );
    // Un nome registrato, o un id di una voce, passa; un nome in una variabile non si vede.
    assert.deepEqual(
      modelliNonRegistrati(
        [{ ...scaricato(), ids: ['corto'] }],
        ['w/d.py'],
        () =>
          'from_pretrained("org/modello")\nload_generator("corto")\nfrom_pretrained(NOME)'
      ),
      []
    );
  });

  it('un indirizzo scritto come ripiego di una variabile si controlla', () => {
    const ramo = 'https://huggingface.co/org/altro/resolve/main/altro.gguf';
    for (const [f, testo] of [
      ['docker-compose.yml', `      - MODEL_URL=\${MODEL_URL:-${ramo}}`],
      ['Dockerfile', `RUN curl -fsSL "\${MODEL_URL:-${ramo}}" -o /m.gguf`],
      ['run.sh', `url=\${URL:=${ramo}}`],
      ['values.yaml', `model: {url: ${ramo}}`],
    ]) {
      assert.deepEqual(
        cerca({ [f]: testo }),
        [`${f}: ${ramo} is not in the registry`],
        f
      );
    }
    // L'indirizzo del registro come ripiego passa; un segnaposto lo rende composto.
    assert.deepEqual(
      cerca({
        'docker-compose.yml': `- MODEL_URL=\${MODEL_URL:-${URL_FISSO}}`,
        'run.sh':
          'curl "${BASE:-https://huggingface.co/org/voci/resolve/main/${voce}.onnx}"',
        'common.py': 'f"https://huggingface.co/org/m/resolve/{REV}/{FILE}"',
        'b.py': 'f"https://huggingface.co/org/m/resolve/main/{FILE}"',
      }),
      []
    );
  });

  it("la punteggiatura che segue l'indirizzo, una query o un frammento non lo cambiano", () => {
    assert.deepEqual(
      cerca({
        'values.yaml': `# pesi da ${URL_FISSO}.\nurl: "${URL_FISSO}?download=true"`,
        'run.sh': `# ${URL_FISSO}, ${URL_FISSO}; ${URL_FISSO}:\ncurl -L ${URL_FISSO}#sha`,
        'common.py': '"https://huggingface.co/org/m/resolve/main/?x=1"',
      }),
      []
    );
    const altro = `https://huggingface.co/org/altro/resolve/${REV}/altro.gguf`;
    assert.deepEqual(cerca({ 'run.sh': `# vedi ${altro}.` }), [
      `run.sh: ${altro} is not in the registry`,
    ]);
    assert.deepEqual(cerca({ 'run.sh': `curl "${altro}?download=true"` }), [
      `run.sh: ${altro} is not in the registry`,
    ]);
  });

  it('un indirizzo hf.co fuori dal registro si segnala', () => {
    assert.ok(
      contiene(
        cerca({ 'run.sh': `curl https://hf.co/org/altro/resolve/${REV}/a.gguf` }),
        'is not in the registry'
      )
    );
  });

  it('i pickle e i checkpoint .bin tracciati si segnalano', () => {
    for (const f of ['m/pytorch_model.bin', 'm/x.pickle', 'm/x.joblib', 'm/x.npy']) {
      assert.ok(ESTENSIONI_PESI.test(f), f);
      assert.ok(contiene(cerca({ [f]: 'x' }), 'without a "repository" entry'), f);
    }
  });

  it('un file di pesi tracciato fuori dal registro si segnala', () => {
    assert.ok(
      contiene(cerca({ 'public/nuovo.onnx': 'x' }), 'without a "repository" entry')
    );
  });

  it('una voce Piper scaricata da un Dockerfile deve essere nel registro', () => {
    const dockerfile = '"it/it_IT/paola/medium/it_IT-paola-medium:it"';
    assert.ok(
      contiene(
        cerca({ 'infra/Dockerfile.worker': dockerfile }),
        'voice it_IT-paola-medium'
      )
    );
    const conVoce = [
      ...voci,
      { ...scaricato(), delivery: 'image', file: 'it_IT-paola-medium.onnx' },
    ];
    assert.deepEqual(
      modelliNonRegistrati(conVoce, ['infra/Dockerfile.worker'], () => dockerfile),
      []
    );
  });

  it('daScansionare esclude documentazione, test, dati di prova, lockfile e il registro', () => {
    for (const f of [
      'README.md',
      'a/b.test.mjs',
      'w/test_x.py',
      'package-lock.json',
      'scripts/licenses/models.json',
      'app/e2e/sala.spec.ts',
      'infra/ai/worker/conftest.py',
      'app/src/__tests__/a.ts',
      'x/fixtures/b.json',
    ]) {
      assert.equal(daScansionare(f), false, f);
    }
    assert.equal(daScansionare('infra/helm/pa-webinar/values.yaml'), true);
  });
});

describe('controllaRegistro', () => {
  it('segnala voci e id ripetuti', () => {
    const { problemi: p } = controllaRegistro(
      { models: [scaricato({ ids: ['x'] }), scaricato({ ids: ['x'] })] },
      AMBIENTE_BASE
    );
    assert.ok(p.some((x) => x.motivo === 'registered twice'));
    assert.ok(p.some((x) => x.motivo.includes('id x is also on')));
  });

  it('un registro senza elenco si segnala', () => {
    assert.equal(controllaRegistro({}, AMBIENTE_BASE).problemi.length, 1);
  });

  it('il registro del repository passa', () => {
    const radice = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const registro = JSON.parse(
      readFileSync(resolve(radice, 'scripts/licenses/models.json'), 'utf8')
    );
    const { problemi: p } = controllaRegistro(registro, ambienteDelRepository(radice));
    assert.deepEqual(p, []);
  });
});
