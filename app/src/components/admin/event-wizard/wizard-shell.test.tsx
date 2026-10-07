import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

import EventWizard, { type InitialEventShape, type WizardProps } from './wizard-shell';

/**
 * Il wizard dell'evento dal punto di vista di chi lo usa: cosa vede quando il
 * server rifiuta i dati, e cosa succede a una revoca che non va a buon fine.
 */

const push = vi.fn();
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push }),
  percorso: (p: string) => p,
}));
const toastError = vi.fn();
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ error: toastError, success: vi.fn(), info: vi.fn() }),
}));

const w = messages.admin.wizard;
const fetchMock = vi.fn();

function json(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const baseProps: WizardProps = {
  siteTimezone: 'Europe/Rome',
  enabledLocales: ['it', 'en'],
  defaultLocale: 'it',
  defaultSenderRatioPct: 30,
  defaultRetentionDays: 30,
  jvbSizingConfig: {
    cpuCoresPerPod: 16,
    receiversPerCore: 18.75,
    sendersPerCore: 3.125,
    maxReplicas: 1,
  },
  availableTags: [],
  gdprTemplates: [],
  siteDefaultParseTitleKicker: false,
  siteDefaultVideoQuality: 'HIGH',
  whiteboardInfraReady: true,
};

let container: HTMLDivElement;
let root: Root;

function renderWizard(props: Partial<WizardProps> = {}) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <EventWizard {...baseProps} {...props} />
      </NextIntlClientProvider>,
    );
  });
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = container.querySelector<T>(`#${id}`);
  if (!el) throw new Error(`nessun elemento #${id}`);
  return el;
}

function button(text: string, scope: ParentNode = container): HTMLButtonElement {
  const b = Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find(
    (el) => el.textContent?.trim() === text,
  );
  if (!b) throw new Error(`nessun pulsante «${text}»`);
  return b;
}

function click(el: HTMLElement) {
  act(() => {
    el.click();
  });
}

function goToStep(label: string) {
  const nav = container.querySelector<HTMLElement>('nav[aria-label="Wizard steps"]')!;
  const b = Array.from(nav.querySelectorAll<HTMLButtonElement>('button')).find((el) =>
    el.textContent?.includes(label),
  );
  if (!b) throw new Error(`nessun passo «${label}»`);
  click(b);
}

