// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * Registro dei pesi dei modelli (models.json): ogni modello che il progetto
 * scarica, mette in un'immagine, tiene nel repository o nomina come default.
 *
 * Per ogni voce controlla:
 *   - la licenza, con la stessa politica delle dipendenze (policy.mjs): una
 *     licenza ammessa passa; una sconosciuta passa con una valutazione a mano
 *     (`licenseReview`) o con una lacuna dichiarata; una vietata solo con una
 *     lacuna dichiarata, che e' un punto aperto;
 *   - il formato: solo formati che non eseguono codice quando si caricano;
 *     un pickle di PyTorch solo con una lacuna dichiarata;
 *   - il fissaggio: cio' che si scarica ha una revisione fissa e un'impronta
 *     SHA-256, e l'impronta compare nei file che lo scaricano; un file nel
 *     repository ha l'impronta registrata.
 *
 * Una lacuna di formato o di fissaggio che non serve piu' e' un errore: va
 * tolta, come un'eccezione superata. Le lacune di licenza invece non si
 * possono decidere da qui (una licenza ammessa puo' avere dati di
 * addestramento da verificare) e restano finche' qualcuno non le chiude.
 *
 * Al contrario, controlla che nel repository non compaia un modello fuori dal
 * registro: un indirizzo Hugging Face completo in un file tracciato, un file
 * di pesi tracciato, una voce Piper scaricata da un Dockerfile, una chiamata
 * che carica un modello per nome con il nome scritto per esteso. Un modello
 * caricato con un nome composto a run time non si vede da qui: i default del
 * codice li controllano i test di providers.ts e del worker.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { analizza, valuta } from './policy.mjs';

export const FORMATI_SICURI = [
  'gguf',
  'ctranslate2',
  'safetensors',
  'onnx',
  'tflite',
  'numpy',
];
export const FORMATI_PICKLE = ['pytorch-pickle'];
export const CONSEGNE = ['download', 'image', 'repository', 'operator'];
export const TIPI_LACUNA = ['license', 'format', 'pinning'];

const CAMPI = new Set([
  'name',
  'file',
  'use',
  'delivery',
  'url',
  'sha256',
  'usedIn',
  'path',
  'ids',
  'license',
  'licenseReview',
  'format',
  'gaps',
]);

const SHA256 = /^[0-9a-f]{64}$/;
const REVISIONE_HF =
  /^https:\/\/(?:huggingface\.co|hf\.co)\/[^/]+\/[^/]+\/resolve\/[0-9a-f]{40}\//;
const SU_HF = /^https:\/\/(?:huggingface\.co|hf\.co)\//;

/**
 * Indirizzi completi di file su Hugging Face (modelli, non dataset): dopo
 * `resolve/` una revisione e almeno un segmento di percorso. Un prefisso a
 * cui il codice aggiunge il file (`…/resolve/main"`) non conta.
 *
 * La `}` chiude l'indirizzo come le virgolette: e' il valore di ripiego di
 * una variabile di shell o di Compose (`${MODELLO:-https://…}`), o la fine di
 * una mappa YAML in linea, e non fa parte dell'URL. Se restasse attaccata,
 * l'indirizzo sembrerebbe composto a run time e non si controllerebbe. La `{`
 * invece resta dentro: un segnaposto (`…/main/{file}`, `${voce}`) rende
 * l'indirizzo composto, e come tale si salta.
 */
