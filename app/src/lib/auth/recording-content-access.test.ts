// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Presidio sul contenuto delle registrazioni (docs/adr/021-recording-content-access.md).
 *
 * Il contenuto (video, tracce, trascrizioni, sintesi, resoconto, traduzioni,
 * sottotitoli, doppiaggio) e' di chi organizza l'evento e di chi ha
 * partecipato, non dell'admin che non lo organizza ne' della chiave
 * dell'istanza (lib/recording/content-access). Questi test pretendono che ogni
 * rotta che lo legge o lo cambia passi dalla guardia del contenuto, e che una
 * rotta nuova della post-produzione dichiari se serve contenuto o metadati.
 * Il comportamento delle guardie lo provano lib/recording/content-access.test.ts
 * e test/db/accesso-contenuto.db.test.ts.
 */

const APP = path.resolve(__dirname, '../../app');

const GUARDIA_CONTENUTO =
  /\b(requireRecordingContent|requireSpeakerContent|requireEventContent)\(/;
/** Le letture che filtrano il contenuto riga per riga, senza rifiutare. */
const FILTRO_CONTENUTO = /\b(accessoContenutoStaff|eventiOrganizzati|organizzaEvento)\(/;

/** Le rotte del contenuto, metodo per metodo, ciascuna col suo perche'. */
const ROTTE_CONTENUTO: Record<string, Record<string, string>> = {
  'api/admin/postprod/recordings/[id]/media/route.ts': { GET: 'il video della sala' },
  'api/admin/postprod/recordings/[id]/tracks/route.ts': {
    GET: 'le voci per persona e l’archivio',
  },
  'api/admin/postprod/recordings/[id]/transcript/route.ts': {
    GET: 'la trascrizione da correggere',
    PUT: 'la correzione della trascrizione',
  },
  'api/admin/postprod/recordings/[id]/summary/route.ts': {
    GET: 'la sintesi',
    PUT: 'la correzione della sintesi',
  },
  'api/admin/postprod/recordings/[id]/translations/route.ts': {
    POST: 'produce una traduzione',
  },
  'api/admin/postprod/recordings/[id]/generate-ai/route.ts': {
    POST: 'trascrive e riassume',
  },
  'api/admin/postprod/recordings/[id]/rerun/route.ts': {
    POST: 'rifa’ la post-produzione',
  },
  'api/admin/postprod/recordings/[id]/archive/route.ts': {
    POST: 'produce l’archivio con le voci',
  },
  'api/admin/postprod/recordings/[id]/slides/route.ts': {
    PATCH: 'cambia come il video si mostra',
  },
  'api/admin/postprod/speakers/[id]/route.ts': { PUT: 'il nome dato a una voce' },
  'api/admin/events/[id]/report/route.ts': {
    POST: 'produce il resoconto',
    PUT: 'pubblica il resoconto',
  },
  'api/admin/events/[id]/captions-transcript/route.ts': {
    POST: 'scrive la trascrizione dai sottotitoli',
  },
  'api/admin/events/[id]/generate-ai/route.ts': { POST: 'trascrive e riassume' },
  'api/events/[param]/sessions/[id]/recording/route.ts': {
    GET: 'il file di una sessione',
  },
};

/**
 * Le rotte della post-produzione che servono metadati, aperte a chi gestisce
 * l'evento (admin compreso). Dove una risposta porterebbe anche contenuto, lo
 * filtra (`FILTRO_CONTENUTO`).
 */
const ROTTE_METADATI: Record<string, { perche: string; filtra?: true }> = {
  'api/admin/postprod/recordings/[id]/details/route.ts': {
    perche:
      'stato, durata, file e lavori; il doppiaggio e i nomi delle voci solo a chi organizza',
    filtra: true,
  },
  'api/admin/postprod/recordings/[id]/reliability/route.ts': {
    perche: 'metriche di qualita’ dei lavori, numeri senza testo',
  },
  'api/admin/postprod/recordings/[id]/cancel/route.ts': {
    perche: 'ferma i lavori in coda',
  },
  'api/admin/postprod/recordings/[id]/slides/route.ts': {
    perche: 'GET: le scelte e i materiali; il video solo a chi organizza',
    filtra: true,
  },
  'api/admin/postprod/recordings/[id]/slides/file/route.ts': {
    perche: 'il PDF di un materiale dell’evento, non della registrazione',
  },
  'api/admin/postprod/recordings/[id]/translations/route.ts': {
    perche: 'GET: quali lingue ci sono',
  },
  'api/admin/postprod/route.ts': {
    perche: 'l’elenco delle registrazioni; frasi d’esempio e nomi solo a chi organizza',
    filtra: true,
  },
  'api/admin/recordings/route.ts': {
    perche: 'l’elenco dei file; il link per aprirli solo a chi organizza',
    filtra: true,
  },
  'api/admin/events/[id]/report/route.ts': {
    perche: 'GET: requisiti e stato; il testo solo a chi organizza',
    filtra: true,
  },
};

/** Le rotte che consegnano il link di conduzione: solo a chi organizza l'evento. */
const ROTTE_LINK_CONDUZIONE = [
  'api/admin/moderators/route.ts',
  'api/admin/events/instant/route.ts',
];

function file(dir: string, nome: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .map((f) => f.replace(/\\/g, '/'))
    .filter((f) => f === nome || f.endsWith(`/${nome}`))
    .map((f) => path.join(dir, f));
}

const rel = (f: string) => path.relative(APP, f).replace(/\\/g, '/');

/** Il corpo del gestore di un metodo: da `export const METODO` al prossimo export. */
function gestore(sorgente: string, metodo: string): string | null {
  const inizio = sorgente.search(new RegExp(`export const ${metodo}\\s*=`));
  if (inizio < 0) return null;
  const dopo = sorgente
    .slice(inizio + 1)
    .search(/\nexport (const|async function|function) /);
  return dopo < 0 ? sorgente.slice(inizio) : sorgente.slice(inizio, inizio + 1 + dopo);
}

describe('rotte del contenuto delle registrazioni', () => {
  it.each(Object.entries(ROTTE_CONTENUTO))(
    '%s passa dalla guardia del contenuto',
    (rotta, metodi) => {
      const sorgente = readFileSync(path.join(APP, rotta), 'utf-8');
      for (const metodo of Object.keys(metodi)) {
        const corpo = gestore(sorgente, metodo);
        expect(corpo, `${rotta} ${metodo}`).not.toBeNull();
        expect(GUARDIA_CONTENUTO.test(corpo!), `${rotta} ${metodo}`).toBe(true);
      }
    }
  );

  it('le rotte di metadati che filtrano il contenuto lo fanno con la regola unica', () => {
    const senzaFiltro = Object.entries(ROTTE_METADATI)
      .filter(([, v]) => v.filtra)
      .map(([r]) => r)
      .filter((r) => !FILTRO_CONTENUTO.test(readFileSync(path.join(APP, r), 'utf-8')));
    expect(senzaFiltro).toEqual([]);
  });

  it('ogni rotta della post-produzione dichiara se serve contenuto o metadati', () => {
    const rotte = [...file(path.join(APP, 'api/admin/postprod'), 'route.ts')].map(rel);
    const mute = rotte.filter((r) => !(r in ROTTE_CONTENUTO) && !(r in ROTTE_METADATI));
    expect(mute).toEqual([]);
  });

  it('il link di conduzione esce solo per gli eventi che chi guarda organizza', () => {
    const senzaFiltro = ROTTE_LINK_CONDUZIONE.filter(
      (r) => !FILTRO_CONTENUTO.test(readFileSync(path.join(APP, r), 'utf-8'))
    );
    expect(senzaFiltro).toEqual([]);
  });

  it('nessuna rotta firma un file dello storage senza dire di quale evento e’', () => {
    const rotte = file(path.join(APP, 'api'), 'route.ts');
    const senzaEvento = rotte
      .filter((f) => /generateRecordingSasUrl\(/.test(readFileSync(f, 'utf-8')))
      .filter(
        (f) =>
          !/generateRecordingSasUrl\([^)]*,[^)]*,\s*[\w.]+,?\s*\)/s.test(
            readFileSync(f, 'utf-8')
          )
      )
      .map(rel);
    expect(senzaEvento).toEqual([]);
  });
});
