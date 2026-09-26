import { describe, it, expect } from 'vitest';

import { repairPercentColors } from './repair-percent-colors';

describe('repairPercentColors', () => {
  it('ripara il valore che rendeva bianca la fascia istituzionale', () => {
    const rotto = '.it-header-slim-wrapper{background:rgb(0,35%,70%);padding:6.5px 18px}';
    const { css, repaired } = repairPercentColors(rotto);
    expect(css).toBe('.it-header-slim-wrapper{background:rgb(0%,35%,70%);padding:6.5px 18px}');
    expect(repaired).toBe(1);
  });

  it('conserva l’alfa, che non soffre del problema', () => {
    expect(repairPercentColors('.a{box-shadow:0 0 0 2px rgba(0,40%,80%,.25)}').css).toBe(
      '.a{box-shadow:0 0 0 2px rgba(0%,40%,80%,.25)}',
    );
  });

  it('ripara più zeri nello stesso colore', () => {
    expect(repairPercentColors('.a{color:rgb(0,0,64%)}').css).toBe('.a{color:rgb(0%,0%,64%)}');
  });

  it('ripara ogni colore di un gradiente e li conta tutti', () => {
    const { css, repaired } = repairPercentColors(
      '.a{background:linear-gradient(rgb(0,35%,70%),rgb(0,15%,30%))}',
    );
    expect(css).toBe('.a{background:linear-gradient(rgb(0%,35%,70%),rgb(0%,15%,30%))}');
    expect(repaired).toBe(2);
  });

  it('non tocca i colori validi', () => {
    for (const valido of [
      '.a{color:rgb(0,82,163)}', // tutti numeri
      '.a{color:rgb(0%,32%,64%)}', // tutte percentuali
      '.a{color:rgba(0,102,204,.25)}',
      '.a{color:#0059b3}',
      '.a{color:hsl(210,100%,35%)}',
    ]) {
      const { css, repaired } = repairPercentColors(valido);
      expect(css).toBe(valido);
      expect(repaired).toBe(0);
    }
  });

  it('non indovina: una forma mista con un numero diverso da zero resta com’è', () => {
    // Non è il danno del minificatore, che tocca solo gli zeri: qui non sappiamo
    // se l'autore intendesse 10 su 255 oppure il 10%.
    const misto = '.a{color:rgb(10,32%,64%)}';
    expect(repairPercentColors(misto)).toEqual({ css: misto, repaired: 0 });
  });

  it('lascia stare i valori con variabili o calcoli dentro', () => {
    for (const dinamico of ['.a{color:rgb(var(--r),35%,70%)}', '.a{color:rgb(calc(0),35%,70%)}']) {
      expect(repairPercentColors(dinamico)).toEqual({ css: dinamico, repaired: 0 });
    }
  });

  it('è idempotente: applicarlo due volte non cambia il risultato', () => {
    const primo = repairPercentColors('.a{color:rgb(0,35%,70%)}');
    const secondo = repairPercentColors(primo.css);
    expect(secondo.css).toBe(primo.css);
    expect(secondo.repaired).toBe(0);
  });

  it('ripara anche le percentuali senza zero iniziale, come le scrive il minificatore', () => {
    // Tinte molto scure: il minificatore accorcia `0.4%` in `.4%`. Se la forma
    // non viene riconosciuta, il colore resta rotto e non viene nemmeno contato.
    const { css, repaired } = repairPercentColors('.a{color:rgb(0,.4%,.8%)}');
    expect(css).toBe('.a{color:rgb(0%,.4%,.8%)}');
    expect(repaired).toBe(1);
  });

  it('riconosce lo zero anche con i decimali e la sintassi moderna', () => {
    expect(repairPercentColors('.a{color:rgb(0.0,35%,70%)}').css).toBe('.a{color:rgb(0%,35%,70%)}');
    expect(repairPercentColors('.a{color:rgb(0 35% 70% / .5)}').css).toBe(
      '.a{color:rgb(0%,35%,70%,.5)}',
    );
  });

  it('su un CSS senza colori rotti non cambia un byte', () => {
    const css = '.a{margin:0;padding:0 2px}.b{color:red}@media(min-width:0){.c{top:0}}';
    expect(repairPercentColors(css)).toEqual({ css, repaired: 0 });
  });
});
