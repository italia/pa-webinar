import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { eventBaseSchema } from '@/lib/validation/schemas';

import { CREATED_EVENT_FIELDS, NOT_CREATED_EVENT_FIELDS } from './create-fields';

/**
 * Il presidio che alla creazione di un evento non c'era.
 *
 * Ogni campo che lo schema accetta dev'essere o persistito, o dichiarato come
 * deliberatamente non persistito, con il motivo. Aggiungine uno e dimenticalo
 * nella rotta e questo diventa rosso, invece del prossimo evento che nasce
 * senza — che è come si sono persi il modello dell'informativa, i requisiti
 * sull'organizzazione e la nuvola di parole.
 *
 * L'ultimo caso è quello che conta davvero: non si limita a confrontare due
 * elenchi paralleli, ma va a leggere la rotta. Un elenco che si aggiorna da
 * solo senza che la rotta cambi sarebbe esattamente il difetto di prima, con
 * un passaggio in più.
 */
const chiaviSchema = Object.keys(eventBaseSchema.shape);

/** Il blocco `data` con cui la rotta di creazione chiama Prisma. */
function bloccoCreate(): string {
  // Risolto rispetto a questo file, non alla directory di lavoro: la suite
  // gira sia dalla radice del repo sia da `app/`.
  const qui = dirname(fileURLToPath(import.meta.url));
  const percorso = join(qui, '../../app/api/events/route.ts');
  const sorgente = readFileSync(percorso, 'utf8');
  const inizio = sorgente.indexOf('const event = await prisma.event.create({');
  expect(inizio, 'la create della rotta non è stata trovata').toBeGreaterThan(-1);
  const fine = sorgente.indexOf('\n  });', inizio);
  return sorgente.slice(inizio, fine);
}

describe('Campi persistiti alla creazione di un evento', () => {
  it('lo schema di creazione espone i campi attesi', () => {
    expect(chiaviSchema.length).toBeGreaterThan(50);
  });

  it('classifica OGNI campo dello schema come persistito o escluso a ragion veduta', () => {
    const persistiti = new Set<string>(CREATED_EVENT_FIELDS);
    const esclusi = new Set(Object.keys(NOT_CREATED_EVENT_FIELDS));

    const nonClassificati = chiaviSchema.filter(
      (k) => !persistiti.has(k) && !esclusi.has(k),
    );

    expect(
      nonClassificati,
      `Campi accettati dallo schema e non classificati: ${nonClassificati.join(', ')}. ` +
        'Aggiungili a CREATED_EVENT_FIELDS se la rotta li scrive, oppure a ' +
        'NOT_CREATED_EVENT_FIELDS con il motivo per cui non li scrive.',
    ).toEqual([]);
  });

  it('non classifica nessun campo in entrambe le liste', () => {
    const esclusi = new Set(Object.keys(NOT_CREATED_EVENT_FIELDS));
    const doppi = CREATED_EVENT_FIELDS.filter((k) => esclusi.has(k));
    expect(doppi).toEqual([]);
  });

  it('non elenca campi che lo schema non accetta', () => {
    const noti = new Set(chiaviSchema);
    const fantasmi = [
      ...CREATED_EVENT_FIELDS,
      ...Object.keys(NOT_CREATED_EVENT_FIELDS),
    ].filter((k) => !noti.has(k));
    expect(
      fantasmi,
      `Campi elencati qui e non presenti nello schema: ${fantasmi.join(', ')}`,
    ).toEqual([]);
  });

  it('ogni campo dichiarato persistito compare davvero nella rotta', () => {
    // È l'asserzione che avrebbe fermato il difetto: le altre confrontano
    // due elenchi fra loro, questa confronta l'elenco con il codice.
    const blocco = bloccoCreate();
    const assenti = CREATED_EVENT_FIELDS.filter(
      (k) => !new RegExp(`(^|[^\\w.])${k}\\s*:`, 'm').test(blocco),
    );
    expect(
      assenti,
      `Dichiarati persistiti ma non scritti dalla rotta: ${assenti.join(', ')}`,
    ).toEqual([]);
  });

  it('ogni esclusione porta un motivo scritto', () => {
    for (const [campo, motivo] of Object.entries(NOT_CREATED_EVENT_FIELDS)) {
      expect(motivo.length, `${campo} è escluso senza motivo`).toBeGreaterThan(20);
    }
  });
});
