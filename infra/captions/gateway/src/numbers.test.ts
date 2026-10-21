import { describe, expect, it } from 'vitest';

import { numbersToDigits, parseNumberWord } from './numbers.js';

describe('parseNumberWord', () => {
  it('legge le parole composte, con e senza accenti ed elisioni', () => {
    expect(parseNumberWord('duemilaventisei')).toBe(2026);
    expect(parseNumberWord('duemiladiciassette')).toBe(2017);
    expect(parseNumberWord('ventitré')).toBe(23);
    expect(parseNumberWord('ventitre')).toBe(23);
    expect(parseNumberWord('trentotto')).toBe(38);
    expect(parseNumberWord('ventuno')).toBe(21);
    expect(parseNumberWord('centottanta')).toBe(180);
    expect(parseNumberWord('centoottanta')).toBe(180);
    expect(parseNumberWord('trecentoventicinque')).toBe(325);
    expect(parseNumberWord('millecinquecento')).toBe(1500);
    expect(parseNumberWord('centomila')).toBe(100_000);
    expect(parseNumberWord('ventunmila')).toBe(21_000);
    expect(parseNumberWord('novecentonovantanovemilanovecentonovantanove')).toBe(999_999);
    expect(parseNumberWord('Diciannove')).toBe(19);
  });

  it('non scambia per numeri le parole che li contengono', () => {
    for (const word of [
      'millennio',
      'millesimo',
      'Milano',
      'quarantena',
      'centocelle',
      'seicentesco',
      'mila',
      'unmila',
      'duemilazero',
    ]) {
      expect(parseNumberWord(word)).toBeNull();
    }
  });
});

