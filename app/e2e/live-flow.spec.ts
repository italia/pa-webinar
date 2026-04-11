import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'crypto';

const BASE = 'http://localhost:3000';
const ADMIN_KEY = process.env.ADMIN_API_KEY || 'dev_admin_key_2026';

async function adminLogin(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${BASE}/api/admin/login`, {
    data: { key: ADMIN_KEY },
  });
  expect(res.ok(), `Admin login failed: ${res.status()}`).toBeTruthy();

  const setCookie = res.headers()['set-cookie'] ?? '';
  const match = setCookie.match(/admin_session=([^;]+)/);
  expect(match).toBeTruthy();
  return `admin_session=${match![1]}`;
}

async function createEvent(request: APIRequestContext, cookie: string) {
  const startsAt = new Date(Date.now() + 3600_000).toISOString();
  const endsAt = new Date(Date.now() + 7200_000).toISOString();
  const uid = randomUUID().slice(0, 8);

  const res = await request.post(`${BASE}/api/events`, {
    headers: { Cookie: cookie },
    data: {
      title: { it: `E2E Smoke ${uid}` },
      description: { it: 'Evento creato automaticamente dal test E2E Playwright.' },
      startsAt,
      endsAt,
    },
  });
  expect(res.status(), `Create event failed: ${await res.text()}`).toBe(201);
  return res.json() as Promise<{
    id: string;
    slug: string;
    moderatorToken: string;
  }>;
}

async function setEventStatus(
  request: APIRequestContext,
  eventId: string,
  moderatorToken: string,
  status: string,
) {
  const res = await request.put(`${BASE}/api/events/${eventId}`, {
    headers: { Authorization: `Bearer ${moderatorToken}` },
    data: { status },
  });
  expect(res.ok(), `Set status ${status} failed: ${res.status()}`).toBeTruthy();
}

async function registerParticipant(request: APIRequestContext, slug: string) {
  const res = await request.post(
    `${BASE}/api/events/${slug}/registrations`,
    {
      data: {
        displayName: 'Partecipante E2E',
        email: `e2e-${randomUUID()}@example.com`,
        consentGiven: true,
      },
    },
  );
  expect(res.status(), `Registration failed: ${await res.text()}`).toBe(201);
  return res.json() as Promise<{ accessToken: string }>;
}

// Serial: all tests share one beforeAll (1 event creation per project)
test.describe('Live event flow (smoke)', () => {
  test.describe.configure({ mode: 'serial' });

  let cookie: string;
  let eventId: string;
  let slug: string;
  let moderatorToken: string;
  let accessToken: string;

  test.beforeAll(async ({ request }) => {
    cookie = await adminLogin(request);
    const event = await createEvent(request, cookie);
    eventId = event.id;
    slug = event.slug;
    moderatorToken = event.moderatorToken;

    await setEventStatus(request, eventId, moderatorToken, 'PUBLISHED');

    const reg = await registerParticipant(request, slug);
    accessToken = reg.accessToken;

    await setEventStatus(request, eventId, moderatorToken, 'LIVE');
  });

  test.afterAll(async ({ request }) => {
    if (eventId) {
      await request.delete(`${BASE}/api/events/${eventId}`, {
        headers: { Authorization: `Bearer ${moderatorToken}` },
      });
    }
  });

  test('moderator reaches pre-join screen', async ({ page }) => {
    await page.goto(`/it/eventi/${slug}/live?token=${moderatorToken}`);

    const preJoinBtn = page.getByRole('button', { name: /entra nella sala/i });
    await expect(preJoinBtn).toBeVisible({ timeout: 15_000 });
  });

  test('participant reaches pre-join screen', async ({ page }) => {
    await page.goto(`/it/eventi/${slug}/live?token=${accessToken}`);

    const preJoinBtn = page.getByRole('button', { name: /entra nella sala/i });
    await expect(preJoinBtn).toBeVisible({ timeout: 15_000 });
  });

  test('pre-join screen shows event title', async ({ page }) => {
    await page.goto(`/it/eventi/${slug}/live?token=${accessToken}`);

    const heading = page.locator('h1');
    await expect(heading).toBeVisible({ timeout: 15_000 });
    await expect(heading).toContainText('E2E Smoke');
  });

  test('guest without token on LIVE event sees guest join form', async ({ page }) => {
    await page.goto(`/it/eventi/${slug}/live`);

    await expect(
      page.getByRole('textbox', { name: /il tuo nome/i }),
    ).toBeVisible({ timeout: 15_000 });
  });
});
