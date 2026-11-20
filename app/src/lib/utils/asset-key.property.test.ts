// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * Test basati su proprietà (fast-check) per le chiavi degli allegati: il nome
 * del file arriva da chi carica, e la chiave decide dove finisce il blob e
 * quale controllo d'accesso lo protegge. Nessun nome deve poter aggiungere
 * segmenti al percorso o spostare un allegato di chat su un altro evento.
 */
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

import {
  type AssetType,
  buildAssetKey,
  buildChatAssetKey,
  chatAssetEventId,
  isChatAssetPath,
  sanitizeFilename,
} from './asset-key';

// Fino a 200 unita': oltre i 60 caratteri, cosi' anche il troncamento (con e
// senza estensione) e la ripulitura che lo segue vengono esercitati.
const insidiosi = fc.constantFrom(
  '/',
  '\\',
  '.',
  '..',
  '-',
  '_',
  ' ',
  '%2e',
  '\u0000',
  'a',
  'Z',
  '9',
  'è',
  '😀'
);
const nome = fc.oneof(
  fc.string({ unit: 'binary' }),
  fc.string({ unit: 'binary', size: 'max', maxLength: 200 }),
  fc.string({ unit: insidiosi }),
  fc.string({ unit: insidiosi, size: 'max', maxLength: 200 })
);

const PER_CHIAVE = {
  uuid: '00000000-0000-4000-8000-000000000000',
  now: new Date(Date.UTC(2026, 0, 15)),
};

describe('sanitizeFilename (proprietà)', () => {
  it('restituisce solo caratteri sicuri, da 1 a 60', () => {
    fc.assert(
      fc.property(nome, (n) => {
        expect(sanitizeFilename(n)).toMatch(/^[A-Za-z0-9._-]{1,60}$/);
      })
    );
  });

  it('non restituisce mai un nome che risale le cartelle', () => {
    fc.assert(
      fc.property(nome, (n) => {
        const s = sanitizeFilename(n);
        expect(s).not.toBe('.');
        expect(s).not.toBe('..');
        expect(s).not.toMatch(/[\\/]/);
      })
    );
  });
});

describe('chiavi degli allegati (proprietà)', () => {
  it('un allegato pubblico ha sempre cinque segmenti e resta fuori dal namespace chat', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<AssetType>('image', 'audio', 'document'),
        nome,
        (tipo, n) => {
          const chiave = buildAssetKey(tipo, n, PER_CHIAVE);
          expect(chiave.split('/')).toHaveLength(5);
          expect(isChatAssetPath(chiave.slice('assets/'.length))).toBe(false);
        }
      )
    );
  });

  it("un allegato di chat torna sempre all'evento che l'ha caricato", () => {
    fc.assert(
      fc.property(fc.uuid(), nome, (eventId, n) => {
        const chiave = buildChatAssetKey(eventId, n, PER_CHIAVE);
        expect(chiave.split('/')).toHaveLength(6);
        expect(chatAssetEventId(chiave.slice('assets/'.length))).toBe(eventId);
      })
    );
  });
});
