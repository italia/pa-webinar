import { describe, expect, it } from 'vitest';

import { CaptionAssembler, chooseCut, makeRewriter } from './captions.js';
import { numbersToDigits } from './numbers.js';

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

  it('non spezza un numero detto in più parole fra due sottotitoli', () => {
    const a = new CaptionAssembler({ idPrefix: 's', maxChars: 40, rewrite: numbersToDigits });
    const updates = a.push('abbiamo coinvolto le persone nel duemila ventisei e poi');
    expect(updates[0]).toEqual({ messageId: 's-1', text: 'abbiamo coinvolto le persone nel', final: true });
    expect(updates[1]?.text).toBe('2026 e poi');
  });

  it('non stacca un ora dal suo «alle»', () => {
    const a = new CaptionAssembler({ idPrefix: 's', maxChars: 40, rewrite: numbersToDigits });
    const updates = a.push('ringrazio di cuore le colleghe e i colleghi qui presenti alle dieci e trenta');
    // Il secondo pezzo è ancora troppo lungo: si spezza prima di «alle», non dopo.
    expect(updates.map((u) => u.text)).toEqual(['ringrazio di cuore le colleghe e i', 'colleghi qui presenti', 'alle 10:30']);
  });

  const parolaPerParola = (a: CaptionAssembler, text: string) => {
    const finals: string[] = [];
    let shown = '';
    for (const w of text.split(' ')) {
      for (const u of a.push(`${w} `)) {
        if (u.final) finals.push(u.text);
        else shown = u.text;
      }
    }
    return { finals, shown, rest: a.finish().map((u) => u.text) };
  };

  it('in italiano, in diretta, aspetta qualche parola prima di tagliare', () => {
    const a = new CaptionAssembler({ idPrefix: 's', maxChars: 45, rewrite: numbersToDigits, readsAhead: () => true });
    const { finals, rest } = parolaPerParola(a, 'ringrazio di cuore tutte le colleghe qui alle tre e mezza in sala');
    // Il taglio vicino al limite separerebbe «alle» dalla sua ora: si torna a quello prima.
    expect([...finals, ...rest]).toEqual(['ringrazio di cuore tutte le colleghe qui', 'alle 3 e mezza in sala']);
  });

  it('senza regole che guardano avanti taglia subito sull ultimo spazio, senza riprendersi parole', () => {
    const a = new CaptionAssembler({ idPrefix: 's', maxChars: 40, rewrite: (t) => t });
    const { finals } = parolaPerParola(a, 'the quick brown fox jumps over the lazy dog near the river bank today');
    expect(finals[0]).toBe('the quick brown fox jumps over the lazy');
  });

  it('un taglio forzato cerca uno spazio poco oltre il limite pur di non spezzare un numero', () => {
    // Nessuno spazio permesso fra un terzo del limite e il limite: il taglio sarebbe dentro il numero.
    const a = new CaptionAssembler({ idPrefix: 's', maxChars: 36, rewrite: numbersToDigits });
    const out = a.finish('prevede centoventitremila quattrocentocinquantasei euro per tutti');
    expect(out.map((u) => u.text)).toEqual(['prevede 123.456', 'euro per tutti']);
  });

  it('in diretta il taglio forzato usa lo spazio oltre il limite appena è sicuro', () => {
    const a = new CaptionAssembler({ idPrefix: 's', maxChars: 36, rewrite: numbersToDigits, readsAhead: () => true });
    const { finals, rest } = parolaPerParola(a, 'prevede centoventitremila quattrocentocinquantasei euro per tutti i comuni');
    // Non aspetta 1,5 volte il limite per poi riprendersi «euro per tutti».
    expect([...finals, ...rest]).toEqual(['prevede 123.456', 'euro per tutti i comuni']);
  });

  it('la fine in ritardo di una sessione in un altra lingua non tocca il sottotitolo aperto', () => {
    const a = new CaptionAssembler({ idPrefix: 's', maxChars: 160, rewrite: (t, l) => (l === 'it-IT' ? numbersToDigits(t) : t) });
    const finals = (us: Array<{ text: string; final: boolean; language?: string }>) =>
      us.filter((u) => u.final).map((u) => `${u.language}:${u.text}`);
    const out: string[] = [];
    out.push(...finals(a.push('Buongiorno a tutti', 'it-IT')));
    out.push(...finals(a.push(' Hello everyone', 'en-GB')));
    // Il «completed» della sessione italiana arriva dopo: il suo testo è già chiuso.
    out.push(...finals(a.finish('Buongiorno a tutti.', 'it-IT')));
    out.push(...finals(a.push(' and welcome', 'en-GB')));
    out.push(...finals(a.finish('Hello everyone and welcome.', 'en-GB')));
    expect(out).toEqual(['it-IT:Buongiorno a tutti', 'en-GB:Hello everyone and welcome.']);
  });

  it('una sessione che finisce senza testo aperto consegna il suo definitivo', () => {
    const a = new CaptionAssembler({ idPrefix: 's', maxChars: 160 });
    a.push('Ciao', 'it-IT');
    a.finish();
    expect(a.finish('Hello.', 'en-GB')).toEqual([{ messageId: 's-2', text: 'Hello.', final: true, language: 'en-GB' }]);
  });

  it('non taglia su un punto dentro un termine del glossario', () => {
    const a = new CaptionAssembler({
      idPrefix: 's',
      maxChars: 30,
      rewrite: makeRewriter([{ term: 'PA', aliases: ['p. a.'] }]),
    });
    const out = a.finish('i servizi digitali della p. a. sono per tutti');
    expect(out.map((u) => u.text)).toEqual(['i servizi digitali della PA', 'sono per tutti']);
  });

  it('in diretta non taglia su una virgola prima che la parola dopo sia arrivata intera', () => {
    const a = new CaptionAssembler({ idPrefix: 's', maxChars: 40, rewrite: numbersToDigits, readsAhead: () => true });
    const finals: string[] = [];
    for (const d of ["Ringrazio molto per l'invito la collega,", ' Tre', 'nta', ' che ha organizzato', ' tutto.']) {
      finals.push(...a.push(d).filter((u) => u.final).map((u) => u.text));
    }
    finals.push(...a.finish().map((u) => u.text));
    expect(finals.join(' ')).not.toContain('30');
    expect(finals.join(' ')).toContain('Trenta');
  });

  it('un sottotitolo non mescola due lingue', () => {
    const a = new CaptionAssembler({ idPrefix: 's', maxChars: 160, rewrite: numbersToDigits });
    a.push('Buongiorno a tutti', 'it-IT');
    expect(a.push('Hello', 'en-GB')).toEqual([
      { messageId: 's-1', text: 'Buongiorno a tutti', final: true, language: 'it-IT' },
      { messageId: 's-2', text: 'Hello', final: false, language: 'en-GB' },
    ]);
  });

  it('porta la lingua del testo negli aggiornamenti e la passa alla riscrittura', () => {
    const seen: Array<string | null> = [];
    const a = new CaptionAssembler({
      idPrefix: 's',
      maxChars: 160,
      rewrite: (t, language) => {
        seen.push(language);
        return t;
      },
    });
    expect(a.push('Hello', 'en-GB')).toEqual([{ messageId: 's-1', text: 'Hello', final: false, language: 'en-GB' }]);
    expect(a.finish()).toEqual([{ messageId: 's-1', text: 'Hello', final: true, language: 'en-GB' }]);
    expect(seen.every((l) => l === 'en-GB')).toBe(true);
  });

  it('non spezza un termine del glossario detto in più parole', () => {
    const a = new CaptionAssembler({
      idPrefix: 's',
      maxChars: 30,
      rewrite: makeRewriter([{ term: 'PagoPA', aliases: ['pago pa'] }]),
    });
    const updates = a.push('i comuni che usano il sistema pago pa da anni');
    expect(updates.map((u) => u.text)).toEqual(['i comuni che usano il sistema', 'PagoPA da anni']);
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

describe('chooseCut', () => {
  it('preferisce la fine frase, poi l’inciso, poi lo spazio', () => {
    expect(chooseCut('Una frase. Poi altro testo lungo', 20).at).toBe(10);
    expect(chooseCut('Una parte, poi altro testo lungo', 20).at).toBe(10);
    expect(chooseCut('nessuna punteggiatura qui dentro', 20).at).toBe(7);
  });

  it('evita i punti vietati, ma non troppo vicino all inizio', () => {
    expect(chooseCut('aa bb duemila ventisei', 15, (at) => at === 13).at).toBe(5);
    expect(chooseCut('nessuna punteggiatura qui dentro', 20, () => true).at).toBe(7);
  });
});
