import { randomUUID } from 'crypto';

import { test, expect, type Page } from '@playwright/test';

/**
 * La pagina di un evento nell'area di amministrazione, da telefono e da
 * tastiera: su telefono le azioni dello stato vengono prima delle schede e il
 * riepilogo dopo; le frecce spostano il fuoco fra le schede, Invio apre
 * quella scelta, che controlla il pannello e resta nell'indirizzo anche dopo
 * un ricaricamento.
 */

const ADMIN_KEY = process.env.ADMIN_API_KEY || 'dev_admin_key_2026';

// Un solo accesso e un solo evento per file: login e creazione hanno un limite.
test.describe.configure({ mode: 'serial' });
let sessione: Awaited<ReturnType<ReturnType<Page['context']>['cookies']>> | null = null;
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

async function apriEvento(page: Page, query = '') {
  if (sessione) {
    await page.context().addCookies(sessione);
  } else {
    const login = await page.request.post('/api/admin/login', { data: { key: ADMIN_KEY } });
    expect(login.ok(), `login: ${login.status()}`).toBeTruthy();
    sessione = await page.context().cookies();
  }
  if (!evento) {
    const inizio = Date.now() + 86_400_000;
    const creato = await page.request.post('/api/events', {
      data: {
        title: { it: `E2E pagina evento ${randomUUID().slice(0, 8)}` },
        description: { it: 'Evento creato dal test della pagina di gestione.' },
        startsAt: new Date(inizio).toISOString(),
        endsAt: new Date(inizio + 3_600_000).toISOString(),
      },
    });
    expect(creato.status(), await creato.text()).toBe(201);
    evento = (await creato.json()) as { id: string; moderatorToken: string };
  }
  await page.goto(`/it/admin/eventi/${evento.id}${query}`);
  const schede = page.getByRole('tablist');
  await schede.waitFor();
  // A pagina idratata: prima le schede non rispondono ai tasti.
  await expect
    .poll(() => schede.evaluate((el) => Object.keys(el).some((k) => k.startsWith('__react'))), { timeout: 30_000 })
    .toBe(true);
  return schede;
}

test.describe('pagina dell\'evento (telefono)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('prima le azioni, poi le schede, in fondo il riepilogo', async ({ page }) => {
    const schede = await apriEvento(page);
    const y = async (selettore: string) => (await page.locator(selettore).boundingBox())!.y;
    const azioni = await y('.event-manage__actions');
    const tab = (await schede.boundingBox())!.y;
    const riepilogo = await y('.event-manage__summary');
    expect(azioni).toBeLessThan(tab);
    expect(tab).toBeLessThan(riepilogo);
    // Niente scorrimento orizzontale della pagina.
    const larghezza = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(larghezza).toBeLessThanOrEqual(390);
  });
});

test.describe('pagina dell\'evento (portatile)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('azioni e riepilogo a destra delle schede', async ({ page }) => {
    const schede = await apriEvento(page);
    const x = (await schede.boundingBox())!.x;
    expect((await page.locator('.event-manage__actions').boundingBox())!.x).toBeGreaterThan(x + 400);
    expect((await page.locator('.event-manage__summary').boundingBox())!.x).toBeGreaterThan(x + 400);
  });

  test('le frecce spostano il fuoco, Invio apre la scheda, che resta nell\'indirizzo', async ({ page }) => {
    const schede = await apriEvento(page);
    const attiva = schede.getByRole('tab', { selected: true });
    await expect(attiva).toHaveText(/Panoramica/);
    await attiva.focus();

    // La freccia sposta solo il fuoco: la scheda aperta resta quella.
    await page.keyboard.press('ArrowRight');
    const persone = schede.getByRole('tab', { name: /Persone/ });
    await expect(persone).toBeFocused();
    await expect(persone).toHaveAttribute('aria-selected', 'false');

    await page.keyboard.press('Enter');
    await expect(persone).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/[?&]tab=persone/);
    const pannello = page.getByRole('tabpanel');
    await expect(pannello).toHaveAttribute('aria-labelledby', (await persone.getAttribute('id'))!);
    await expect(persone).toHaveAttribute('aria-controls', (await pannello.getAttribute('id'))!);

    // Fine, poi la freccia torna all'inizio.
    await page.keyboard.press('End');
    await expect(schede.getByRole('tab', { name: /Statistiche/ })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(schede.getByRole('tab', { name: /Panoramica/ })).toBeFocused();

    // Una sola scheda nella sequenza del Tab: quella aperta.
    await expect(schede.locator('[role="tab"][tabindex="0"]')).toHaveText(/Persone/);

    // Ricaricando si riapre la scheda scelta.
    await page.reload();
    await expect(page.getByRole('tablist').getByRole('tab', { selected: true })).toHaveText(/Persone/);
  });

  test('l\'indirizzo con ?tab= riapre quella scheda', async ({ page }) => {
    const schede = await apriEvento(page, '?tab=contenuti');
    await expect(schede.getByRole('tab', { selected: true })).toHaveText(/Contenuti/);
  });
});
