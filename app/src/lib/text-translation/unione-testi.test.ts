import { describe, expect, it } from 'vitest';

import { testiDiUnEventoNuovo, unisciTesti } from './unione-testi';

const ORA = new Date('2026-10-20T12:00:00.000Z');
const NUOVA = 'n'.repeat(64);
const VECCHIA = 'v'.repeat(64);
const automatica = {
  origin: 'MACHINE' as const,
  sourceHash: VECCHIA,
  at: '2026-10-20T10:00:00.000Z',
  model: 'm',
};
const persona = { origin: 'HUMAN' as const, sourceHash: NUOVA, at: ORA.toISOString() };

const salvati = {
  title: { it: 'Titolo', en: 'Title (arrived)', fr: 'Titre', de: 'Titel' },
  description: { it: 'Descrizione', en: 'Text (arrived)', fr: 'Texte', de: 'Text' },
  stato: {
    en: automatica,
    fr: { origin: 'HUMAN' as const, sourceHash: VECCHIA, at: '2026-10-19T10:00:00.000Z' },
    de: automatica,
  },
};

describe('unisciTesti — con textEdits (il wizard)', () => {
  it('le lingue non toccate tengono il testo e lo stato salvati, anche se il modulo ne aveva un altro', () => {
    const out = unisciTesti({
      principale: 'it',
      salvati,
      // Il modulo aveva caricato l'inglese vuoto, prima che la traduzione arrivasse.
      inviati: {
        title: { it: 'Titolo nuovo', en: '', fr: 'Titre', de: 'Titel' },
        description: { it: 'Descrizione', en: '', fr: 'Texte', de: 'Text' },
      },
      toccate: [],
      lingueTolte: [],
      impronta: NUOVA,
      improntaPrecedente: VECCHIA,
      ora: ORA,
    });
    expect(out.title).toEqual({
      it: 'Titolo nuovo',
      en: 'Title (arrived)',
      fr: 'Titre',
      de: 'Titel',
    });
    expect(out.description.en).toBe('Text (arrived)');
    expect(out.stato).toEqual(salvati.stato);
  });

  it('una lingua toccata prende il testo del modulo e diventa di una persona; vuota perde lo stato', () => {
    const out = unisciTesti({
      principale: 'it',
      salvati,
      inviati: {
        title: { it: 'Titolo', en: 'My title', fr: 'Titre', de: '' },
        description: { it: 'Descrizione', en: 'My text', fr: 'Texte', de: '  ' },
      },
      toccate: ['en', 'de'],
      lingueTolte: [],
      impronta: NUOVA,
      improntaPrecedente: VECCHIA,
      ora: ORA,
    });
    expect(out.title).toEqual({ it: 'Titolo', en: 'My title', fr: 'Titre' });
    expect(out.description).toEqual({ it: 'Descrizione', en: 'My text', fr: 'Texte' });
    expect(out.stato.en).toEqual(persona);
    expect(out.stato).not.toHaveProperty('de');
    // La lingua non toccata resta com'era.
    expect(out.stato.fr).toEqual(salvati.stato.fr);
  });

  it('«Segna come riletta» (toccata, stesso testo) fa di una persona il testo automatico', () => {
    const out = unisciTesti({
      principale: 'it',
      salvati,
      inviati: { title: salvati.title, description: salvati.description },
      toccate: ['de'],
      lingueTolte: [],
      impronta: NUOVA,
      improntaPrecedente: VECCHIA,
      ora: ORA,
    });
    expect(out.stato.de).toEqual(persona);
    expect(out.title.de).toBe('Titel');
  });

  it('una lingua tolta dalle lingue dell evento perde testo e stato', () => {
    const out = unisciTesti({
      principale: 'it',
      salvati,
      inviati: { title: salvati.title, description: salvati.description },
      toccate: [],
      lingueTolte: ['fr'],
      impronta: NUOVA,
      improntaPrecedente: VECCHIA,
      ora: ORA,
    });
    expect(out.title).not.toHaveProperty('fr');
    expect(out.description).not.toHaveProperty('fr');
    expect(out.stato).not.toHaveProperty('fr');
  });

  it('la lingua principale viene sempre da chi salva e non ha uno stato', () => {
    const out = unisciTesti({
      principale: 'it',
      salvati: { ...salvati, stato: { ...salvati.stato, it: automatica } },
      inviati: { title: { it: 'Nuovo' }, description: { it: 'Altra descrizione' } },
      toccate: [],
      lingueTolte: [],
      impronta: NUOVA,
      improntaPrecedente: VECCHIA,
      ora: ORA,
    });
    expect(out.title.it).toBe('Nuovo');
    expect(out.description.it).toBe('Altra descrizione');
    expect(out.stato).not.toHaveProperty('it');
  });
});

