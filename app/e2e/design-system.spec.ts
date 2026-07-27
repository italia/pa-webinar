import { test, expect } from '@playwright/test';

/**
 * Guardia contro un difetto già arrivato in produzione: il minificatore CSS
 * rende invalide le dichiarazioni di colore con un canale a zero, il browser le
 * scarta e la fascia istituzionale in cima al sito si vede bianca (vedi
 * src/lib/css/repair-percent-colors.ts).
 *
 * Il test unitario copre la riparazione. Questo copre l'altra metà, che un test
 * unitario non può vedere: che la riparazione sia ancora AGGANCIATA al build —
 * cambiare il compilatore (per esempio passare a turbopack) la staccherebbe in
 * silenzio, e il difetto tornerebbe visibile solo a occhio.
 *
 * Si legge lo stile calcolato senza pretendere la visibilità: su schermo piccolo
 * la fascia è nascosta, ma il colore calcolato resta ed è quello che conta.
 */
const TRASPARENTE = /^(transparent|rgba\(0,\s*0,\s*0,\s*0\))$/;

test('la fascia istituzionale ha uno sfondo pieno', async ({ page }) => {
  await page.goto('/it');

  // Il difetto esiste solo nel CSS minificato, cioè in una build di
  // produzione. In sviluppo il foglio di stile non passa dal minificatore e
  // questa prova passerebbe comunque, anche con la riparazione staccata: in
  // quel caso si salta dichiarandolo, invece di dare una conferma che non vale.
  const href = await page.locator('link[rel="stylesheet"]').first().getAttribute('href');
  const foglio = href ? await (await page.request.get(href)).text() : '';
  const minificato = foglio.length > 0 && !/\n\s{2}/.test(foglio);
  test.skip(
    !minificato,
    'foglio di stile non minificato (build di sviluppo): qui il difetto non può manifestarsi',
  );

  const fascia = page.locator('.it-header-slim-wrapper').first();
  await fascia.waitFor({ state: 'attached' });

  const sfondo = await fascia.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(
    sfondo,
    'sfondo trasparente: la dichiarazione di colore è stata scartata dal browser perché invalida nel CSS servito',
  ).not.toMatch(TRASPARENTE);
});