function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  act(() => {
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Il click avvia richieste asincrone: si lascia correre la coda. */
async function press(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function alertText(): string {
  // L'unico `role="alert"` del wizard e' l'avviso in cima.
  return container.querySelector('[role="alert"]')?.textContent ?? '';
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  push.mockReset();
  toastError.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  // jsdom non implementa lo scorrimento.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('creazione — descrizione mancante', () => {
  it('ferma «Pubblica» sul campo della descrizione, senza chiamare il server', async () => {
    renderWizard();
    type(byId<HTMLInputElement>('ev-title'), 'Evento di prova');

    goToStep(w.steps.review);
    type(byId<HTMLInputElement>('rev-mod-name'), 'Mario Rossi');
    type(byId<HTMLInputElement>('rev-mod-email'), 'mario@example.org');
    await press(button(w.publish));

    expect(alertText()).toBe(w.validationFailed);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(byId('ev-description-it')).toHaveClass('is-invalid');
    expect(container.querySelector('.invalid-feedback')?.textContent).toBe(
      w.step1.validation.descriptionRequired.replace('{min}', '10'),
    );
  });

  it('la bozza chiede la stessa descrizione: la creazione salva comunque l evento', async () => {
    renderWizard();
    type(byId<HTMLInputElement>('ev-title'), 'Evento di prova');
    goToStep(w.steps.review);
    await press(button(w.saveDraft));

    expect(alertText()).toBe(w.validationFailed);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(byId('ev-description-it')).toHaveClass('is-invalid');
  });

  it('un 422 del server porta al campo e al passo, con il messaggio localizzato', async () => {
    fetchMock.mockResolvedValue(
      json(422, {
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: [
          {
            path: ['description'],
            message: 'description.it is required and must be at least 10 characters',
          },
        ],
      }),
    );
    renderWizard();
    type(byId<HTMLInputElement>('ev-title'), 'Evento di prova');
    type(byId<HTMLTextAreaElement>('ev-description-it'), 'Una descrizione valida per il wizard.');

    goToStep(w.steps.review);
    type(byId<HTMLInputElement>('rev-mod-name'), 'Mario Rossi');
    type(byId<HTMLInputElement>('rev-mod-email'), 'mario@example.org');
    await press(button(w.publish));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(alertText()).toBe(w.validationFailed);
    expect(alertText()).not.toContain('Validation failed');
    // Tornato al passo Base, con il campo evidenziato.
    expect(byId('ev-description-it')).toHaveClass('is-invalid');
    expect(push).not.toHaveBeenCalled();
  });
});

describe('modifica — revoca di un co-moderatore', () => {
  const initialEvent: InitialEventShape = {
    id: 'evt-1',
    slug: 'evento',
    moderatorToken: 'token-primario',
    event: {
      title: { it: 'Evento di prova' },
      description: { it: 'Una descrizione valida per il wizard.' },
      startsAt: '2030-01-10T09:00:00.000Z',
      endsAt: '2030-01-10T11:00:00.000Z',
      timezone: 'Europe/Rome',
      maxParticipants: 100,
      coverImageUrl: null,
      imageUrl: null,
      waitingRoomAudioUrl: null,
      tagSlugs: [],
      recurrenceRule: null,
      parseTitleKicker: null,
      waitingRoomEngine: null,
      videoQuality: null,
      expectedSenderRatioPct: null,
      permissionMatrix: null,
      qaEnabled: false,
      chatEnabled: true,
      participantsCanUnmute: false,
      participantsCanStartVideo: false,
      participantsCanShareScreen: false,
      recordingEnabled: false,
      autoStartRecording: false,
      dataRetentionDays: 30,
      postEventPublic: true,
      status: 'PUBLISHED',
      gdprTemplateId: null,
      privacyPolicyText: null,
      privacyPolicyUrl: null,
      moderatorName: 'Mario Rossi',
      moderatorEmail: 'mario@example.org',
    },
    organizers: [],
    eventModerators: [
      { id: 'mod-1', name: 'Anna Bianchi', email: 'anna@example.org', role: 'MODERATOR', personId: null },
    ],
    invitations: [],
    materials: [],
    preEventQuestionnaire: null,
    postEventQuestionnaire: null,
  };

  it('una revoca rifiutata lo dice per nome, resta sulla pagina e al salvataggio successivo riprova', async () => {
    let revocaRiesce = false;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (init.method === 'DELETE' && url === '/api/events/evt-1/moderators/mod-1') {
        return revocaRiesce ? json(200, { revoked: true }) : json(500, { error: 'Internal error' });
      }
      return json(200, {});
    });

    renderWizard({ mode: 'edit', initialEvent: structuredClone(initialEvent) });

    goToStep(w.steps.invites);
    const riga = Array.from(container.querySelectorAll('li')).find((li) =>
      li.textContent?.includes('Anna Bianchi'),
    )!;
    click(button(w.step3.remove, riga));

    goToStep(w.steps.review);
    await press(button(w.updateEvent));

    const atteso = w.revocationFailed
      .replace('{name}', 'Anna Bianchi')
      .replace('{tab}', messages.admin.eventDetail.tabs.people);
    expect(alertText()).toBe(atteso);
    expect(push).not.toHaveBeenCalled();

    revocaRiesce = true;
    await press(button(w.updateEvent));

    expect(push).toHaveBeenCalledTimes(1);
    const revoche = (fetchMock.mock.calls as Array<[string, RequestInit]>).filter(
      ([url, init]) => init?.method === 'DELETE' && url.endsWith('/moderators/mod-1'),
    );
    expect(revoche).toHaveLength(2);
    // Solo le intestazioni che le rotte leggono: il token viaggia come Bearer.
    for (const [, init] of fetchMock.mock.calls as Array<[string, RequestInit]>) {
      const nomi = Object.keys((init?.headers ?? {}) as Record<string, string>).map((h) =>
        h.toLowerCase(),
      );
      for (const nome of nomi) expect(['content-type', 'authorization']).toContain(nome);
    }
    for (const [, init] of revoche) {
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-primario');
    }
  });
});

