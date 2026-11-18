// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { randomUUID } from 'crypto';

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

import messages from '../src/i18n/messages/it.json';

import { accediComeAdmin } from './helpers/accesso-admin';
import {
  accediConLink,
  creaAccountStaff,
  eliminaAccountStaff,
  type AccountStaff,
} from './helpers/accesso-staff';

/**
 * Il blocco di pubblicazione: la destinazione della registrazione e' cio' a cui
 * ha acconsentito chi spunta la casella. Un evento riservato non si rende
 * pubblico e non si collega a un video esterno. Prima della sala la scelta e'
 * libera; a sala aperta non cambia, e a sala chiusa si puo' solo restringere.
 *
 * La regola sta in lib/recording/destination: qui si prova attraverso le rotte
 * vere e il pannello che le chiama, compresa la pagina rimasta aperta mentre
 * la destinazione cambia.
 *
 * Le prove agiscono come chi organizza gli eventi: un account nominale che li
 * crea. Allegare il file e pubblicarlo toccano il contenuto della
 * registrazione, che e' di chi organizza (ADR-021): la sessione della chiave
 * dell'istanza non lo fa, e una prova lo dice.
 */

const ADMIN_KEY = process.env.ADMIN_API_KEY || 'dev_admin_key_2026';
const CODICE = 'RECORDING_DESTINATION_NOT_COVERED';
const SOLO_ORGANIZZATORI = 'RECORDING_CONTENT_ORGANIZER_ONLY';
const YOUTUBE = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';
const VIDEO = 'https://example.com/registrazione.mp4';

type Destinazione = 'PUBLIC' | 'REGISTRANTS';
interface Evento {
  id: string;
  slug: string;
  moderatorToken: string;
}

// Login e creazione hanno un limite: un accesso per file, e gli eventi che le
// prove non cambiano si condividono.
test.describe.configure({ mode: 'serial' });
type Cookie = Awaited<ReturnType<ReturnType<Page['context']>['cookies']>>;
/** La sessione di chi organizza gli eventi della prova. */
let sessione: Cookie | null = null;
/** La sessione della chiave dell'istanza, che ha creato l'account. */
let sessioneChiave: Cookie | null = null;
let organizzatore: AccountStaff | null = null;
let riservato: Evento | null = null;
let riservatoConcluso = false;
let pubblicoInDiretta: Evento | null = null;
const creati: Evento[] = [];

test.afterAll(async ({ playwright }) => {
  const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
  const api = await playwright.request.newContext({ baseURL });
  for (const { id, moderatorToken } of creati.splice(0)) {
    const headers = { Authorization: `Bearer ${moderatorToken}` };
    // Un evento in diretta non si elimina: prima si chiude.
    await api.put(`/api/events/${id}`, { headers, data: { status: 'ENDED' } });
    await api.delete(`/api/events/${id}`, { headers });
  }
  await api.dispose();

  // L'account dopo i suoi eventi: eliminarlo cambia i loro link da moderatore.
  if (!organizzatore || !sessioneChiave) return;
  const chiave = await playwright.request.newContext({
    baseURL,
    storageState: { cookies: sessioneChiave, origins: [] },
  });
  const eliminato = await eliminaAccountStaff(chiave, organizzatore);
  await chiave.dispose();
  organizzatore = null;
  expect(eliminato.ok(), `eliminazione dell'account: ${eliminato.status()}`).toBeTruthy();
});

/**
 * Entra come chi organizza gli eventi della prova. La chiave dell'istanza crea
 * l'account, che entra dal link arrivato per email: amministratore, perche' la
 * prova legge anche l'elenco delle pubblicazioni, che e' dell'amministrazione.
 * La sessione della chiave resta da parte.
 */
async function accedi(page: Page) {
  if (sessione) {
    await page.context().addCookies(sessione);
    return;
  }
  const login = await accediComeAdmin(page.request, ADMIN_KEY);
  expect(login.ok(), `login: ${login.status()}`).toBeTruthy();
  sessioneChiave = await page.context().cookies();
  organizzatore = await creaAccountStaff(page.request, 'ADMIN');
  const accesso = await accediConLink(page.request, organizzatore);
  expect(accesso.ok(), `accesso dal link: ${await accesso.text()}`).toBeTruthy();
  sessione = await page.context().cookies();
}

/** La stessa pagina con la sessione della chiave dell'istanza al posto di quella
 *  di chi organizza. */
