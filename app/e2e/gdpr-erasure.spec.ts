import { randomUUID } from 'crypto';

import { test, expect, type APIRequestContext } from '@playwright/test';

import messages from '../src/i18n/messages/it.json';

/**
 * La cancellazione su richiesta (art. 17 GDPR), dall'inizio alla fine: chi si
 * è iscritto chiede la cancellazione dalla pagina dei propri dati, riceve
 * l'email con il link, lo apre e conferma. Dopo, la sua iscrizione non c'è
 * più: con lo stesso indirizzo ci si iscrive di nuovo come una persona nuova.
 *
 * L'email si legge da Mailpit, la casella dello stack locale; la coda delle
 * email si svuota chiamando il lavoro pianificato invece di aspettarlo.
 */

const ADMIN_KEY = process.env.ADMIN_API_KEY || 'dev_admin_key_2026';
const CRON_KEY = process.env.E2E_CRON_API_KEY || 'dev_cron_key_change_in_production';
const MAILPIT = process.env.E2E_MAILPIT_URL || 'http://localhost:8025';
const testi = messages.gdpr.erasure;

test.describe.configure({ mode: 'serial' });

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

async function iscrivi(request: APIRequestContext, slug: string, email: string) {
  return request.post(`/api/events/${slug}/registrations`, {
    data: { displayName: 'Persona da cancellare', email, consentGiven: true },
  });
}

/** Il link dell'ultima email arrivata a `email`, che porta il parametro `t`. */
async function linkDallaCasella(
  request: APIRequestContext,
  email: string
): Promise<string> {
  let link: string | null = null;
  await expect
    .poll(
      async () => {
        // La coda delle email: la svuota il lavoro pianificato.
        await request.get('/api/cron/email-outbox', {
          headers: { 'x-api-key': CRON_KEY },
        });
        const cerca = await request.get(
          `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`
        );
        if (!cerca.ok()) return null;
        const { messages: arrivate } = (await cerca.json()) as {
          messages: Array<{ ID: string; Subject: string }>;
        };
        const richiesta = arrivate.find((m) => m.Subject.includes('Cancellazione'));
        if (!richiesta) return null;
        const corpo = await request.get(`${MAILPIT}/api/v1/message/${richiesta.ID}`);
        const { Text } = (await corpo.json()) as { Text: string };
        link = Text.match(/https?:\/\/\S+[?&]t=[^\s]+/)?.[0] ?? null;
        return link;
      },
      { timeout: 60_000, intervals: [1_000, 2_000, 5_000] }
    )
    .not.toBeNull();
  return link!;
}

test('cancellazione su richiesta: email, conferma, iscrizione sparita', async ({
  page,
  request,
}) => {
  const login = await request.post('/api/admin/login', { data: { key: ADMIN_KEY } });
  expect(login.ok(), `login: ${login.status()}`).toBeTruthy();
  const inizio = Date.now() + 86_400_000;
  const creato = await request.post('/api/events', {
    data: {
      title: { it: `E2E cancellazione ${randomUUID().slice(0, 8)}` },
      description: { it: 'Evento creato dal test della cancellazione su richiesta.' },
      startsAt: new Date(inizio).toISOString(),
      endsAt: new Date(inizio + 3_600_000).toISOString(),
    },
  });
  expect(creato.status(), await creato.text()).toBe(201);
  evento = (await creato.json()) as { id: string; slug: string; moderatorToken: string };
  const pubblicato = await request.put(`/api/events/${evento.id}`, {
    headers: { Authorization: `Bearer ${evento.moderatorToken}` },
    data: { status: 'PUBLISHED' },
  });
  expect(pubblicato.ok()).toBeTruthy();

  const email = `e2e-cancellazione-${randomUUID()}@example.com`;
  expect((await iscrivi(request, evento.slug, email)).status()).toBe(201);
  // Una seconda iscrizione con lo stesso indirizzo è rifiutata: la persona c'è.
  expect((await iscrivi(request, evento.slug, email)).status()).toBe(409);

  // La richiesta, dalla pagina dei propri dati.
  await page.goto('/it/privacy/i-miei-dati/cancellazione');
  await page.getByLabel(testi.emailLabel).fill(email);
  await page.getByRole('button', { name: testi.submit }).click();
  await expect(page.getByText(testi.requestSubmittedTitle)).toBeVisible();

  // Il link dell'email, aperto e confermato.
  const link = await linkDallaCasella(request, email);
  await page.goto(link);
  await page.getByRole('button', { name: testi.confirmButton }).click();
  await expect(page.getByText(testi.doneTitle)).toBeVisible();

  // L'iscrizione non c'è più: lo stesso indirizzo si iscrive di nuovo.
  expect((await iscrivi(request, evento.slug, email)).status()).toBe(201);
});