describe('passo 2 — lavagna', () => {
  function interruttoreLavagna(): HTMLInputElement {
    const el = container.querySelector<HTMLInputElement>(
      `input[aria-label="${messages.admin.form.whiteboardEnabled}"]`,
    );
    if (!el) throw new Error('interruttore della lavagna non trovato');
    return el;
  }

  it('senza il servizio lavagna l interruttore non si accende e dice perche', () => {
    renderWizard({ whiteboardInfraReady: false });
    goToStep(w.steps.permissions);

    expect(interruttoreLavagna()).toBeDisabled();
    expect(container.textContent).toContain(messages.admin.form.whiteboardUnavailable);
  });

  it('con il servizio lavagna l interruttore funziona come prima', () => {
    renderWizard({ whiteboardInfraReady: true });
    goToStep(w.steps.permissions);

    expect(interruttoreLavagna()).toBeEnabled();
    expect(container.textContent).not.toContain(messages.admin.form.whiteboardUnavailable);
    click(interruttoreLavagna());
    expect(interruttoreLavagna()).toBeChecked();
  });

  it('un valore gia acceso resta spegnibile anche senza il servizio', () => {
    renderWizard({
      whiteboardInfraReady: false,
      template: {
        id: 'tpl',
        name: 'Modello',
        qaEnabled: false,
        chatEnabled: true,
        recordingEnabled: false,
        autoStartRecording: false,
        whiteboardEnabled: true,
        participantsCanUnmute: false,
        participantsCanStartVideo: false,
        participantsCanShareScreen: false,
        maxParticipants: 100,
      },
    });
    goToStep(w.steps.permissions);

    expect(interruttoreLavagna()).toBeChecked();
    expect(interruttoreLavagna()).toBeEnabled();
    click(interruttoreLavagna());
    expect(interruttoreLavagna()).not.toBeChecked();
    expect(interruttoreLavagna()).toBeDisabled();
  });
});

/**
 * «Pubblica» crea l'evento e poi lo pubblica con una seconda richiesta. Se la
 * seconda fallisce l'evento esiste ma resta in bozza: chi l'ha creato deve
 * saperlo, come per gli altri elementi che non si sono salvati.
 */
