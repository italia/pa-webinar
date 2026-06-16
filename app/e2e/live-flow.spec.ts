import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'crypto';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
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

  test('moderator reaches waiting room with join CTA', async ({ page }) => {
    await page.goto(`/it/eventi/${slug}/live?token=${moderatorToken}`);

    // Since the waiting-room refactor (ADR-012 fase 0), every role lands on
    // the unified waiting room first. For a LIVE event the primary CTA is
    // `joinNowBtn` ("Entra ora") rendered by waiting-room.tsx.
    const joinBtn = page.getByRole('button', { name: /entra ora/i });
    await expect(joinBtn).toBeVisible({ timeout: 15_000 });
  });

  test('participant reaches waiting room with join CTA', async ({ page }) => {
    await page.goto(`/it/eventi/${slug}/live?token=${accessToken}`);

    const joinBtn = page.getByRole('button', { name: /entra ora/i });
    await expect(joinBtn).toBeVisible({ timeout: 15_000 });
  });

  test('waiting room shows event title', async ({ page }) => {
    await page.goto(`/it/eventi/${slug}/live?token=${accessToken}`);

    // The waiting room renders the event title via EventTitle as="h1".
    const heading = page.locator('h1').first();
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

// One-step access (asse 1): signing up drops the user straight into the
// waiting room (no email round-trip, no manual "Enter room" click), and a
// duplicate sign-up gets the correct message + a resend affordance instead
// of the old generic error (the dead 409 branch).
test.describe('Registration → waiting room (one-step access)', () => {
  test.describe.configure({ mode: 'serial' });

  let cookie: string;
  let eventId: string;
  let slug: string;
  let moderatorToken: string;
  const email = `e2e-onestep-${randomUUID()}@example.com`;

  test.beforeAll(async ({ request }) => {
    cookie = await adminLogin(request);
    const event = await createEvent(request, cookie);
    eventId = event.id;
    slug = event.slug;
    moderatorToken = event.moderatorToken;
    // PUBLISHED (not LIVE): the user still lands in the waiting room, just
    // with the "opens at" CTA — the point is that they get there in one step.
    await setEventStatus(request, eventId, moderatorToken, 'PUBLISHED');
  });

  test.afterAll(async ({ request }) => {
    if (eventId) {
      await request.delete(`${BASE}/api/events/${eventId}`, {
        headers: { Authorization: `Bearer ${moderatorToken}` },
      });
    }
  });

  test('sign-up auto-redirects into the waiting room', async ({ page }) => {
    await page.goto(`/it/eventi/${slug}/registrazione`);
    await page.locator('#displayName').fill('Auto Redirect E2E');
    await page.locator('#email').fill(email);
    // Bootstrap Italia styles the checkbox so the <label> intercepts the
    // click — toggle it the way a user does, via the label.
    await page.locator('label[for="consentGiven"]').click();
    await page.getByRole('button', { name: /conferma registrazione/i }).click();

    // The success screen issues a client redirect (~1.2s) straight to /live
    // with the personal token — no manual "Entra nella sala" click.
    await page.waitForURL(/\/eventi\/.+\/live\?token=/, { timeout: 15_000 });
    await expect(page.locator('h1').first()).toContainText('E2E Smoke', {
      timeout: 15_000,
    });
  });

  test('duplicate sign-up shows the right message + resend link', async ({ page }) => {
    await page.goto(`/it/eventi/${slug}/registrazione`);
    await page.locator('#displayName').fill('Auto Redirect E2E');
    await page.locator('#email').fill(email); // same email as the first test
    // Bootstrap Italia styles the checkbox so the <label> intercepts the
    // click — toggle it the way a user does, via the label.
    await page.locator('label[for="consentGiven"]').click();
    await page.getByRole('button', { name: /conferma registrazione/i }).click();

    // Previously this fell through to errors.generic (the client matched a
    // `already_registered` error string the API never sent). Now it shows
    // the dedicated message and offers to re-send the access link.
    await expect(page.getByText(/sei già registrato/i)).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByRole('button', { name: /invia di nuovo il link/i }),
    ).toBeVisible();
  });

  test('returning to /live without the token re-uses the event cookie', async ({ page }) => {
    const cookieEmail = `e2e-cookie-${randomUUID()}@example.com`;
    await page.goto(`/it/eventi/${slug}/registrazione`);
    await page.locator('#displayName').fill('Cookie Tester');
    await page.locator('#email').fill(cookieEmail);
    await page.locator('label[for="consentGiven"]').click();
    await page.getByRole('button', { name: /conferma registrazione/i }).click();
    await page.waitForURL(/\/eventi\/.+\/live\?token=/, { timeout: 15_000 });

    // Navigate to /live WITHOUT the token. The signed per-event cookie set at
    // registration must keep us in the waiting room instead of bouncing to
    // /registration (the post-mortem loop).
    await page.goto(`/it/eventi/${slug}/live`);
    await expect(page).not.toHaveURL(/registrazione/, { timeout: 10_000 });
    await expect(page.locator('h1').first()).toContainText('E2E Smoke', {
      timeout: 15_000,
    });
  });
});
