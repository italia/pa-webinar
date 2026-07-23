import fs from 'fs';
import path from 'path';

import { describe, it, expect } from 'vitest';

import { resolveRnnoiseEnforceOff } from './rnnoise';

/**
 * Due difetti, entrambi già capitati, entrambi visibili solo a evento iniziato.
 *
 * 1. Accendere rnnoise per sbaglio. Sull'immagine jitsi/web non patchata il
 *    worklet ammutolisce i microfoni non a 48 kHz: chi parla non si sente e
 *    nessuno sa perché. Il default deve restare SPENTO anche quando la
 *    variabile è assente, vuota o scritta in un modo che non riconosciamo.
 *
 * 2. Congelare la scelta nell'immagine. `process.env.NEXT_PUBLIC_*` in
 *    notazione puntata dentro un componente client viene sostituito da webpack
 *    a BUILD time: il flag finisce cotto nel bundle e cambiarlo in Helm non ha
 *    alcun effetto — per accendere rnnoise servirebbe ricostruire e ri-rilasciare
 *    l'immagine. È la stessa trappola già corretta per NEXT_PUBLIC_APP_URL in
 *    lib/auth/jwt.ts, ed è per questo che il cablaggio (Server Component che
 *    legge con getPublicEnv → prop fino a JitsiRoom) è verificato qui sotto e
 *    non lasciato alla memoria di chi rifattorizzerà.
 */

describe('resolveRnnoiseEnforceOff', () => {
  it('senza variabile impostata rnnoise resta FORZATA OFF', () => {
    // Il caso normale: dev, test, e ogni pod a cui nessuno ha detto niente.
    expect(resolveRnnoiseEnforceOff(undefined)).toBe(true);
    expect(resolveRnnoiseEnforceOff(null)).toBe(true);
    expect(resolveRnnoiseEnforceOff('')).toBe(true);
  });

  it('solo la stringa esatta "false" accende rnnoise', () => {
    expect(resolveRnnoiseEnforceOff('false')).toBe(false);
  });

  it('tollera spazi e maiuscole, che è quello che esce da un values.yaml', () => {
    expect(resolveRnnoiseEnforceOff(' false ')).toBe(false);
    expect(resolveRnnoiseEnforceOff('False')).toBe(false);
    expect(resolveRnnoiseEnforceOff('FALSE')).toBe(false);
  });

  it('un valore che non riconosciamo NON accende rnnoise', () => {
    // Col doppio negativo nel nome della variabile ("enforce" = forza OFF),
    // chi scrive 'off'/'no'/'0' crede di star spegnendo qualcosa. Indovinare
    // la sua intenzione qui significherebbe accendere rnnoise per sbaglio:
    // meglio ignorarlo e restare sul comportamento sicuro.
    for (const raw of ['off', 'no', '0', 'disabled', 'true', 'flase', 'null']) {
      expect(resolveRnnoiseEnforceOff(raw)).toBe(true);
    }
  });
});

const SRC = path.resolve(__dirname, '../..');
const LIVE_PAGE = path.join(SRC, 'app/[locale]/events/[slug]/live/page.tsx');
const LIVE_CLIENT = path.join(SRC, 'components/live/live-event-client.tsx');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** Via i commenti: qui contiamo punti di montaggio JSX, e una riga di prosa che
 *  cita `<JitsiRoom>` non è un punto di montaggio. Toglie i blocchi e i commenti
 *  che occupano l'intera riga — non quelli a fine riga, per non troncare codice
 *  vero su una `//` dentro una stringa. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('cablaggio del flag rnnoise (deve restare a RUNTIME)', () => {
  it('nessun file legge NEXT_PUBLIC_JITSI_RNNOISE_ENFORCE in notazione puntata', () => {
    // La lettura ammessa è una sola: `getPublicEnv('NEXT_PUBLIC_JITSI_RNNOISE_ENFORCE')`,
    // che passa per la bracket notation di lib/env.ts — l'unica che webpack non
    // sostituisce. L'ago è composto a pezzi perché questo file non sia il primo
    // a violare la regola che verifica.
    const dottedRead = ['process', 'env', 'NEXT_PUBLIC_JITSI_RNNOISE_ENFORCE'].join('.');
    const offenders = sourceFiles(SRC).filter((file) =>
      // Fuori dai commenti: spiegare la trappola non è caderci.
      stripComments(fs.readFileSync(file, 'utf8')).includes(dottedRead),
    );
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it('il Server Component della sala legge il valore a runtime', () => {
    const page = fs.readFileSync(LIVE_PAGE, 'utf8');
    expect(page).toContain("getPublicEnv('NEXT_PUBLIC_JITSI_RNNOISE_ENFORCE')");
    expect(page).toContain('resolveRnnoiseEnforceOff');
  });

  it('ogni ramo della pagina passa il flag, non solo quello dei registrati', () => {
    // La pagina renderizza LiveEventClient da più rami (ospite di una instant
    // call, partecipante registrato/moderatore). Se uno dimentica la prop, in
    // quella stessa sala una parte dei presenti userebbe il default e l'altra
    // il valore configurato: rnnoise accesa per alcuni e spenta per altri,
    // proprio nella call in cui la si sta validando.
    const page = stripComments(fs.readFileSync(LIVE_PAGE, 'utf8'));
    expect(countOccurrences(page, 'rnnoiseEnforceOff={rnnoiseEnforceOff}')).toBe(
      countOccurrences(page, '<LiveEventClient'),
    );
  });

  it('LiveEventClient inoltra il flag a JitsiRoom', () => {
    // Il ponte più facile da perdere in un refactor: senza questa riga il
    // valore arriva dal server e muore nel componente intermedio, e la sala
    // torna silenziosamente al default.
    const client = stripComments(fs.readFileSync(LIVE_CLIENT, 'utf8'));
    expect(countOccurrences(client, 'rnnoiseEnforceOff={rnnoiseEnforceOff}')).toBe(
      countOccurrences(client, '<JitsiRoom'),
    );
  });
});