describe('creazione — pubblicazione non riuscita', () => {
  const CREATO = { id: 'evt-new', slug: 'evento-nuovo', moderatorToken: 'token-nuovo' };

  function compilaEPubblica() {
    renderWizard();
    type(byId<HTMLInputElement>('ev-title'), 'Evento di prova');
    type(byId<HTMLTextAreaElement>('ev-description-it'), 'Una descrizione valida per il wizard.');
    goToStep(w.steps.review);
    type(byId<HTMLInputElement>('rev-mod-name'), 'Mario Rossi');
    type(byId<HTMLInputElement>('rev-mod-email'), 'mario@example.org');
    return press(button(w.publish));
  }

  function rispondi(pubblicazione: () => Promise<Response>) {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url === '/api/events' && init.method === 'POST') return json(201, CREATO);
      if (url === `/api/events/${CREATO.id}` && init.method === 'PUT') return pubblicazione();
      return json(200, {});
    });
  }

  function richiestaDiPubblicazione(): RequestInit | undefined {
    const call = (fetchMock.mock.calls as Array<[string, RequestInit]>).find(
      ([url, init]) => url === `/api/events/${CREATO.id}` && init?.method === 'PUT',
    );
    return call?.[1];
  }

  it('il server rifiuta: avviso con la risposta, e si prosegue alla pagina dell evento', async () => {
    rispondi(async () => json(500, { error: 'Internal error' }));
    await compilaEPubblica();

    expect(JSON.parse(String(richiestaDiPubblicazione()?.body))).toEqual({ status: 'PUBLISHED' });
    expect(toastError).toHaveBeenCalledWith(
      w.publishFailedDetail.replace('{reason}', 'Internal error'),
    );
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('la rete cade: avviso senza dettaglio', async () => {
    rispondi(async () => {
      throw new TypeError('Failed to fetch');
    });
    await compilaEPubblica();

    expect(toastError).toHaveBeenCalledWith(w.publishFailed);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('pubblicazione riuscita: nessun avviso', async () => {
    rispondi(async () => json(200, { ...CREATO, status: 'PUBLISHED' }));
    await compilaEPubblica();

    expect(richiestaDiPubblicazione()).toBeDefined();
    expect(toastError).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledTimes(1);
  });
});

/**
 * Dopo la creazione si arriva alla pagina dell'evento, che vale con la
 * sessione dello staff. La pagina di modifica senza il token del moderatore
 * risponde 404, e il primo evento di chi installa sembrava non creato.
 */
describe('creazione — dove si arriva', () => {
  const CREATO = { id: 'evt-new', slug: 'evento-nuovo', moderatorToken: 'token-nuovo' };

  function compila() {
    renderWizard();
    type(byId<HTMLInputElement>('ev-title'), 'Evento di prova');
    type(byId<HTMLTextAreaElement>('ev-description-it'), 'Una descrizione valida per il wizard.');
    goToStep(w.steps.review);
    type(byId<HTMLInputElement>('rev-mod-name'), 'Mario Rossi');
    type(byId<HTMLInputElement>('rev-mod-email'), 'mario@example.org');
  }

  beforeEach(() => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url === '/api/events' && init.method === 'POST') return json(201, CREATO);
      if (url === `/api/events/${CREATO.id}` && init.method === 'PUT') {
        return json(200, { ...CREATO, status: 'PUBLISHED' });
      }
      return json(200, {});
    });
  });

  it('«Pubblica» porta alla pagina dell evento, senza il token nell indirizzo', async () => {
    compila();
    await press(button(w.publish));

    expect(push).toHaveBeenCalledTimes(1);
    // `created=1`: la pagina mostra il riepilogo dell'evento appena creato.
    expect(push).toHaveBeenCalledWith(`/admin/events/${CREATO.id}?created=1`);
  });

  it('«Salva bozza» porta alla stessa pagina', async () => {
    compila();
    await press(button(w.saveDraft));

    expect(push).toHaveBeenCalledTimes(1);
    const [destinazione] = push.mock.calls[0] as [string];
    expect(destinazione).toBe(`/admin/events/${CREATO.id}?created=1`);
    expect(destinazione).not.toContain('/edit');
    expect(destinazione).not.toContain(CREATO.moderatorToken);
  });
});

/**
 * Un passo rifiutato porta al campo: fuoco sul primo campo non valido,
 * segnato per le tecnologie assistive e collegato al suo messaggio. Il
 * messaggio sparisce appena il campo torna valido.
 */