describe('unisciTesti — senza textEdits (API, una scheda di prima)', () => {
  it('il testo inviato vale per tutte le lingue; dove cambia diventa di una persona', () => {
    const out = unisciTesti({
      principale: 'it',
      salvati,
      inviati: {
        title: { it: 'Titolo', en: 'Changed', fr: 'Titre' },
        description: { it: 'Descrizione', en: 'Text (arrived)', fr: 'Texte' },
      },
      toccate: null,
      lingueTolte: ['fr'],
      impronta: NUOVA,
      improntaPrecedente: VECCHIA,
      ora: ORA,
    });
    expect(out.title).toEqual({ it: 'Titolo', en: 'Changed', fr: 'Titre' });
    // de non inviato: tolto, come sempre faceva la sovrascrittura completa.
    expect(out.title).not.toHaveProperty('de');
    expect(out.stato.en).toEqual(persona);
    // Invariato: tiene il suo stato. Le lingue tolte valgono solo col wizard.
    expect(out.stato.fr).toEqual(salvati.stato.fr);
    expect(out.stato).not.toHaveProperty('de');
  });

  it('una modifica che non manda il titolo tiene quello salvato', () => {
    const out = unisciTesti({
      principale: 'it',
      salvati,
      inviati: { description: { ...salvati.description, en: 'New text' } },
      toccate: null,
      lingueTolte: [],
      impronta: NUOVA,
      improntaPrecedente: VECCHIA,
      ora: ORA,
    });
    expect(out.title).toEqual(salvati.title);
    expect(out.stato.en).toEqual(persona);
    expect(out.stato.de).toEqual(automatica);
  });
});

describe('unisciTesti — testi di prima degli stati', () => {
  const diPrima = {
    title: { it: 'Titolo', en: 'Old title' },
    description: { it: 'Descrizione', en: 'Old text' },
    stato: {},
  };
  it('una lingua senza stato resta di una persona, sul testo principale di prima', () => {
    for (const toccate of [[], null]) {
      const out = unisciTesti({
        principale: 'it',
        salvati: diPrima,
        inviati: {
          title: { it: 'Titolo nuovo', en: 'Old title' },
          description: diPrima.description,
        },
        toccate,
        lingueTolte: [],
        impronta: NUOVA,
        improntaPrecedente: VECCHIA,
        ora: ORA,
      });
      // Il testo principale e' cambiato: l'inglese ora risulta da aggiornare.
      expect(out.stato.en).toEqual({
        origin: 'HUMAN',
        sourceHash: VECCHIA,
        at: ORA.toISOString(),
      });
    }
  });
});

describe('testiDiUnEventoNuovo', () => {
  it('ogni lingua con un testo, oltre alla principale, e di chi la scrive', () => {
    const out = testiDiUnEventoNuovo({
      principale: 'it',
      title: { it: 'Titolo', en: 'Title', fr: '' },
      description: { it: 'Descrizione', de: 'Text' },
      impronta: NUOVA,
      ora: ORA,
    });
    expect(out.title).toEqual({ it: 'Titolo', en: 'Title' });
    expect(Object.keys(out.stato).sort()).toEqual(['de', 'en']);
    expect(out.stato.en).toEqual(persona);
  });
});