async function passaAllaChiave(page: Page) {
  expect(sessioneChiave, 'sessione della chiave assente').toBeTruthy();
  await page.context().clearCookies();
  await page.context().addCookies(sessioneChiave!);
}

function datiEvento(extra: Record<string, unknown>) {
  const inizio = Date.now() + 86_400_000;
  return {
    title: { it: `E2E destinazione ${randomUUID().slice(0, 8)}` },
    description: { it: 'Evento creato dal test del blocco di pubblicazione.' },
    startsAt: new Date(inizio).toISOString(),
    endsAt: new Date(inizio + 3_600_000).toISOString(),
    recordingEnabled: true,
    ...extra,
  };
}

/** Crea un evento. A limite raggiunto si aspetta il tempo detto dal server: il
 *  limite vale per indirizzo, e la suite gira da uno solo. */
async function inviaCreazione(api: APIRequestContext, data: Record<string, unknown>) {
  const crea = () => api.post('/api/events', { data });
  const risposta = await crea();
  if (risposta.status() !== 429) return risposta;
  const secondi = Number(risposta.headers()['retry-after'] ?? 60) + 1;
  test.info().setTimeout(test.info().timeout + secondi * 1000);
  await new Promise((fine) => setTimeout(fine, secondi * 1000));
  return crea();
}

async function creaEvento(
  api: APIRequestContext,
  recordingDestination: Destinazione,
  extra: Record<string, unknown> = {}
): Promise<Evento> {
  const creato = await inviaCreazione(
    api,
    datiEvento({ recordingDestination, ...extra })
  );
  expect(creato.status(), await creato.text()).toBe(201);
  const evento = (await creato.json()) as Evento;
  creati.push(evento);
  return evento;
}

/** La modifica fatta da chi gestisce l'evento: sessione dello staff e token. */
function modifica(api: APIRequestContext, evento: Evento, data: Record<string, unknown>) {
  return api.put(`/api/events/${evento.id}`, {
    headers: { Authorization: `Bearer ${evento.moderatorToken}` },
    data,
  });
}

async function vaiAllaDiretta(api: APIRequestContext, evento: Evento) {
  for (const status of ['PUBLISHED', 'LIVE']) {
    const res = await modifica(api, evento, { status });
    expect(res.ok(), `${status}: ${await res.text()}`).toBeTruthy();
  }
}

/**
 * Il file caricato: un evento riservato lo prende, solo per gli iscritti. Con lo
 * storage delle registrazioni configurato un evento riservato accetta solo un
 * suo file: queste prove girano senza, come lo stack locale. Lo allega chi
 * organizza l'evento: il file e' contenuto della registrazione.
 */
