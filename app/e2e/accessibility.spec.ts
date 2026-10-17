import { randomUUID } from 'crypto';

import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';

/**
 * Controllo automatico di accessibilità sulle pagine del portale: le regole
 * di axe-core per WCAG 2.1 livello A e AA, il livello che EN 301 549 e le
 * regole italiane richiedono. Copre ciò che uno strumento automatico sa
 * vedere (contrasti, nomi accessibili, struttura, attributi ARIA), non la
 * valutazione completa: tastiera, ordine di lettura e senso dei testi restano
 * da provare a mano.
 *
 * La conferenza Jitsi è esclusa: è un'applicazione di terze parti in una
 * cornice a sé, fuori dal codice del portale.
 */

const ADMIN_KEY = process.env.ADMIN_API_KEY || 'dev_admin_key_2026';
const WCAG_21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// Un solo accesso e un solo evento per file: login e creazione hanno un limite.
test.describe.configure({ mode: 'serial' });
let sessione: Awaited<ReturnType<ReturnType<Page['context']>['cookies']>> | null = null;
let evento: {
  id: string;
  slug: string;
  moderatorToken: string;
  accessToken: string;
} | null = null;

test.afterAll(async ({ playwright }) => {
  if (!evento) return;
  const api = await playwright.request.newContext({
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
  });
  const headers = { Authorization: `Bearer ${evento.moderatorToken}` };
  // L'ultimo controllo porta l'evento in diretta: va chiuso prima di eliminarlo.
  // La cancellazione si tenta comunque, e un suo errore fa fallire il test.
  try {
    await api.put(`/api/events/${evento.id}`, { headers, data: { status: 'ENDED' } });
  } finally {
    const res = await api.delete(`/api/events/${evento.id}`, { headers });
    await api.dispose();
    evento = null;
    expect(res.ok(), `eliminazione: ${res.status()}`).toBeTruthy();
  }
});

async function accedi(page: Page) {
  if (sessione) {
    await page.context().addCookies(sessione);
    return;
  }
  const login = await page.request.post('/api/admin/login', { data: { key: ADMIN_KEY } });
  expect(login.ok(), `login: ${login.status()}`).toBeTruthy();
  sessione = await page.context().cookies();
}

/** Un evento pubblicato fra un giorno, con un iscritto: pagina pubblica, iscrizione e sala d'attesa. */
async function preparaEvento(page: Page) {
  if (evento) return evento;
  await accedi(page);
  const inizio = Date.now() + 86_400_000;
  const creato = await page.request.post('/api/events', {
    data: {
      title: { it: `E2E accessibilità ${randomUUID().slice(0, 8)}` },
      description: { it: 'Evento creato dal controllo automatico di accessibilità.' },
      startsAt: new Date(inizio).toISOString(),
      endsAt: new Date(inizio + 3_600_000).toISOString(),
    },
  });
  expect(creato.status(), await creato.text()).toBe(201);
  const { id, slug, moderatorToken } = (await creato.json()) as {
    id: string;
    slug: string;
    moderatorToken: string;
  };
  const pubblicato = await page.request.put(`/api/events/${id}`, {
    headers: { Authorization: `Bearer ${moderatorToken}` },
    data: { status: 'PUBLISHED' },
  });
  expect(pubblicato.ok(), `pubblicazione: ${pubblicato.status()}`).toBeTruthy();
  const iscritto = await page.request.post(`/api/events/${slug}/registrations`, {
    data: {
      displayName: 'Persona di prova',
      email: `e2e-a11y-${randomUUID()}@example.com`,
      consentGiven: true,
    },
  });
  expect(iscritto.status(), await iscritto.text()).toBe(201);
  const { accessToken } = (await iscritto.json()) as { accessToken: string };
  evento = { id, slug, moderatorToken, accessToken };
  return evento;
}

