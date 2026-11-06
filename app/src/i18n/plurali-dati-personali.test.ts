// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import inglese from './messages/en.json';
import italiano from './messages/it.json';

/**
 * I conteggi che una persona legge sui propri dati e sulle sessioni: con una
 * sola voce la frase e' al singolare, e chi non aveva iscrizioni non legge
 * «0 iscrizioni cancellate».
 */
function frase(
  messages: typeof italiano,
  namespace: string,
  chiave: string,
  count: number
) {
  const t = createTranslator({
    locale: messages === italiano ? 'it' : 'en',
    messages: messages as unknown as Record<string, string>,
  }) as unknown as (chiave: string, valori: { count: number }) => string;
  return t(`${namespace}.${chiave}`, { count });
}

const CASI = [
  [
    'gdpr.export',
    'resultsDescription',
    1,
    'Trovati dati relativi a 1 evento.',
    'Found data related to 1 event.',
  ],
  [
    'gdpr.export',
    'resultsDescription',
    3,
    'Trovati dati relativi a 3 eventi.',
    'Found data related to 3 events.',
  ],
  [
    'gdpr.erasure',
    'doneBody',
    0,
    'Nessuna iscrizione da cancellare.',
    'No registrations to delete.',
  ],
  [
    'gdpr.erasure',
    'doneBody',
    1,
    'È stata cancellata 1 iscrizione, con i dati collegati.',
    '1 registration and the linked data have been deleted.',
  ],
  [
    'gdpr.erasure',
    'doneBody',
    2,
    'Sono state cancellate 2 iscrizioni, con i dati collegati.',
    '2 registrations and the linked data have been deleted.',
  ],
  [
    'events.detail',
    'peakParticipants',
    1,
    'Picco: 1 partecipante',
    'Peak: 1 participant',
  ],
  [
    'events.detail',
    'peakParticipants',
    40,
    'Picco: 40 partecipanti',
    'Peak: 40 participants',
  ],
  ['admin.sessions', 'participantsCount', 1, '1 partecipante', '1 participant'],
  ['admin.sessions', 'participantsCount', 40, '40 partecipanti', '40 participants'],
] as const;

describe('i conteggi sui dati personali e sulle sessioni', () => {
  it.each(CASI)('%s.%s con %i', (namespace, chiave, count, attesoIt, attesoEn) => {
    expect(frase(italiano, namespace, chiave, count)).toBe(attesoIt);
    expect(frase(inglese as unknown as typeof italiano, namespace, chiave, count)).toBe(
      attesoEn
    );
  });
});

describe('la richiesta dei propri dati', () => {
  // La pagina mostra i dati a schermo: non c'e' un file da scaricare.
  it('promette di vederli, non di scaricarli', () => {
    expect(italiano.gdpr.export.requestSubmittedBody).toContain('per vedere i tuoi dati');
    expect(inglese.gdpr.export.requestSubmittedBody).toContain('to view your data');
  });
});