async function allegaVideo(api: APIRequestContext, evento: Evento) {
  const res = await api.patch(`/api/admin/publications/${evento.id}`, {
    data: { recordingUrl: VIDEO },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

/** L'evento riservato con il suo video, comune alle prove che non lo cambiano. */
async function eventoRiservato(api: APIRequestContext): Promise<Evento> {
  if (!riservato) {
    riservato = await creaEvento(api, 'REGISTRANTS');
    await allegaVideo(api, riservato);
  }
  return riservato;
}

/** L'evento pubblico con video e link esterno, portato in diretta una volta sola. */
async function eventoInDiretta(api: APIRequestContext): Promise<Evento> {
  if (!pubblicoInDiretta) {
    pubblicoInDiretta = await creaEvento(api, 'PUBLIC', { youtubeUrl: YOUTUBE });
    await allegaVideo(api, pubblicoInDiretta);
    await vaiAllaDiretta(api, pubblicoInDiretta);
  }
  return pubblicoInDiretta;
}

async function concludi(api: APIRequestContext, evento: Evento) {
  for (const status of ['PUBLISHED', 'ENDED']) {
    const res = await modifica(api, evento, { status });
    expect(res.ok(), `${status}: ${await res.text()}`).toBeTruthy();
  }
}

/** Come lo staff vede la pubblicazione dell'evento: serve un video o un link. */
async function statoPubblicazione(api: APIRequestContext, evento: Evento) {
  const res = await api.get('/api/admin/publications');
  expect(res.ok(), await res.text()).toBeTruthy();
  const { rows } = (await res.json()) as {
    rows: {
      id: string;
      recordingAudience: Destinazione;
      recordingDestination: Destinazione | null;
      youtubeUrl: string | null;
      hasPublishedRecording: boolean;
    }[];
  };
  const riga = rows.find((r) => r.id === evento.id);
  expect(riga, `evento ${evento.slug} non in elenco`).toBeTruthy();
  return riga!;
}

async function destinazioneSalvata(api: APIRequestContext, evento: Evento) {
  const res = await api.get(`/api/events/${evento.id}`, {
    headers: { Authorization: `Bearer ${evento.moderatorToken}` },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return ((await res.json()) as { recordingDestination: Destinazione | null })
    .recordingDestination;
}

async function attendiRifiuto(risposta: ReturnType<APIRequestContext['put']>) {
  const res = await risposta;
  expect(res.status(), await res.text()).toBe(409);
  expect(((await res.json()) as { code: string }).code).toBe(CODICE);
}

test.describe('le rotte', () => {
  test('un evento riservato non si rende visibile a tutti', async ({ page }) => {
    await accedi(page);
    const api = page.request;
    const evento = await eventoRiservato(api);

    await attendiRifiuto(modifica(api, evento, { recordingAudience: 'PUBLIC' }));

    const stato = await statoPubblicazione(api, evento);
    expect(stato.recordingAudience).toBe('REGISTRANTS');
    expect(stato.recordingDestination).toBe('REGISTRANTS');
  });

  test('un evento riservato non si collega a un video esterno', async ({ page }) => {
    await accedi(page);
    const api = page.request;
    const evento = await eventoRiservato(api);

    await attendiRifiuto(modifica(api, evento, { youtubeUrl: YOUTUBE }));
    await attendiRifiuto(modifica(api, evento, { tempRecordingUrl: VIDEO }));
    await attendiRifiuto(
      api.patch(`/api/admin/publications/${evento.id}`, { data: { youtubeUrl: YOUTUBE } })
    );

    expect((await statoPubblicazione(api, evento)).youtubeUrl).toBeNull();
  });

  test("la chiave dell'istanza non tocca il file, e la destinazione vale anche per lei", async ({
    page,
  }) => {
    await accedi(page);
    const evento = await eventoRiservato(page.request);
    await passaAllaChiave(page);
    const chiave = page.request;

    // Il file e la sua pubblicazione sono di chi organizza l'evento: la chiave
    // non ne allega un altro, non lo toglie e non lo ritira.
    for (const data of [
      { recordingUrl: 'https://example.com/altra-registrazione.mp4' },
      { recordingUrl: null },
      { recordingPublished: false },
    ]) {
      const res = await chiave.patch(`/api/admin/publications/${evento.id}`, { data });
      expect(res.status(), await res.text()).toBe(403);
      expect(((await res.json()) as { code: string }).code).toBe(SOLO_ORGANIZZATORI);
    }
    // Il link esterno resta di chi gestisce l'evento, nei limiti della destinazione.
    await attendiRifiuto(
      chiave.patch(`/api/admin/publications/${evento.id}`, {
        data: { youtubeUrl: YOUTUBE },
      })
    );

    const stato = await statoPubblicazione(chiave, evento);
    expect(stato.hasPublishedRecording).toBe(true);
    expect(stato.youtubeUrl).toBeNull();
  });

  test('nemmeno alla creazione, anche senza scegliere la destinazione', async ({
    page,
  }) => {
    await accedi(page);
    // Chi registra senza scegliere parte riservato: la regola e' la stessa.
    await attendiRifiuto(
      inviaCreazione(page.request, datiEvento({ youtubeUrl: YOUTUBE }))
    );
  });

  test('una destinazione dichiarata non si toglie', async ({ page }) => {
    await accedi(page);
    const api = page.request;
    const evento = await eventoRiservato(api);

    await attendiRifiuto(modifica(api, evento, { recordingDestination: null }));

    expect(await destinazioneSalvata(api, evento)).toBe('REGISTRANTS');
  });

  test('a sala aperta la destinazione non cambia, e la risposta lo dice', async ({
    page,
  }) => {
    await accedi(page);
    const api = page.request;
    const evento = await eventoInDiretta(api);

    const rimandato = await modifica(api, evento, {
      recordingDestination: 'REGISTRANTS',
    });
    expect(rimandato.status(), await rimandato.text()).toBe(200);
    const corpo = (await rimandato.json()) as { ignoredCreationOnlyFields?: string[] };
    expect(corpo.ignoredCreationOnlyFields).toContain('recordingDestination');

    expect(await destinazioneSalvata(api, evento)).toBe('PUBLIC');
  });

  test('a sala chiusa restringere passa, tornare indietro no', async ({
    page,
    browser,
  }) => {
    await accedi(page);
    const api = page.request;
    const evento = await eventoInDiretta(api);
    const concluso = await modifica(api, evento, { status: 'ENDED' });
    expect(concluso.ok(), await concluso.text()).toBeTruthy();

    // Anche chi chiede ancora «per tutti» nella stessa richiesta: vince la restrizione.
    const ristretto = await modifica(api, evento, {
      recordingDestination: 'REGISTRANTS',
      recordingAudience: 'PUBLIC',
    });
    expect(ristretto.status(), await ristretto.text()).toBe(200);

    const stato = await statoPubblicazione(api, evento);
    expect(stato.recordingDestination).toBe('REGISTRANTS');
    expect(stato.recordingAudience).toBe('REGISTRANTS');
    expect(stato.youtubeUrl).toBe(YOUTUBE);

    await attendiRifiuto(modifica(api, evento, { recordingDestination: 'PUBLIC' }));
    expect(await destinazioneSalvata(api, evento)).toBe('REGISTRANTS');

    // Risposta e pagina si guardano da visitatore, senza la sessione dello staff.
    const visitatore = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
    });
    const pubblico = await visitatore.request.get(`/api/events/${evento.slug}`);
    expect(pubblico.ok()).toBeTruthy();
    expect(
      ((await pubblico.json()) as { recordingUrl: string | null }).recordingUrl
    ).toBeNull();
    const pagina = await visitatore.newPage();
    await pagina.goto(`/it/eventi/${evento.slug}`);
    const html = await pagina.content();
    expect(html).not.toContain(YOUTUBE);
    expect(html).not.toContain(VIDEO);
    await visitatore.close();
  });
});

for (const [dispositivo, viewport] of [
  ['telefono', { width: 360, height: 780 }],
  ['portatile', { width: 1280, height: 900 }],
] as const) {
  test.describe(`il pannello della registrazione (${dispositivo})`, () => {
    test.use({ viewport });

    async function apriPannello(page: Page, evento: Evento) {
      await page.goto(`/it/admin/eventi/${evento.id}?tab=dopo`);
      const tutti = page.locator('#audience-PUBLIC');
      await tutti.waitFor({ state: 'attached' });
      // A pagina idratata: prima la scelta non risponde.
      await expect
        .poll(
          () =>
            tutti.evaluate((el) => Object.keys(el).some((k) => k.startsWith('__react'))),
          {
            timeout: 30_000,
          }
        )
        .toBe(true);
      return tutti;
    }

    test("su un evento riservato «Tutti» non si sceglie, e il perche' si legge", async ({
      page,
    }) => {
      await accedi(page);
      const api = page.request;
      const evento = await eventoRiservato(api);
      if (!riservatoConcluso) await concludi(api, evento);
      riservatoConcluso = true;

      const tutti = await apriPannello(page, evento);

      await expect(tutti).toBeDisabled();
      await expect(page.locator('#audience-REGISTRANTS')).toBeChecked();
      await expect(page.getByText(messages.recording.audienceReservedNote)).toBeVisible();
    });

    test('la pagina rimasta aperta riceve il rifiuto e torna alla scelta salvata', async ({
      page,
    }) => {
      await accedi(page);
      const api = page.request;
      const evento = await creaEvento(api, 'PUBLIC');
      await allegaVideo(api, evento);
      const soloIscritti = await modifica(api, evento, {
        recordingAudience: 'REGISTRANTS',
      });
      expect(soloIscritti.ok(), await soloIscritti.text()).toBeTruthy();
      await concludi(api, evento);

      const tutti = await apriPannello(page, evento);
      await expect(tutti).toBeEnabled();

      // Intanto un altro membro dello staff restringe la destinazione.
      const ristretto = await modifica(api, evento, {
        recordingDestination: 'REGISTRANTS',
      });
      expect(ristretto.status(), await ristretto.text()).toBe(200);

      const risposta = page.waitForResponse(
        (r) =>
          r.url().endsWith(`/api/events/${evento.id}`) && r.request().method() === 'PUT'
      );
      await page.locator('label[for="audience-PUBLIC"]').click();
      expect((await risposta).status()).toBe(409);

      await expect(
        page
          .getByRole('alert')
          .filter({ hasText: messages.apiErrors.recordingDestinationNotCovered })
      ).toBeVisible();
      await expect(page.locator('#audience-REGISTRANTS')).toBeChecked();
      await expect(tutti).not.toBeChecked();
    });
  });
}