/** Le violazioni della pagina com'è adesso, con un'etichetta che dice dove. */
async function analizza(page: Page, dove: string) {
  const risultato = await new AxeBuilder({ page })
    .withTags(WCAG_21_AA)
    .exclude('iframe')
    .analyze();
  const violazioni = risultato.violations.map((v) => ({
    regola: v.id,
    impatto: v.impact,
    elementi: v.nodes.length,
    esempi: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
  }));
  expect.soft(violazioni, `${dove}\n${JSON.stringify(violazioni, null, 2)}`).toEqual([]);
}

async function controlla(page: Page, percorso: string) {
  await page.goto(percorso);
  await page.waitForLoadState('networkidle');
  await analizza(page, percorso);
}

test('pagine pubbliche', async ({ page }) => {
  const { slug } = await preparaEvento(page);
  // Le pagine pubbliche si guardano da visitatore, senza la sessione dello staff.
  await page.context().clearCookies();
  for (const percorso of [
    '/it',
    '/it/eventi',
    `/it/eventi/${slug}`,
    `/it/eventi/${slug}/registrazione`,
    '/it/calendario',
    '/it/video-library',
    '/it/accessibilita',
    '/it/note-legali',
    '/it/privacy',
    '/it/privacy/i-miei-dati',
    '/it/sicurezza',
    '/it/status',
    '/it/service-inventory',
    '/it/changelog',
    '/it/admin/login',
  ]) {
    await controlla(page, percorso);
  }
});

test("sala d'attesa", async ({ page }) => {
  const { slug, accessToken } = await preparaEvento(page);
  await page.context().clearCookies();
  await controlla(page, `/it/eventi/${slug}/live?token=${accessToken}`);
});

test('area di amministrazione', async ({ page }) => {
  const { id } = await preparaEvento(page);
  await accedi(page);
  for (const percorso of [
    '/it/admin',
    '/it/admin/eventi',
    '/it/admin/eventi/nuovo',
    `/it/admin/eventi/${id}`,
    `/it/admin/eventi/${id}/modifica`,
    '/it/admin/iscrizioni',
    '/it/admin/registrazioni-video',
    '/it/admin/post-produzione',
    '/it/admin/questionari',
    '/it/admin/rubrica',
    '/it/admin/calendario',
    '/it/admin/impostazioni',
  ]) {
    await controlla(page, percorso);
  }
});

// Per ultimo: porta l'evento in diretta. La sala con la colonna laterale, una
// scheda alla volta; la conferenza resta esclusa.
test('sala in diretta', async ({ page }) => {
  // Due ingressi in sala e un controllo per ogni scheda della colonna.
  test.setTimeout(240_000);
  const { id, slug, moderatorToken, accessToken } = await preparaEvento(page);
  const live = await page.request.put(`/api/events/${id}`, {
    headers: { Authorization: `Bearer ${moderatorToken}` },
    data: { status: 'LIVE' },
  });
  expect(live.ok(), `diretta: ${live.status()}`).toBeTruthy();
  await page.context().clearCookies();
  for (const [chi, token] of [
    ['moderatore', moderatorToken],
    ['partecipante', accessToken],
  ] as const) {
    await page.goto(`/it/eventi/${slug}/live?token=${token}`);
    // Il link del moderatore principale non porta un nome: lo chiede la sala d'attesa.
    const entra = page.getByRole('button', { name: /entra ora/i });
    await expect(entra).toBeVisible({ timeout: 15_000 });
    const nome = page.getByRole('textbox', { name: /il tuo nome/i });
    if (await nome.isVisible()) await nome.fill(`Persona ${chi}`);
    await entra.click();
    // Sul telefono le schede sono i pulsanti della barra in basso, che aprono
    // il cassetto.
    const schede = test.info().project.name.startsWith('mobile')
      ? page.locator('.live-floating-btn')
      : page.getByRole('tablist').getByRole('tab');
    await expect(schede.first()).toBeVisible({ timeout: 20_000 });
    for (let i = 0; i < (await schede.count()); i++) {
      await schede.nth(i).click();
      await page.waitForTimeout(500);
      const scheda = (await schede.nth(i).innerText()).trim() || String(i);
      await analizza(page, `sala, ${chi}, scheda ${scheda}`);
    }
  }
});
