import { randomUUID } from 'crypto';

import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * Le funzioni di chi partecipa, provate sull'applicazione in esecuzione
 * attraverso le stesse rotte che usa la sala: domande e risposte, sondaggi,
 * il calendario dell'evento e le lingue. Non entrano nella conferenza: la
 * parte di Jitsi resta fuori, la logica del portale no.
 */

const ADMIN_KEY = process.env.ADMIN_API_KEY || 'dev_admin_key_2026';

// Un solo accesso e un solo evento per file: login e creazione hanno un limite.
test.describe.configure({ mode: 'serial' });

let evento: {
  id: string;
  slug: string;
  titolo: string;
  moderatorToken: string;
  iscritti: string[];
} | null = null;

async function preparaEvento(request: APIRequestContext) {
  if (evento) return evento;
  const login = await request.post('/api/admin/login', { data: { key: ADMIN_KEY } });
  expect(login.ok(), `login: ${login.status()}`).toBeTruthy();
  const titolo = `E2E partecipazione ${randomUUID().slice(0, 8)}`;
  const inizio = Date.now() + 3_600_000;
  const creato = await request.post('/api/events', {
    data: {
      title: { it: titolo, en: `${titolo} (en)` },
      description: { it: 'Evento creato dal test delle funzioni di chi partecipa.' },
      startsAt: new Date(inizio).toISOString(),
      endsAt: new Date(inizio + 3_600_000).toISOString(),
      qaEnabled: true,
      pollsEnabled: true,
      moderatorName: 'Persona Che Conduce',
    },
  });
  expect(creato.status(), await creato.text()).toBe(201);
  const { id, slug, moderatorToken } = (await creato.json()) as {
    id: string;
    slug: string;
    moderatorToken: string;
  };
  const headers = { Authorization: `Bearer ${moderatorToken}` };
  for (const status of ['PUBLISHED', 'LIVE']) {
    const res = await request.put(`/api/events/${id}`, { headers, data: { status } });
    expect(res.ok(), `${status}: ${res.status()}`).toBeTruthy();
  }
  const iscritti: string[] = [];
  for (const nome of ['Persona Uno', 'Persona Due']) {
    const res = await request.post(`/api/events/${slug}/registrations`, {
      data: {
        displayName: nome,
        email: `e2e-partecipazione-${randomUUID()}@example.com`,
        consentGiven: true,
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    iscritti.push(((await res.json()) as { accessToken: string }).accessToken);
  }
  evento = { id, slug, titolo, moderatorToken, iscritti };
  return evento;
}

test.afterAll(async ({ playwright }) => {
  if (!evento) return;
  const api = await playwright.request.newContext({
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
  });
  const headers = { Authorization: `Bearer ${evento.moderatorToken}` };
  // L'evento e' in diretta: va chiuso prima di eliminarlo. La cancellazione
  // si tenta comunque, e un suo errore fa fallire il test.
  try {
    await api.put(`/api/events/${evento.id}`, { headers, data: { status: 'ENDED' } });
  } finally {
    const res = await api.delete(`/api/events/${evento.id}`, { headers });
    await api.dispose();
    evento = null;
    expect(res.ok(), `eliminazione: ${res.status()}`).toBeTruthy();
  }
});

test('domande e risposte: chi partecipa chiede, chi modera risponde', async ({
  request,
}) => {
  const { slug, moderatorToken, iscritti } = await preparaEvento(request);
  const [uno, due] = iscritti;

  const chiesta = await request.post(`/api/events/${slug}/questions`, {
    data: { accessToken: uno, text: 'Quando saranno disponibili i materiali?' },
  });
  expect(chiesta.status(), await chiesta.text()).toBe(201);
  const domanda = (await chiesta.json()) as { id: string; authorName: string };
  expect(domanda.authorName).toBe('Persona Uno');

  // Un'altra persona la sostiene con il pollice in su.
  const pollice = await request.post(
    `/api/events/${slug}/questions/${domanda.id}/upvote`,
    {
      data: { accessToken: due },
    }
  );
  expect(pollice.ok(), await pollice.text()).toBeTruthy();

  // Chi modera la vede e risponde.
  const moderatore = { Authorization: `Bearer ${moderatorToken}` };
  const elenco = await request.get(`/api/events/${slug}/questions`, {
    headers: moderatore,
  });
  expect(elenco.ok()).toBeTruthy();
  const { questions: domande } = (await elenco.json()) as {
    questions: Array<{ id: string; upvoteCount: number }>;
  };
  expect(domande.find((d) => d.id === domanda.id)?.upvoteCount).toBe(1);

  const risposta = await request.patch(`/api/events/${slug}/questions/${domanda.id}`, {
    headers: moderatore,
    data: { status: 'ANSWERED', answer: 'Dopo l’evento, nella pagina dell’evento.' },
  });
  expect(risposta.ok(), await risposta.text()).toBeTruthy();

  // Chi ha chiesto legge la risposta.
  const letta = await request.get(`/api/events/${slug}/questions`, {
    headers: { Authorization: `Bearer ${uno}` },
  });
  expect(letta.ok()).toBeTruthy();
  const { questions: visibili } = (await letta.json()) as {
    questions: Array<{ id: string; status: string; answerText: string | null }>;
  };
  const vista = visibili.find((d) => d.id === domanda.id);
  expect(vista?.status).toBe('ANSWERED');
  expect(vista?.answerText).toContain('Dopo l’evento');
});

test('sondaggi: chi modera apre, chi partecipa vota una volta', async ({ request }) => {
  const { slug, moderatorToken, iscritti } = await preparaEvento(request);
  const moderatore = { Authorization: `Bearer ${moderatorToken}` };

  const creato = await request.post(`/api/events/${slug}/polls`, {
    headers: moderatore,
    data: { question: 'Il formato vi è utile?', options: ['Sì', 'No', 'In parte'] },
  });
  expect(creato.status(), await creato.text()).toBe(201);
  const sondaggio = (await creato.json()) as { id: string; status: string };
  if (sondaggio.status !== 'OPEN') {
    const aperto = await request.patch(`/api/events/${slug}/polls/${sondaggio.id}`, {
      headers: moderatore,
      data: { status: 'OPEN' },
    });
    expect(aperto.ok(), await aperto.text()).toBeTruthy();
  }

  const voto = await request.post(`/api/events/${slug}/polls/${sondaggio.id}/vote`, {
    data: { optionIndex: 0, accessToken: iscritti[0] },
  });
  expect(voto.ok(), await voto.text()).toBeTruthy();
  // Lo stesso iscritto non vota due volte.
  const ancora = await request.post(`/api/events/${slug}/polls/${sondaggio.id}/vote`, {
    data: { optionIndex: 1, accessToken: iscritti[0] },
  });
  expect(ancora.ok()).toBeFalsy();
  // Anche chi entra come ospite vota, con l'identificativo del browser.
  const ospite = await request.post(`/api/events/${slug}/polls/${sondaggio.id}/vote`, {
    data: { optionIndex: 2, guestId: `e2e-ospite-${randomUUID()}` },
  });
  expect(ospite.ok(), await ospite.text()).toBeTruthy();

  const risultati = await request.get(`/api/events/${slug}/polls`, {
    headers: moderatore,
  });
  expect(risultati.ok()).toBeTruthy();
  const { polls: sondaggi } = (await risultati.json()) as {
    polls: Array<{ id: string; totalVotes: number; optionCounts: number[] }>;
  };
  const conteggio = sondaggi.find((s) => s.id === sondaggio.id);
  expect(conteggio?.totalVotes).toBe(2);
  expect(conteggio?.optionCounts).toEqual([1, 0, 1]);
});

test('calendario: il file .ics porta l’evento e non il nome di chi conduce', async ({
  request,
}) => {
  const { slug, titolo } = await preparaEvento(request);
  const res = await request.get(`/api/events/${slug}/calendar.ics`);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/calendar');
  const ics = await res.text();
  expect(ics).toContain('BEGIN:VCALENDAR');
  expect(ics).toContain('BEGIN:VEVENT');
  expect(ics.replace(/\r?\n[ \t]/g, '')).toContain(titolo);
  // L'organizzatore del calendario e' un ente, mai la persona che modera.
  expect(ics).toMatch(/ORGANIZER/);
  expect(ics).not.toContain('Persona Che Conduce');
});

test('lingue: dalla pagina dell’evento in italiano a quella in inglese', async ({
  page,
  request,
  isMobile,
}) => {
  // Su telefono il selettore sta nel menu: qui conta il cambio di lingua, non il menu.
  test.skip(isMobile, 'selettore della lingua nel menu del telefono');
  const { slug } = await preparaEvento(request);
  await page.goto(`/it/eventi/${slug}`);
  await expect(page.locator('html')).toHaveAttribute('lang', 'it');
  // Il selettore e' il menu dello slim header: il pulsante con la lingua
  // attiva apre l'elenco.
  await page.getByRole('button', { name: /^Lingua attiva/ }).click();
  await page.locator('a[lang="en"]').first().click();
  // Gli URL sono localizzati, non solo i testi.
  await expect(page).toHaveURL(new RegExp(`/en/events/${slug}$`));
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
