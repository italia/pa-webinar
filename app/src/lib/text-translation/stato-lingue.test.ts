import { describe, expect, it } from 'vitest';

import {
  ATTESA_MOTORE_MS,
  entroILimiti,
  testoTraducibile,
  letturaStatoTesti,
  lingueDaTradurre,
  lingueDellaPagina,
  statoLingua,
  stesseLingue,
  type FattiLingua,
} from './stato-lingue';

const base: FattiLingua = {
  principale: false,
  conTesto: false,
  origine: null,
  aggiornata: true,
  motore: true,
  inTraduzioneDaMs: null,
  fallita: false,
};
const stato = (f: Partial<FattiLingua>) => statoLingua({ ...base, ...f });

describe('statoLingua — una riga per ogni stato della scheda', () => {
  it('la lingua principale', () => {
    expect(stato({ principale: true, conTesto: true, origine: 'HUMAN' })).toBe(
      'principale'
    );
  });

  it('vuota, motore acceso: si traduce al salvataggio', () => {
    expect(stato({})).toBe('onSave');
  });

  it('tradotta in automatico da un testo che non c e piu, motore acceso: al salvataggio', () => {
    expect(stato({ conTesto: true, origine: 'MACHINE', aggiornata: false })).toBe(
      'onSave'
    );
  });

  it('un lavoro aperto la comprende: in traduzione, poi in attesa del motore', () => {
    expect(stato({ inTraduzioneDaMs: 60_000 })).toBe('translating');
    expect(stato({ inTraduzioneDaMs: ATTESA_MOTORE_MS })).toBe('translating');
    expect(stato({ inTraduzioneDaMs: ATTESA_MOTORE_MS + 1 })).toBe('waiting');
    // Anche una lingua tradotta in automatico che si sta ritraducendo.
    expect(stato({ conTesto: true, origine: 'MACHINE', inTraduzioneDaMs: 1 })).toBe(
      'translating'
    );
  });

  it('tradotta in automatico dal testo di adesso', () => {
    expect(stato({ conTesto: true, origine: 'MACHINE' })).toBe('machine');
    // Anche a motore spento resta una traduzione automatica valida.
    expect(stato({ conTesto: true, origine: 'MACHINE', motore: false })).toBe('machine');
  });

  it('scritta o riletta da una persona sul testo di adesso', () => {
    expect(stato({ conTesto: true, origine: 'HUMAN' })).toBe('human');
    // Un testo di prima degli stati vale come scritto da una persona.
    expect(stato({ conTesto: true, origine: null })).toBe('human');
  });

  it('il testo di una persona non passa mai a «in traduzione»', () => {
    expect(stato({ conTesto: true, origine: 'HUMAN', inTraduzioneDaMs: 1 })).toBe(
      'human'
    );
    expect(
      stato({ conTesto: true, origine: 'HUMAN', aggiornata: false, inTraduzioneDaMs: 1 })
    ).toBe('stale');
  });

  it('da aggiornare: una persona su un testo cambiato, o il motore spento su una traduzione vecchia', () => {
    expect(stato({ conTesto: true, origine: 'HUMAN', aggiornata: false })).toBe('stale');
    expect(
      stato({ conTesto: true, origine: 'MACHINE', aggiornata: false, motore: false })
    ).toBe('stale');
  });

  it('non riuscita: solo dove il salvataggio la tradurrebbe e il motore c e', () => {
    expect(stato({ fallita: true })).toBe('failed');
    expect(
      stato({ conTesto: true, origine: 'MACHINE', aggiornata: false, fallita: true })
    ).toBe('failed');
    expect(stato({ fallita: true, motore: false })).toBe('empty');
    expect(stato({ conTesto: true, origine: 'HUMAN', fallita: true })).toBe('human');
  });

  it('vuota a motore spento: nessuna promessa di traduzione', () => {
    expect(stato({ motore: false })).toBe('empty');
  });
});

describe('letturaStatoTesti', () => {
  it('tiene le voci valide e scarta il resto', () => {
    const h = 'a'.repeat(64);
    expect(
      letturaStatoTesti({
        en: {
          origin: 'MACHINE',
          sourceHash: h,
          at: '2026-10-20T10:00:00.000Z',
          model: 'm',
        },
        fr: { origin: 'HUMAN', sourceHash: h, at: '2026-10-20T10:00:00.000Z' },
        de: { origin: 'ALTRO', sourceHash: h },
        es: { origin: 'HUMAN' },
        'non valida': { origin: 'HUMAN', sourceHash: h },
      })
    ).toEqual({
      en: {
        origin: 'MACHINE',
        sourceHash: h,
        at: '2026-10-20T10:00:00.000Z',
        model: 'm',
      },
      fr: { origin: 'HUMAN', sourceHash: h, at: '2026-10-20T10:00:00.000Z' },
    });
    expect(letturaStatoTesti(null)).toEqual({});
    expect(letturaStatoTesti([1])).toEqual({});
  });
});

describe('lingue della pagina e lingue da tradurre', () => {
  it('le lingue della pagina sono quelle dell evento attive sul sito, senza la principale', () => {
    expect(lingueDellaPagina(['en', 'it', 'uk', 'fr'], ['it', 'en', 'fr'], 'it')).toEqual(
      ['en', 'fr']
    );
  });

  it('si traducono le lingue vuote e quelle automatiche da un altro testo; mai quelle di una persona', () => {
    const h = 'b'.repeat(64);
    expect(
      lingueDaTradurre({
        pagina: ['en', 'fr', 'de', 'es', 'pt', 'en'],
        titoli: { en: 'Title', fr: 'Titre', de: 'Titel', es: '  ', pt: 'Título' },
        descrizioni: {},
        stato: {
          en: { origin: 'MACHINE', sourceHash: 'vecchia', at: '' },
          fr: { origin: 'MACHINE', sourceHash: h, at: '' },
          de: { origin: 'HUMAN', sourceHash: 'vecchia', at: '' },
        },
        impronta: h,
      })
    ).toEqual(['en', 'es']);
  });

  it('stesseLingue non guarda l ordine ne i doppioni', () => {
    expect(stesseLingue(['en', 'fr'], ['fr', 'en', 'en'])).toBe(true);
    expect(stesseLingue(['en'], ['en', 'fr'])).toBe(false);
  });
});

describe('testoTraducibile', () => {
  it('serve un testo, entro i limiti: oltre, nessuna promessa di traduzione', () => {
    expect(testoTraducibile('Titolo', '')).toBe(true);
    expect(testoTraducibile('  ', ' ')).toBe(false);
    expect(testoTraducibile('x'.repeat(301), '')).toBe(false);
    expect(testoTraducibile('Titolo', 'x'.repeat(10_001))).toBe(false);
    // Nel modulo un testo ancora vuoto non spegne la promessa: lo chiede la validazione.
    expect(entroILimiti('', '')).toBe(true);
    expect(entroILimiti('x'.repeat(301), '')).toBe(false);
  });
});