const URL_HF =
  /https:\/\/(?:huggingface\.co|hf\.co)\/(?!datasets\/)[\w.-]+\/[\w.-]+\/resolve\/[^/\s"'`)\]}<>]+\/[^\s"'`)\]}<>]+/g;

/** Estensioni dei file di pesi che non devono entrare nel repository fuori dal registro. */
export const ESTENSIONI_PESI =
  /\.(gguf|onnx|tflite|safetensors|pt|pth|ckpt|bin|pkl|pickle|joblib|npz|npy|h5)$/i;

/**
 * Chiamate che caricano un modello per nome, con il nome scritto per esteso
 * come primo argomento: `from_pretrained("org/modello")`,
 * `hf_hub_download(repo_id="org/modello", …)`, `torch.hub.load("org/repo", …)`,
 * `AudioSeal.load_generator("nome")`.
 */
const CARICAMENTO =
  /\b(?:from_pretrained|hf_hub_download|snapshot_download|torch\.hub\.load|load_generator|load_detector)\(\s*(?:repo_id\s*=\s*)?["']([^"']+)["']/g;

/** Una voce Piper nei Dockerfile: "<lingua>/<locale>/<nome>/<qualita'>/<voce>:<lingua>". */
const VOCE_PIPER =
  /"[a-z]{2,3}\/[a-z]{2,3}_[A-Z]{2}\/[\w]+\/(?:x_low|low|medium|high)\/([\w-]+):[a-z]{2,3}"/g;

const testoNonVuoto = (v) => typeof v === 'string' && v.trim().length > 0;

/** La revisione di un indirizzo Hugging Face (`…/resolve/<revisione>/…`), o null. */
export function revisioneHf(url) {
  if (typeof url !== 'string' || !SU_HF.test(url)) return null;
  return url.match(/\/resolve\/([^/]+)\//)?.[1] ?? null;
}

/**
 * Vero se il file scarica quella revisione: `resolve/<revisione>`, oppure,
 * per un commit, l'identificativo da solo (un file che compone l'indirizzo
 * da una costante, come il banco di prova dei sottotitoli).
 */
function contieneRevisione(testo, revisione) {
  if (testo.includes(`resolve/${revisione}`)) return true;
  return /^[0-9a-f]{40}$/.test(revisione) && testo.includes(revisione);
}

/** Il segno che identifica una voce nei file che la usano: l'impronta, o il nome del file senza estensione. */
export function segnoDellaVoce(voce) {
  if (voce.sha256) return voce.sha256;
  return voce.file ? voce.file.replace(/\.[^.]+$/, '') : null;
}

export function sha256(contenuto) {
  return createHash('sha256').update(contenuto).digest('hex');
}

/**
 * I problemi di una voce. `ambiente` da':
 *   leggi(percorso) -> testo del file, o null se manca
 *   impronta(percorso) -> SHA-256 del file, o null se manca
 *   documento -> testo di THIRD-PARTY-LICENSES.md
 */
export function problemiDellaVoce(voce, ambiente) {
  const problemi = [];
  const p = (m) => problemi.push(m);

  for (const campo of Object.keys(voce)) {
    if (!CAMPI.has(campo)) p(`unknown field "${campo}"`);
  }
  if (!testoNonVuoto(voce.name)) p('"name" is missing');
  if (!testoNonVuoto(voce.use)) p('"use" is missing');
  if (!CONSEGNE.includes(voce.delivery))
    p(`"delivery" must be one of ${CONSEGNE.join(', ')}`);

  // Lacune dichiarate.
  const lacune = new Map();
  if (voce.gaps !== undefined) {
    if (!Array.isArray(voce.gaps)) p('"gaps" must be a list');
    else
      for (const l of voce.gaps) {
        if (!TIPI_LACUNA.includes(l?.kind))
          p(`gap kind must be one of ${TIPI_LACUNA.join(', ')}`);
        else if (lacune.has(l.kind)) p(`gap "${l.kind}" is declared twice`);
        else if (!testoNonVuoto(l.note)) p(`gap "${l.kind}" has no note`);
        else lacune.set(l.kind, l.note);
      }
  }

  // Licenza.
  if (!testoNonVuoto(voce.license)) {
    p('"license" is missing (an SPDX expression, a LicenseRef or NOASSERTION)');
  } else {
    let esito = null;
    try {
      analizza(voce.license);
      ({ esito } = valuta(voce.license));
    } catch (e) {
      p(`"license" is not a readable SPDX expression: ${e.message}`);
    }
    const revisione = testoNonVuoto(voce.licenseReview);
    if (voce.licenseReview !== undefined && !revisione) p('"licenseReview" is empty');
    if (esito === 'ammessa' && revisione) {
      p(
        '"licenseReview" is only for a license that is not on the allowed list: remove it'
      );
    }
    if (esito === 'sconosciuta' && !revisione && !lacune.has('license')) {
      p(
        `license ${voce.license} is not on the allowed list: record a "licenseReview" ` +
          'after reading the terms, or declare a "license" gap'
      );
    }
    if (esito === 'sconosciuta' && revisione && lacune.has('license')) {
      p('both "licenseReview" and a "license" gap: keep the one that is true');
    }
    if (esito === 'vietata') {
      if (revisione)
        p(`license ${voce.license} is in a forbidden family: a review cannot clear it`);
      if (!lacune.has('license')) {
        p(
          `license ${voce.license} is in a forbidden family: declare a "license" gap and an open point`
        );
      }
    }
  }

  // Formato.
  if (FORMATI_PICKLE.includes(voce.format)) {
    if (!lacune.has('format')) {
      p(
        `format ${voce.format} runs code when loaded: use one of ${FORMATI_SICURI.join(', ')}, ` +
          'or declare a "format" gap'
      );
    }
  } else if (FORMATI_SICURI.includes(voce.format)) {
    if (lacune.has('format')) p(`format ${voce.format} needs no "format" gap: remove it`);
  } else {
    p(`"format" must be one of ${[...FORMATI_SICURI, ...FORMATI_PICKLE].join(', ')}`);
  }

  if (voce.sha256 !== undefined && !SHA256.test(voce.sha256)) {
    p('"sha256" must be 64 lowercase hex characters');
  }
  if (
    voce.ids !== undefined &&
    (!Array.isArray(voce.ids) || !voce.ids.every(testoNonVuoto))
  ) {
    p('"ids" must be a list of model ids');
  }

  // Consegna.
  if (voce.delivery === 'download' || voce.delivery === 'image') {
    if (!testoNonVuoto(voce.file)) p('"file" is missing');
    if (!testoNonVuoto(voce.url) || !voce.url.startsWith('https://'))
      p('"url" must be an https URL');
    if (voce.path !== undefined) p('"path" is only for delivery "repository"');
    const fissata =
      SHA256.test(voce.sha256 ?? '') &&
      testoNonVuoto(voce.url) &&
      (!SU_HF.test(voce.url) || REVISIONE_HF.test(voce.url));
    if (!fissata && !lacune.has('pinning')) {
      p(
        'not pinned: the URL needs a fixed revision (a Hugging Face commit, not a branch) and ' +
          '"sha256" its checksum, or declare a "pinning" gap'
      );
    }
    if (fissata && lacune.has('pinning')) p('pinned: remove the "pinning" gap');
    if (!Array.isArray(voce.usedIn) || voce.usedIn.length === 0) {
      p('"usedIn" must list the files that download it');
    } else {
      const segno = segnoDellaVoce(voce);
      const revisione = revisioneHf(voce.url);
      for (const f of voce.usedIn) {
        const testo = ambiente.leggi(f);
        if (testo === null) {
          p(`usedIn: ${f} does not exist`);
          continue;
        }
        if (segno && !testo.includes(segno)) {
          p(`usedIn: ${f} does not contain ${voce.sha256 ? 'its sha256' : segno}`);
        }
        if (revisione && !contieneRevisione(testo, revisione)) {
          p(`usedIn: ${f} does not download revision ${revisione} of the registry URL`);
        }
      }
    }
  } else if (voce.delivery === 'repository') {
    if (!testoNonVuoto(voce.path)) p('"path" is missing');
    else {
      const impronta = ambiente.impronta(voce.path);
      if (impronta === null) p(`path: ${voce.path} does not exist`);
      else if (impronta !== voce.sha256)
        p(`sha256 does not match ${voce.path} (found ${impronta})`);
    }
    for (const c of ['url', 'usedIn'])
      if (voce[c] !== undefined) p(`"${c}" is not for delivery "repository"`);
    if (lacune.has('pinning')) p('a file in the repository needs no "pinning" gap');
  } else if (voce.delivery === 'operator') {
    for (const c of ['url', 'sha256', 'usedIn', 'path']) {
      if (voce[c] !== undefined) p(`"${c}" is not for delivery "operator"`);
    }
    if (lacune.has('pinning')) p('delivery "operator" needs no "pinning" gap');
  }

  if (testoNonVuoto(voce.name) && !ambiente.documento.includes(voce.name)) {
    p(`${voce.name} is not described in THIRD-PARTY-LICENSES.md`);
  }
  return problemi;
}

/**
 * I modelli che compaiono nel repository fuori dal registro. `tracciati` sono
 * i file di `git ls-files`; `leggi` come sopra.
 */
export function modelliNonRegistrati(voci, tracciati, leggi) {
  const problemi = [];
  const indirizzi = new Set(voci.map((v) => v.url).filter(Boolean));
  const percorsi = new Set(voci.map((v) => v.path).filter(Boolean));
  const nomi = new Set(
    voci.flatMap((v) => [v.name, ...(Array.isArray(v.ids) ? v.ids : [])])
  );
  const fileImmagine = new Set(
    voci.filter((v) => v.delivery === 'image').map((v) => v.file)
  );

  for (const f of tracciati) {
    if (ESTENSIONI_PESI.test(f) && !percorsi.has(f)) {
      problemi.push(`${f}: model file in the repository without a "repository" entry`);
    }
    if (!daScansionare(f)) continue;
    const testo = leggi(f);
    if (testo === null || testo.includes('\0')) continue;
    for (const [indirizzo] of testo.matchAll(URL_HF)) {
      if (/[$`{]/.test(indirizzo)) continue; // indirizzo composto a run time
      if (!indirizzi.has(indirizzo)) {
        problemi.push(`${f}: ${indirizzo} is not in the registry`);
      }
    }
    for (const [, nome] of testo.matchAll(CARICAMENTO)) {
      if (!nomi.has(nome)) {
        problemi.push(`${f}: loads model ${nome}, which is not in the registry`);
      }
    }
    if (eDockerfile(f)) {
      for (const [, voce] of testo.matchAll(VOCE_PIPER)) {
        if (!fileImmagine.has(`${voce}.onnx`)) {
          problemi.push(
            `${f}: voice ${voce} is downloaded into the image but not in the registry`
          );
        }
      }
    }
  }
  return problemi;
}

export function eDockerfile(f) {
  return /(^|\/)(Dockerfile|Containerfile)[^/]*$/.test(f);
}

/**
 * I file in cui cercare modelli: niente documentazione, test, dati di prova,
 * lockfile o il registro stesso.
 */
export function daScansionare(f) {
  if (/\.md$/i.test(f)) return false;
  if (/(^|\/)(package-lock\.json|license-report\.json)$/.test(f)) return false;
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(f)) return false;
  if (/(^|\/)(test_[^/]*|conftest)\.py$/.test(f)) return false;
  if (/(^|\/)(e2e|__tests__|fixtures)\//.test(f)) return false;
  if (f.startsWith('scripts/licenses/')) return false;
  return true;
}

/**
 * L'ambiente di controllo sul repository in `radice`: i file tracciati da
 * Git, letti dal disco, e la pagina delle licenze. Lancia un errore se
 * `git ls-files` non funziona (il controllo vuole un checkout Git).
 */
export function ambienteDelRepository(radice) {
  const leggi = (relativo) => {
    try {
      return readFileSync(resolve(radice, relativo), 'utf8');
    } catch {
      return null;
    }
  };
  const tracciati = execFileSync('git', ['ls-files', '-z'], {
    cwd: radice,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean);
  return {
    leggi,
    impronta: (relativo) => {
      try {
        return sha256(readFileSync(resolve(radice, relativo)));
      } catch {
        return null;
      }
    },
    tracciati,
    documento: leggi('THIRD-PARTY-LICENSES.md') ?? '',
  };
}

/** Controlla l'intero registro: { problemi: [{ chi, motivo }], voci, lacune }. */
export function controllaRegistro(registro, ambiente) {
  const problemi = [];
  const voci = Array.isArray(registro?.models) ? registro.models : null;
  if (!voci)
    return {
      problemi: [{ chi: 'models.json', motivo: '"models" must be a list' }],
      voci: [],
      lacune: [],
    };

  const visti = new Set();
  const idVisti = new Map();
  for (const voce of voci) {
    const chi = `${voce.name ?? '?'}${voce.file ? ` (${voce.file})` : ''}`;
    if (visti.has(chi)) problemi.push({ chi, motivo: 'registered twice' });
    visti.add(chi);
    for (const id of Array.isArray(voce.ids) ? voce.ids : []) {
      if (idVisti.has(id))
        problemi.push({ chi, motivo: `id ${id} is also on ${idVisti.get(id)}` });
      idVisti.set(id, chi);
    }
    for (const motivo of problemiDellaVoce(voce, ambiente))
      problemi.push({ chi, motivo });
  }
  for (const motivo of modelliNonRegistrati(voci, ambiente.tracciati, ambiente.leggi)) {
    problemi.push({ chi: 'repository', motivo });
  }
  const lacune = voci.flatMap((v) =>
    Array.isArray(v.gaps) ? v.gaps.map((l) => ({ chi: v.name, ...l })) : []
  );
  return { problemi, voci, lacune };
}
