import { randomUUID } from 'crypto';

import { test, expect, type Locator, type Page } from '@playwright/test';

import messages from '../src/i18n/messages/it.json';

/**
 * Le pagine pubbliche usate solo da tastiera: il salto al contenuto, il
 * selettore della lingua, l'iscrizione dall'inizio alla fine senza mouse, e
 * il fuoco visibile su ciò che lo riceve. Integra il controllo automatico di
 * accessibilità, che la tastiera non la prova.
 */

const ADMIN_KEY = process.env.ADMIN_API_KEY || 'dev_admin_key_2026';

test.describe.configure({ mode: 'serial' });
// Su telefono la tastiera fisica non è il modo d'uso: qui si prova il desktop.
test.skip(({ isMobile }) => isMobile, 'navigazione da tastiera sul desktop');

let evento: { id: string; slug: string; moderatorToken: string } | null = null;

test.afterAll(async ({ playwright }) => {
  if (!evento) return;
  const api = await playwright.request.newContext({
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
  });
  const res = await api.delete(`/api/events/${evento.id}`, {
    headers: { Authorization: `Bearer ${evento.moderatorToken}` },
  });
  await api.dispose();
  evento = null;
  expect(res.ok(), `eliminazione: ${res.status()}`).toBeTruthy();
});

/** Tab finché `bersaglio` ha il fuoco; fallisce se non ci arriva. */
async function tabFino(page: Page, bersaglio: Locator, massimo = 60) {
  for (let i = 0; i < massimo; i++) {
    if (await bersaglio.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(bersaglio, 'non raggiungibile con Tab').toBeFocused();
}

/** Il fuoco si vede: un contorno o un'ombra sull'elemento che lo ha. */
async function fuocoVisibile(el: Locator) {
  const stile = await el.evaluate((n) => {
    const s = getComputedStyle(n);
    return { outline: s.outlineStyle, larghezza: s.outlineWidth, ombra: s.boxShadow };
  });
  const contorno = stile.outline !== 'none' && stile.larghezza !== '0px';
  expect(contorno || stile.ombra !== 'none', JSON.stringify(stile)).toBe(true);
}

test('il primo Tab porta al salto al contenuto, e Invio ci arriva', async ({ page }) => {
  await page.goto('/it');
  await page.keyboard.press('Tab');
  const salto = page.getByRole('link', { name: messages.nav.skipToContent });
  await expect(salto).toBeFocused();
  await fuocoVisibile(salto);
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
});

test('il selettore della lingua si apre e si chiude da tastiera', async ({ page }) => {
  await page.goto('/it');
  // Il menu della lingua dello slim header: un pulsante con la lingua attiva.
  const scelta = page.getByRole('button', { name: /^Lingua attiva/ });
  // Con una sola lingua attiva il selettore non c'e'.
  test.skip(!(await scelta.isVisible()), 'una sola lingua attiva: nessun selettore');
  await tabFino(page, scelta);
  await page.keyboard.press('Enter');
  await expect(scelta).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(scelta).toHaveAttribute('aria-expanded', 'false');
  // Il fuoco torna sul pulsante, non si perde su un elenco sparito.
  await expect(scelta).toBeFocused();
});

test('ci si iscrive a un evento senza usare il mouse', async ({ page }) => {
  const login = await page.request.post('/api/admin/login', { data: { key: ADMIN_KEY } });
  expect(login.ok(), `login: ${login.status()}`).toBeTruthy();
  const inizio = Date.now() + 86_400_000;
  const creato = await page.request.post('/api/events', {
    data: {
      title: { it: `E2E tastiera ${randomUUID().slice(0, 8)}` },
      description: { it: 'Evento creato dal test della navigazione da tastiera.' },
      startsAt: new Date(inizio).toISOString(),
      endsAt: new Date(inizio + 3_600_000).toISOString(),
    },
  });
  expect(creato.status(), await creato.text()).toBe(201);
  evento = (await creato.json()) as { id: string; slug: string; moderatorToken: string };
  const pubblicato = await page.request.put(`/api/events/${evento.id}`, {
    headers: { Authorization: `Bearer ${evento.moderatorToken}` },
    data: { status: 'PUBLISHED' },
  });
  expect(pubblicato.ok()).toBeTruthy();
  // L'iscrizione si fa da visitatore, senza la sessione dello staff.
  await page.context().clearCookies();

  await page.goto(`/it/eventi/${evento.slug}/registrazione`);
  const nome = page.locator('#displayName');
  // Il modulo arriva dopo l'intestazione: si comincia quando c'e'.
  await expect(nome).toBeVisible();
  await tabFino(page, nome);
  await fuocoVisibile(nome);
  await page.keyboard.type('Persona da tastiera');
  await tabFino(page, page.locator('#email'));
  await page.keyboard.type(`e2e-tastiera-${randomUUID()}@example.com`);
  const consenso = page.locator('#consentGiven');
  await tabFino(page, consenso);
  await page.keyboard.press('Space');
  await expect(consenso).toBeChecked();
  const invia = page.getByRole('button', { name: messages.registration.submit });
  await tabFino(page, invia);
  await fuocoVisibile(invia);
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: messages.registration.success })
  ).toBeVisible();
});