describe('validazione — il fuoco va al campo da correggere', () => {
  it('«Avanti» con il titolo vuoto: fuoco sul titolo, aria-invalid e messaggio collegato', async () => {
    renderWizard();
    await press(button(`${messages.common.next} →`));

    const titolo = byId<HTMLInputElement>('ev-title');
    expect(document.activeElement).toBe(titolo);
    expect(titolo.getAttribute('aria-invalid')).toBe('true');
    const descritto = titolo.getAttribute('aria-describedby') ?? '';
    const messaggio = descritto.split(' ').map((id) => document.getElementById(id)).find(Boolean);
    expect(messaggio?.classList.contains('invalid-feedback')).toBe(true);
    // Il riepilogo accanto ai pulsanti nomina il campo.
    expect(container.textContent).toContain(w.toFix);
  });

  it('scrivendo un titolo valido il suo errore sparisce, e con l ultimo anche il riepilogo', async () => {
    renderWizard();
    await press(button(`${messages.common.next} →`));
    const voci = () => container.querySelectorAll('[role="status"] button').length;
    const prima = voci();
    type(byId<HTMLInputElement>('ev-title'), 'Evento di prova');
    await press(byId('ev-title'));

    const titolo = byId<HTMLInputElement>('ev-title');
    expect(titolo.classList.contains('is-invalid')).toBe(false);
    expect(titolo.hasAttribute('aria-invalid')).toBe(false);
    expect(voci()).toBe(prima - 1);

    // Anche la descrizione: non resta niente da correggere.
    type(byId<HTMLTextAreaElement>('ev-description-it'), 'Una descrizione valida per il wizard.');
    await press(byId('ev-title'));
    expect(container.textContent).not.toContain(w.toFix);
    expect(alertText()).toBe('');
  });

  it('«Pubblica» senza moderatore principale: fuoco sul primo campo mancante', async () => {
    renderWizard();
    type(byId<HTMLInputElement>('ev-title'), 'Evento di prova');
    type(byId<HTMLTextAreaElement>('ev-description-it'), 'Una descrizione valida per il wizard.');
    goToStep(w.steps.review);
    await press(button(w.publish));

    expect(fetchMock).not.toHaveBeenCalled();
    const attivo = document.activeElement as HTMLElement;
    expect(attivo.id).toBe('rev-mod-name');
    expect(attivo.getAttribute('aria-invalid')).toBe('true');
  });
});

describe('creazione — risorse non salvate', () => {
  it('un relatore rifiutato arriva alla pagina dell evento come tipo di risorsa, senza dati della persona', async () => {
    const CREATO = { id: 'evt-relatori', slug: 'evt-relatori', moderatorToken: 'tok-relatori' };
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url === '/api/events' && init.method === 'POST') return json(201, CREATO);
      if (url.endsWith('/moderators') && init.method === 'POST') return json(500, {});
      return json(200, {});
    });
    renderWizard();
    type(byId<HTMLInputElement>('ev-title'), 'Evento di prova');
    type(byId<HTMLTextAreaElement>('ev-description-it'), 'Una descrizione valida per il wizard.');
    goToStep(w.steps.invites);
    type(byId<HTMLInputElement>('sp-name'), 'Relatore 1');
    type(byId<HTMLInputElement>('sp-email'), 'relatore@example.org');
    // «Aggiungi» del blocco dei relatori: quello che segue il loro campo email.
    const bloccoRelatori = byId('sp-email').closest('.row') ?? container;
    await press(button(w.step3.add, bloccoRelatori));
    goToStep(w.steps.review);
    type(byId<HTMLInputElement>('rev-mod-name'), 'Mario Rossi');
    type(byId<HTMLInputElement>('rev-mod-email'), 'mario@example.org');
    await press(button(w.saveDraft));

    expect(push).toHaveBeenCalledWith(`/admin/events/${CREATO.id}?created=1`);
    const salvato = sessionStorage.getItem(`pa-wizard-unsaved:${CREATO.id}`);
    expect(JSON.parse(salvato ?? '{}')).toEqual({ unsaved: ['speakers'], publishFailed: false });
    expect(salvato).not.toContain('relatore@example.org');
    // Il riepilogo della pagina lo dira': nessun avviso doppio.
    expect(toastError).not.toHaveBeenCalled();
  });

  it('una pubblicazione rifiutata arriva al riepilogo come tale', async () => {
    const CREATO = { id: 'evt-bozza', slug: 'evt-bozza', moderatorToken: 'tok-bozza' };
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url === '/api/events' && init.method === 'POST') return json(201, CREATO);
      if (url === `/api/events/${CREATO.id}` && init.method === 'PUT') return json(409, { error: 'conflitto' });
      return json(200, {});
    });
    renderWizard();
    type(byId<HTMLInputElement>('ev-title'), 'Evento di prova');
    type(byId<HTMLTextAreaElement>('ev-description-it'), 'Una descrizione valida per il wizard.');
    goToStep(w.steps.review);
    type(byId<HTMLInputElement>('rev-mod-name'), 'Mario Rossi');
    type(byId<HTMLInputElement>('rev-mod-email'), 'mario@example.org');
    await press(button(w.publish));

    const salvato = JSON.parse(sessionStorage.getItem(`pa-wizard-unsaved:${CREATO.id}`) ?? '{}');
    expect(salvato).toEqual({ unsaved: [], publishFailed: true });
  });

  it('se il browser non conserva l esito, le risorse mancanti le dice un avviso', async () => {
    const CREATO = { id: 'evt-senza-storage', slug: 'evt-senza-storage', moderatorToken: 'tok-x' };
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url === '/api/events' && init.method === 'POST') return json(201, CREATO);
      if (url.endsWith('/moderators') && init.method === 'POST') return json(500, {});
      return json(200, {});
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage bloccato');
    });
    try {
      renderWizard();
      type(byId<HTMLInputElement>('ev-title'), 'Evento di prova');
      type(byId<HTMLTextAreaElement>('ev-description-it'), 'Una descrizione valida per il wizard.');
      goToStep(w.steps.invites);
      type(byId<HTMLInputElement>('sp-name'), 'Relatore 1');
      type(byId<HTMLInputElement>('sp-email'), 'relatore@example.org');
      await press(button(w.step3.add, byId('sp-email').closest('.row') ?? container));
      goToStep(w.steps.review);
      await press(button(w.saveDraft));
    } finally {
      setItem.mockRestore();
    }
    expect(toastError).toHaveBeenCalledWith(
      w.partialFailure.replace('{items}', w.resources.speakers),
    );
  });
});

