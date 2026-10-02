import { randomUUID } from 'crypto';

import { test, expect, type Page } from '@playwright/test';

/**
 * Il menu «…» delle schede nell'elenco degli eventi, aperto col mouse e da
 * tastiera.
 *
 * Col mouse il puntatore sta sopra la scheda, che al passaggio si solleva con
 * un `transform`: una scheda trasformata diventa il riferimento dell'elenco
 * `position: fixed`, che finiva fuori dallo schermo. Si prova la scheda piu' in
 * basso a destra fra quelle visibili, dove l'elenco ha meno spazio, alla
 * risoluzione di un portatile e a quella di un telefono.
 */

const ADMIN_KEY = process.env.ADMIN_API_KEY || 'dev_admin_key_2026';
const DUPLICA = 'Duplica come prossima occorrenza';

// Un solo accesso per file: il login dell'amministrazione ha un limite di
// tentativi, e ogni prova ne chiederebbe uno.
test.describe.configure({ mode: 'serial' });
let sessione: Awaited<ReturnType<ReturnType<Page['context']>['cookies']>> | null = null;

async function accedi(page: Page) {
  if (sessione) {
    await page.context().addCookies(sessione);
    return;
  }
  const login = await page.request.post('/api/admin/login', { data: { key: ADMIN_KEY } });
  expect(login.ok(), `login: ${login.status()}`).toBeTruthy();
  sessione = await page.context().cookies();
}

// Un solo evento per file, per lo stesso motivo: anche la creazione ha un
// limite. Basta che l'elenco non sia vuoto.
let evento: { id: string; moderatorToken: string } | null = null;

test.afterAll(async ({ playwright }) => {
  if (!evento) return;
  const api = await playwright.request.newContext({
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
  });
  await api.delete(`/api/events/${evento.id}`, {
    headers: { Authorization: `Bearer ${evento.moderatorToken}` },
  });
  await api.dispose();
  evento = null;
});

async function preparaElenco(page: Page) {
  await accedi(page);
  if (!evento) {
    const inizio = Date.now() + 86_400_000;
    const creato = await page.request.post('/api/events', {
      data: {
        title: { it: `E2E menu scheda ${randomUUID().slice(0, 8)}` },
        description: { it: 'Evento creato dal test del menu delle schede.' },
        startsAt: new Date(inizio).toISOString(),
        endsAt: new Date(inizio + 3_600_000).toISOString(),
      },
    });
    expect(creato.status(), await creato.text()).toBe(201);
    evento = (await creato.json()) as { id: string; moderatorToken: string };
  }
  await page.goto('/it/admin/eventi');
  await page.locator('.event-card').first().waitFor();
  await ferma(page);
}

/**
 * Aspetta che la pagina smetta di scorrere: l'elenco si chiude a ogni
 * scorrimento, come i menu del sistema, e all'apertura il tema scorre in modo
 * animato fino al punto giusto.
 */
async function ferma(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const fine = () => {
          removeEventListener('scroll', ancora, true);
          resolve();
        };
        let attesa = setTimeout(fine, 400);
        function ancora() {
          clearTimeout(attesa);
          attesa = setTimeout(fine, 400);
        }
        addEventListener('scroll', ancora, true);
      }),
  );
}

/**
 * Apre il menu con un gesto solo, a pagina idratata: prima il pulsante non
 * risponde, e un secondo gesto di riserva potrebbe sommarsi al primo che React
 * ripete dopo l'idratazione, richiudendo l'elenco.
 */
async function apri(page: Page, pulsante: ReturnType<Page['locator']>, gesto: () => Promise<void>) {
  await pulsante.scrollIntoViewIfNeeded();
  await expect
    .poll(() => pulsante.evaluate((el) => Object.keys(el).some((k) => k.startsWith('__reactProps'))), {
      timeout: 30_000,
    })
    .toBe(true);
  await ferma(page);
  await gesto();
  await expect(pulsante).toHaveAttribute('aria-expanded', 'true');
}

/** La scheda visibile piu' in basso, e fra quelle la piu' a destra. */
async function schedaInBassoADestra(page: Page) {
  const schede = page.locator('.event-card');
  const vista = page.viewportSize()!;
  let scelta = 0;
  let migliore = { bottom: -1, right: -1 };
  for (let i = 0; i < (await schede.count()); i++) {
    const b = await schede.nth(i).boundingBox();
    if (!b || b.y < 0 || b.y + b.height > vista.height) continue;
    const bottom = Math.round(b.y + b.height);
    const right = Math.round(b.x + b.width);
    if (bottom > migliore.bottom || (bottom === migliore.bottom && right > migliore.right)) {
      migliore = { bottom, right };
      scelta = i;
    }
  }
  return schede.nth(scelta);
}

for (const vista of [
  { nome: 'portatile', width: 1280, height: 800 },
  { nome: 'telefono', width: 390, height: 844 },
]) {
  test.describe(`menu «…» della scheda evento (${vista.nome})`, () => {
    test.use({ viewport: { width: vista.width, height: vista.height } });

    test('aperto col mouse, l\'elenco e\' tutto nella finestra e le voci si cliccano', async ({ page }) => {
      await preparaElenco(page);
      const scheda = await schedaInBassoADestra(page);
      await scheda.hover();
      const pulsante = scheda.locator('.event-card-menu__toggle');
      await apri(page, pulsante, () => pulsante.click());

      const elenco = page.locator(`[id="${await pulsante.getAttribute('aria-controls')}"]`);
      await expect(elenco).toBeVisible();
      const b = (await elenco.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(vista.width);
      expect(b.y + b.height).toBeLessThanOrEqual(vista.height);

      // Al centro della voce c'e' la voce stessa, non la scheda o un'altra.
      const voce = elenco.getByRole('button', { name: DUPLICA });
      const v = (await voce.boundingBox())!;
      const colpita = await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.textContent?.trim() ?? null,
        { x: v.x + v.width / 2, y: v.y + v.height / 2 },
      );
      expect(colpita).toBe(DUPLICA);
    });

    test('da tastiera: Tab porta alla prima voce, Esc chiude e torna al pulsante', async ({ page }) => {
      await preparaElenco(page);
      const pulsante = page.locator('.event-card-menu__toggle').first();
      await apri(page, pulsante, async () => {
        await pulsante.focus();
        await page.keyboard.press('Enter');
      });
      const elenco = page.locator(`[id="${await pulsante.getAttribute('aria-controls')}"]`);
      await expect(elenco).toBeVisible();

      await page.keyboard.press('Tab');
      const primaVoce = elenco.locator('a, button').first();
      await expect(primaVoce).toBeFocused();

      await page.keyboard.press('Escape');
      await expect(elenco).toBeHidden();
      await expect(pulsante).toBeFocused();
    });
  });
}
