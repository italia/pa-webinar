import { describe, expect, it } from 'vitest';

import { CaptionAssembler, makeRewriter, splitPoint } from './captions.js';

describe('CaptionAssembler', () => {
  it('accumula i frammenti in un provvisorio con il testo intero', () => {
    const a = new CaptionAssembler({ idPrefix: 's', maxChars: 160 });
    expect(a.push('Buon')).toEqual([{ messageId: 's-1', text: 'Buon', final: false }]);
    expect(a.push('giorno a')).toEqual([{ messageId: 's-1', text: 'Buongiorno a', final: false }]);
    expect(a.push(' tutti.')).toEqual([{ messageId: 's-1', text: 'Buongiorno a tutti.', final: false }]);
  });

  it('chiude la frase con finish e riparte con un nuovo id', () => {
    const a = new CaptionAssembler({ idPrefix: 's', maxChars: 160 });
    a.push('Prima frase');
    expect(a.finish()).toEqual([{ messageId: 's-1', text: 'Prima frase', final: true }]);
    expect(a.push('Seconda')).toEqual([{ messageId: 's-2', text: 'Seconda', final: false }]);
    expect(a.finish()).toEqual([{ messageId: 's-2', text: 'Seconda', final: true }]);
    expect(a.finish()).toEqual([]);
  });

  it('aggiunge la coda del testo definitivo del motore', () => {
    const a = new CaptionAssembler({ idPrefix: 's', maxChars: 160 });
    a.push('Sotto il ponte');
    expect(a.finish('Sotto il ponte.')).toEqual([{ messageId: 's-1', text: 'Sotto il ponte.', final: true }]);
  });

  it('ignora un definitivo che non allunga quanto ricevuto', () => {
    const a = new CaptionAssembler({ idPrefix: 's', maxChars: 160 });
    a.push('Testo ricevuto');
    expect(a.finish('Altro testo')).toEqual([{ messageId: 's-1', text: 'Testo ricevuto', final: true }]);
  });

  it('spezza un testo troppo lungo su un confine di frase', () => {
    const a = new CaptionAssembler({ idPrefix: 's', maxChars: 40 });
    const updates = a.push('La costruzione è terminata in agosto. Il traffico è passato a marzo');
    expect(updates[0]).toEqual({ messageId: 's-1', text: 'La costruzione è terminata in agosto.', final: true });
    expect(updates[1]).toEqual({ messageId: 's-2', text: 'Il traffico è passato a marzo', final: false });
  });

  it('toglie il tag di lingua che il modello aggiunge in modalità automatica', () => {
    const a = new CaptionAssembler({ idPrefix: 's', maxChars: 160 });
    a.push('Buongiorno a tutti.<it-IT> Oggi');
    expect(a.finish()[0]?.text).toBe('Buongiorno a tutti. Oggi');
  });

  it('applica le correzioni del glossario a provvisori e definitivi', () => {
    const a = new CaptionAssembler({
      idPrefix: 's',
      maxChars: 160,
      rewrite: makeRewriter([{ term: 'PagoPA', aliases: ['pago pa'] }]),
    });
    expect(a.push('Il servizio pago pa')[0]?.text).toBe('Il servizio PagoPA');
    expect(a.finish()[0]?.text).toBe('Il servizio PagoPA');
  });
});

describe('makeRewriter', () => {
  it('sostituisce solo a parola intera e senza badare alle maiuscole', () => {
    const r = makeRewriter([
      { term: 'SPID', aliases: ['spid', 'spit'] },
      { term: 'AgID', aliases: ['agi di', 'a gid'] },
    ]);
    expect(r('Entrate con lo Spit o con agi di')).toBe('Entrate con lo SPID o con AgID');
    expect(r('ospitalità')).toBe('ospitalità');
  });

  it('senza regole restituisce il testo com’è', () => {
    expect(makeRewriter([])('testo')).toBe('testo');
    expect(makeRewriter([{ term: 'X', aliases: [' '] }])('testo')).toBe('testo');
  });
});

describe('splitPoint', () => {
  it('preferisce la fine frase, poi l’inciso, poi lo spazio', () => {
    expect(splitPoint('Una frase. Poi altro testo lungo', 20)).toBe(10);
    expect(splitPoint('Una parte, poi altro testo lungo', 20)).toBe(10);
    expect(splitPoint('nessuna punteggiatura qui dentro', 20)).toBe(7);
  });
});