describe('passo 1 — la fine segue l inizio', () => {
  function fuoco(el: HTMLElement, dentro: boolean) {
    act(() => {
      if (dentro) el.focus();
      else el.blur();
    });
  }

  it('scrivendo nel campo, la fine si sposta all uscita con la durata che aveva, ignorando i valori intermedi', () => {
    renderWizard();
    const inizio = byId<HTMLInputElement>('ev-starts');
    const fine = byId<HTMLInputElement>('ev-ends');
    fuoco(inizio, true);
    type(inizio, '2030-03-10T10:00');
    fuoco(inizio, false);
    type(fine, '2030-03-10T11:30');

    fuoco(inizio, true);
    // Una data scritta a mano passa per valori intermedi.
    type(inizio, '2030-03-01T10:00');
    expect(fine.value).toBe('2030-03-10T11:30');
    type(inizio, '2030-03-15T10:00');
    fuoco(inizio, false);

    expect(fine.value).toBe('2030-03-15T11:30');
  });

  it('un valore arrivato a campo non attivo (dal selettore di data) sposta subito la fine', () => {
    renderWizard();
    const inizio = byId<HTMLInputElement>('ev-starts');
    const fine = byId<HTMLInputElement>('ev-ends');
    fuoco(inizio, true);
    type(inizio, '2030-03-10T10:00');
    fuoco(inizio, false);
    type(fine, '2030-03-10T12:00');

    type(inizio, '2030-04-02T09:00');
    expect(fine.value).toBe('2030-04-02T11:00');
  });

  it('se l inizio non cambia, la fine resta', () => {
    renderWizard();
    const inizio = byId<HTMLInputElement>('ev-starts');
    const fine = byId<HTMLInputElement>('ev-ends');
    type(fine, '2030-03-10T18:00');
    fuoco(inizio, true);
    fuoco(inizio, false);
    expect(fine.value).toBe('2030-03-10T18:00');
  });
});