describe('numbersToDigits', () => {
  const cases: Array<[string, string]> = [
    // In cifre da undici in su, in lettere fino a dieci.
    [
      'Nel duemilaventisei abbiamo formato trentacinque enti.',
      'Nel 2026 abbiamo formato 35 enti.',
    ],
    ['Le tre proposte e le dieci regioni.', 'Le tre proposte e le dieci regioni.'],
    ['Sono arrivate venticinquemila domande.', 'Sono arrivate 25.000 domande.'],
    ['Costa centoventi euro.', 'Costa 120 euro.'],
    // Le parti staccate si ricompongono.
    ['Era il duemila ventisei.', 'Era il 2026.'],
    ['Erano due mila persone.', 'Erano 2000 persone.'],
    ['Circa cento venti persone.', 'Circa 120 persone.'],
    ['Pagina venti tre volte.', 'Pagina 20 tre volte.'],
    // Percentuali e decimali sempre in cifre.
    ['Il cinque per cento dei comuni.', 'Il 5% dei comuni.'],
    ['Al cento per cento.', 'Al 100%.'],
    ['Un aumento del tre virgola cinque percento.', 'Un aumento del 3,5%.'],
    ['Vale zero virgola zero due.', 'Vale 0,02.'],
    ['Un per cento.', '1%.'],
    // Giorni del mese e ore sempre in cifre.
    ['Il due ottobre e il ventuno novembre.', 'Il 2 ottobre e il 21 novembre.'],
    ["L'undici settembre.", "L'11 settembre."],
    [
      'Ci vediamo alle dieci e trenta, dalle nove alle tre.',
      'Ci vediamo alle 10:30, dalle 9 alle 3.',
    ],
    ['Alle quindici e mezza.', 'Alle 15 e mezza.'],
    // Il modello a volte scrive già le cifre: l'ora si ricompone lo stesso.
    [
      'Ci vediamo alle 10 e 30. La sessione dura 45 minuti',
      'Ci vediamo alle 10:30. La sessione dura 45 minuti',
    ],
    ['Dalle nove e 5 alle 18 e 45.', 'Dalle 9:05 alle 18:45.'],
    ['Alle 3 e 20 minuti.', 'Alle 3 e 20 minuti.'],
    ['Ore 10 e 30 per cento.', 'Ore 10 e 30%.'],
    ['Alle tre e un quarto.', 'Alle 3 e un quarto.'],
    // Durate e quantità dopo «alle»/«dalle»: non sono ore.
    ['Alle tre e venti minuti.', 'Alle tre e 20 minuti.'],
    ['Alle quindici e trenta minuti.', 'Alle 15 e 30 minuti.'],
    [
      'Grazie alle due relatrici e alle tre colleghe.',
      'Grazie alle due relatrici e alle tre colleghe.',
    ],
    [
      'Dalle tre regioni sono arrivate proposte.',
      'Dalle tre regioni sono arrivate proposte.',
    ],
    [
      'Alle tre del pomeriggio, dalle nove fino a sera.',
      'Alle 3 del pomeriggio, dalle 9 fino a sera.',
    ],
    [
      'Alle cinque meno un quarto, alle sei in punto.',
      'Alle 5 meno un quarto, alle 6 in punto.',
    ],
    // Gli articoli non sono numeri.
    ['È stato un ottobre difficile.', 'È stato un ottobre difficile.'],
    ['Metti una virgola cinque righe sotto.', 'Metti una virgola cinque righe sotto.'],
    // «per cento» dopo una parola che resta in lettere.
    ['Il Trenta per cento.', 'Il Trenta per cento.'],
    ['Alcuni punti per cento.', 'Alcuni punti per cento.'],
    ['Ore dieci e trenta per cento.', 'Ore dieci e 30%.'],
    // Il verbo «è» non è la congiunzione «e».
    ['Il limite di duecento è cinquanta.', 'Il limite di 200 è 50.'],
    ['Su mille è uno solo.', 'Su mille è uno solo.'],
    ['Alle dieci è tardi.', 'Alle dieci è tardi.'],
    // «sono le dieci e trenta».
    ['Sono le dieci e trenta.', 'Sono le 10:30.'],
    ['Sono le 10 e 30.', 'Sono le 10:30.'],
    ['Le tre proposte e le due regioni.', 'Le tre proposte e le due regioni.'],
    // «le» da solo non introduce un'ora: «tra le due e tre settimane».
    ['Tra le due e tre settimane.', 'Tra le due e tre settimane.'],
    ['Tra le quindici e venti persone.', 'Tra le 15 e 20 persone.'],
    [
      'Tra le 5 e 10 persone, oltre le 3 e 4 volte.',
      'Tra le 5 e 10 persone, oltre le 3 e 4 volte.',
    ],
    ['Scegliamo le due.', 'Scegliamo le due.'],
    // Un provvisorio che finisce su «alle tre» non è ancora un'ora.
    ['Grazie alle tre', 'Grazie alle tre'],
    ['Grazie alle tre colleghe', 'Grazie alle tre colleghe'],
    ['Ci vediamo alle tre.', 'Ci vediamo alle 3.'],
    // Limiti dichiarati: leggono parole, non significati.
    ['Alle sei e trenta persone.', 'Alle 6:30 persone.'],
    ['Tra il tre e il cinque per cento.', 'Tra il tre e il 5%.'],
    // Decimali letti cifra per cifra.
    ['Tre virgola uno cinque per cento.', '3,15%.'],
    ['Pi greco è tre virgola uno quattro.', 'Pi greco è 3,14.'],
    ['Vale tre virgola quattordici.', 'Vale 3,14.'],
    // Parti staccate che il modello potrebbe scrivere.
    ['Duecento cinquantamila euro.', '250.000 euro.'],
    ['Nel duemila venti cinque.', 'Nel 2025.'],
    ['Nel mille novecento ottanta quattro.', 'Nel 1984.'],
    ['Trecento quaranta cinque euro.', '345 euro.'],
    ['Il venti sei ottobre.', 'Il 26 ottobre.'],
    // La «e» dentro un numero.
    ['Mille e cinquecento euro.', '1500 euro.'],
    ['Nel duemila e ventisei.', 'Nel 2026.'],
    ['Cento e venti persone.', '120 persone.'],
    // Ciò che resta in lettere.
    ['Mille grazie a tutti.', 'Mille grazie a tutti.'],
    ['Mille cinquecento iscritti.', '1500 iscritti.'],
    ['Ne parla Giulia Trenta.', 'Ne parla Giulia Trenta.'],
    [
      'Venti milioni di euro, due milioni di persone.',
      '20 milioni di euro, due milioni di persone.',
    ],
    ['Il numero è tre tre nove uno.', 'Il numero è tre tre nove uno.'],
    ['Metti una virgola qui.', 'Metti una virgola qui.'],
    ['Le mille e una notte.', 'Le mille e una notte.'],
    ['Sei pronto?', 'Sei pronto?'],
    // A inizio frase la maiuscola non è un nome.
    ['Bene. Diciotto regioni hanno aderito.', 'Bene. 18 regioni hanno aderito.'],
    // Uscite vere del motore su frasi con numeri.
    [
      'Nel duemila ventisei abbiamo coinvolto trentacinque enti e mille duecentocinquanta persone',
      'Nel 2026 abbiamo coinvolto 35 enti e 1250 persone',
    ],
    [
      "Il cinque per cento dei comuni l'ha aderito entro il dodici ottobre.",
      "Il 5% dei comuni l'ha aderito entro il 12 ottobre.",
    ],
    ['Il bilancio è di venticinquemila euro.', 'Il bilancio è di 25.000 euro.'],
    ['', ''],
    ['Nessun numero qui', 'Nessun numero qui'],
  ];
  it.each(cases)('%s', (input, expected) => {
    expect(numbersToDigits(input)).toBe(expected);
  });

  it('lascia intatti spazi e punteggiatura intorno', () => {
    expect(numbersToDigits('  «ventidue»,  sì ')).toBe('  «22»,  sì ');
  });

  it('su un provvisorio che cresce dà sempre un testo coerente', () => {
    expect(numbersToDigits('Nel duemila')).toBe('Nel 2000');
    expect(numbersToDigits('Nel duemilaventi')).toBe('Nel 2020');
    expect(numbersToDigits('Nel duemilaventisei')).toBe('Nel 2026');
  });
});
