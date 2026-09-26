/**
 * Patch del bundle di jitsi/web, per FORMA e non per nome.
 *
 * Gli identificatori di un bundle minificato cambiano a ogni build di upstream:
 * la variabile del contesto audio della soppressione rumore e' stata `Xy` in
 * stable-10741 e `Vs` in stable-11031. Un ago scritto a mano vuol dire che ogni
 * aggiornamento di versione comincia con mezz'ora di archeologia sul minificato
 * — ed e' il motivo per cui un ambiente e' rimasto fermo con l'immagine mancante.
 *
 * Qui si cercano le due strutture, ciascuna con l'asserzione che ci sia UNA
 * sola corrispondenza: nessuna (upstream ha cambiato forma, o ha risolto) e piu'
 * di una (ambigua) fermano la costruzione invece di far uscire un bundle
 * silenziosamente sbagliato. Su un'immagine in cui un errore AMMUTOLISCE i
 * microfoni, fermarsi e' l'unico esito accettabile.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('FATALE: manca il percorso del bundle');
  process.exit(1);
}

let src = readFileSync(file, 'utf8');

/** Applica una sostituzione unica, o esce. */
function sostituisciUnica(regex, costruisciNuovo, descrizione) {
  const trovate = [...src.matchAll(regex)];
  if (trovate.length !== 1) {
    console.error(
      `FATALE: ${descrizione} — attese 1 corrispondenza, trovate ${trovate.length} ` +
        `(l'immagine di base e' cambiata?)`,
    );
    process.exit(1);
  }
  const vecchio = trovate[0][0];
  const nuovo = costruisciNuovo(trovate[0]);
  if (src.split(vecchio).length - 1 !== 1) {
    console.error(`FATALE: ${descrizione} — il testo da sostituire non e' unico`);
    process.exit(1);
  }
  src = src.replace(vecchio, nuovo);
  if (src.includes(vecchio) || src.split(nuovo).length - 1 !== 1) {
    console.error(`FATALE: ${descrizione} — verifica della sostituzione fallita`);
    process.exit(1);
  }
  return trovate[0];
}

// ── 1. rnnoise: contesto audio a 48 kHz ────────────────────────────────────
// La forma e' `X||(X=new AudioContext)`, con X la variabile di modulo del
// contesto condiviso. Il contesto del mixer audio locale — `this.audioContext =
// new AudioContext` — ha una forma diversa e resta intoccato di proposito.
const rumore = sostituisciUnica(
  /(\w+)\|\|\(\1=new AudioContext\)/g,
  (m) => `${m[1]}||(${m[1]}=new AudioContext({sampleRate:48000}))`,
  'contesto audio della soppressione rumore',
);

// Controprova che sia DAVVERO quello della soppressione rumore e non un altro
// contesto condiviso comparso nel frattempo: e' su quello che viene caricato il
// worklet di rnnoise.
const variabile = rumore[1];
if (!src.includes(`${variabile}.audioWorklet.addModule`)) {
  console.error(
    `FATALE: la variabile ${variabile} non carica nessun worklet audio: ` +
      `non e' il contesto della soppressione rumore`,
  );
  process.exit(1);
}

// ── 2. "Nascondi la tua immagine": un false esplicito deve vincere ─────────
// Forma: config.disableSelfView || settings.disableSelfView || isVisitor(state).
// Il nome della funzione sui visitatori cambia a ogni build, quindi si cattura.
sostituisciUnica(
  /e\["features\/base\/config"\]\.disableSelfView\|\|e\["features\/base\/settings"\]\.disableSelfView\|\|(\w+)\(e\)/g,
  (m) =>
    '(!1!==e["features/base/config"].disableSelfView&&' +
    '(e["features/base/config"].disableSelfView||' +
    'e["features/base/settings"].disableSelfView))||' +
    `${m[1]}(e)`,
  'selettore della vista di se stessi',
);

writeFileSync(file, src);
console.log(
  `OK: contesto della soppressione rumore (${variabile}) forzato a 48 kHz; ` +
    'un config.disableSelfView=false esplicito ora vince sul valore memorizzato',
);
