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

/**
 * Al passo con questa etichetta. I quattro passi e le impostazioni avanzate
 * sono nella barra; «Permessi» e «Contenuti» di una volta sono sezioni delle
 * impostazioni avanzate, che qui si aprono.
 */
function goToStep(label: string) {
  const nav = container.querySelector<HTMLElement>(`nav[aria-label="${w.stepsAriaLabel}"]`)!;
  const vai = (testo: string) => {
    const b = Array.from(nav.querySelectorAll<HTMLButtonElement>('button')).find((el) =>
      el.textContent?.includes(testo),
    );
    if (!b) throw new Error(`nessun passo «${testo}»`);
    click(b);
  };
  const sezione: Record<string, string> = {
    [w.steps.permissions]: 'participation',
    [w.steps.content]: 'content',
  };
  const passo: Record<string, string> = {
    [w.steps.base]: w.flow.steps.base,
    [w.steps.invites]: w.flow.steps.invites,
    [w.steps.review]: w.flow.steps.review,
  };
  const s = sezione[label];
  if (!s) {
    vai(passo[label] ?? label);
    return;
  }
  vai(w.flow.steps.advanced);
  apriSezione(s);
}

/** Apre una sezione delle impostazioni avanzate. */
function apriSezione(id: string) {
  const d = container.querySelector<HTMLDetailsElement>(`#wiz-avanzate-${id}`);
  if (!d) throw new Error(`nessuna sezione ${id}`);
  act(() => {
    d.open = true;
  });
}

/** L'organizzatore principale, nel passo «Persone». */
function organizzatore(nome = 'Mario Rossi', email = 'mario@example.org') {
  goToStep(w.steps.invites);
  type(byId<HTMLInputElement>('wiz-primary-name'), nome);
  type(byId<HTMLInputElement>('wiz-primary-email'), email);
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

    organizzatore();
    goToStep(w.steps.review);
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

    organizzatore();
    goToStep(w.steps.review);
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
      moderatorOrganization: null,
      moderatorOrganizationLogoUrl: null,
      moderatorPublicListed: false,
      accessMode: null,
      requireOrganization: false,
      requireOrganizationRole: false,
      requireOrganizationType: false,
    },
    organizers: [],
    eventModerators: [
      { id: 'mod-1', name: 'Anna Bianchi', email: 'anna@example.org', role: 'MODERATOR', personId: null, organizer: false, organization: null, organizationLogoUrl: null, publicListed: false },
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

describe('modifica — salvataggio da un passo intermedio', () => {
  it('si parte dal passo chiesto e si salva da lì, senza arrivare al riepilogo', async () => {
    fetchMock.mockImplementation(async () => json(200, {}));
    const evento: InitialEventShape = {
      id: 'evt-2',
      slug: 'evento-2',
      moderatorToken: 'token-primario',
      event: {
        title: { it: 'Evento di prova' },
        description: { it: 'Una descrizione valida per il wizard.' },
        startsAt: '2030-01-10T09:00:00.000Z',
        endsAt: '2030-01-10T10:00:00.000Z',
        timezone: 'Europe/Rome',
        maxParticipants: 50,
        dataRetentionDays: 30,
        postEventPublic: true,
        status: 'PUBLISHED',
      } as unknown as InitialEventShape['event'],
      organizers: [],
      eventModerators: [],
      invitations: [],
      materials: [],
      preEventQuestionnaire: null,
      postEventQuestionnaire: null,
    } as InitialEventShape;
    renderWizard({ mode: 'edit', initialEvent: evento, initialStep: 'permissions' });

    const attivo = container.querySelector(
      `nav[aria-label="${w.stepsAriaLabel}"] [aria-current="step"]`,
    );
    // Le impostazioni avanzate, con la sezione chiesta aperta.
    expect(attivo?.textContent).toContain(w.flow.steps.advanced);
    expect(container.querySelector<HTMLDetailsElement>('#wiz-avanzate-participation')?.open).toBe(true);
    await press(button(w.updateEvent));

    const put = (fetchMock.mock.calls as Array<[string, RequestInit]>).find(
      ([url, init]) => url === '/api/events/evt-2' && init?.method === 'PUT',
    );
    expect(put).toBeTruthy();
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('un evento che segue il sito per chi si iscrive continua a seguirlo, finche non si sceglie', async () => {
    fetchMock.mockImplementation(async () => json(200, {}));
    const evento = {
      id: 'evt-4',
      slug: 'evento-4',
      moderatorToken: 'token-primario',
      event: {
        title: { it: 'Evento di prova' },
        description: { it: 'Una descrizione valida per il wizard.' },
        startsAt: '2030-01-10T09:00:00.000Z',
        endsAt: '2030-01-10T10:00:00.000Z',
        timezone: 'Europe/Rome',
        maxParticipants: 50,
        dataRetentionDays: 30,
        postEventPublic: true,
        status: 'PUBLISHED',
        accessMode: null,
        requireOrganization: false,
        requireOrganizationRole: false,
        requireOrganizationType: false,
      },
      organizers: [],
      eventModerators: [],
      invitations: [],
      materials: [],
      preEventQuestionnaire: null,
      postEventQuestionnaire: null,
    } as unknown as InitialEventShape;
    renderWizard({ mode: 'edit', initialEvent: evento, initialStep: 'invites' });
    const corpo = () => {
      const put = (fetchMock.mock.calls as Array<[string, RequestInit]>).filter(
        ([url, init]) => url === '/api/events/evt-4' && init?.method === 'PUT',
      ).at(-1);
      return JSON.parse(String(put?.[1].body)) as Record<string, unknown>;
    };
    await press(button(w.updateEvent));
    expect(corpo()).not.toHaveProperty('accessMode');
  });

  it('una scelta fissata resta fissata tornandoci, anche se coincide con il sito', async () => {
    fetchMock.mockImplementation(async () => json(200, {}));
    const evento = {
      id: 'evt-6',
      slug: 'evento-6',
      moderatorToken: 'token-primario',
      event: {
        title: { it: 'Evento di prova' },
        description: { it: 'Una descrizione valida per il wizard.' },
        startsAt: '2030-01-10T09:00:00.000Z',
        endsAt: '2030-01-10T10:00:00.000Z',
        timezone: 'Europe/Rome',
        maxParticipants: 50,
        dataRetentionDays: 30,
        postEventPublic: true,
        status: 'PUBLISHED',
        accessMode: 'OPEN',
        requireOrganization: false,
        requireOrganizationRole: false,
        requireOrganizationType: false,
      },
      organizers: [],
      eventModerators: [],
      invitations: [],
      materials: [],
      preEventQuestionnaire: null,
      postEventQuestionnaire: null,
    } as unknown as InitialEventShape;
    renderWizard({ mode: 'edit', initialEvent: evento, initialStep: 'invites', publicRegistrationEnabled: true });
    const g = messages.admin.guided;
    const sezione = container.querySelector('.wizard-iscrizione')!;
    const scelta = (testo: string) =>
      Array.from(sezione.querySelectorAll('label')).find(
        (l) => l.querySelector('.formato-scelta__titolo')?.textContent === testo,
      )!;
    click(scelta(g.access.invitation));
    click(scelta(g.access.open));
    await press(button(w.updateEvent));
    const put = (fetchMock.mock.calls as Array<[string, RequestInit]>)
      .filter(([url, init]) => url === '/api/events/evt-6' && init?.method === 'PUT')
      .at(-1);
    expect(JSON.parse(String(put?.[1].body))).not.toHaveProperty('accessMode');
  });

  it('con un link di conduzione chi partecipa si vede ma non si cambia; una chiamata istantanea non ne parla', () => {
    const base = {
      id: 'evt-5',
      slug: 'evento-5',
      moderatorToken: 'token-primario',
      event: {
        title: { it: 'Evento di prova' },
        description: { it: 'Una descrizione valida per il wizard.' },
        startsAt: '2030-01-10T09:00:00.000Z',
        endsAt: '2030-01-10T10:00:00.000Z',
        timezone: 'Europe/Rome',
        maxParticipants: 50,
        dataRetentionDays: 30,
        postEventPublic: true,
        status: 'PUBLISHED',
        accessMode: 'INVITATION',
        requireOrganization: false,
        requireOrganizationRole: false,
        requireOrganizationType: false,
      },
      organizers: [],
      eventModerators: [],
      invitations: [],
      materials: [],
      preEventQuestionnaire: null,
      postEventQuestionnaire: null,
    };
    renderWizard({
      mode: 'edit',
      initialEvent: base as unknown as InitialEventShape,
      initialStep: 'invites',
      viaToken: 'token-primario',
    });
    const sezione = container.querySelector('.wizard-iscrizione')!;
    expect(sezione.textContent).toContain(messages.admin.wizard.step3.accessStaffOnly);
    const radio = Array.from(sezione.querySelectorAll<HTMLInputElement>('input[type=radio]'));
    expect(radio.length).toBe(2);
    expect(radio.every((r) => r.disabled)).toBe(true);

    act(() => root.unmount());
    root = createRoot(container);
    renderWizard({
      mode: 'edit',
      initialEvent: { ...base, event: { ...base.event, eventType: 'INSTANT' } } as unknown as InitialEventShape,
      initialStep: 'invites',
    });
    expect(container.querySelector('.wizard-iscrizione')).toBeNull();
  });

  it('con un errore in un altro passo non salva e porta a quel passo', async () => {
    fetchMock.mockImplementation(async () => json(200, {}));
    const evento = {
      id: 'evt-3',
      slug: 'evento-3',
      moderatorToken: 'token-primario',
      event: {
        title: { it: '' },
        description: { it: 'Una descrizione valida per il wizard.' },
        startsAt: '2030-01-10T09:00:00.000Z',
        endsAt: '2030-01-10T10:00:00.000Z',
        timezone: 'Europe/Rome',
        maxParticipants: 50,
        dataRetentionDays: 30,
        postEventPublic: true,
        status: 'PUBLISHED',
      },
      organizers: [],
      eventModerators: [],
      invitations: [],
      materials: [],
      preEventQuestionnaire: null,
      postEventQuestionnaire: null,
    } as unknown as InitialEventShape;
    renderWizard({ mode: 'edit', initialEvent: evento, initialStep: 'permissions' });

    await press(button(w.updateEvent));

    const put = (fetchMock.mock.calls as Array<[string, RequestInit]>).find(
      ([, init]) => init?.method === 'PUT',
    );
    expect(put).toBeUndefined();
    const attivo = container.querySelector(
      `nav[aria-label="${w.stepsAriaLabel}"] [aria-current="step"]`,
    );
    expect(attivo?.textContent).toContain(w.flow.steps.base);
  });

  it('in creazione il passo di partenza si ignora', () => {
    renderWizard({ initialStep: 'review' });
    const attivo = container.querySelector(
      `nav[aria-label="${w.stepsAriaLabel}"] [aria-current="step"]`,
    );
    expect(attivo?.textContent).toContain(w.flow.steps.base);
  });
});

describe('passo Permessi — lavagna', () => {
  beforeEach(() => {
    // Le impostazioni avanzate montano anche i contenuti, che leggono i
    // modelli di domande.
    fetchMock.mockImplementation(async () => json(200, { rows: [] }));
  });

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
    organizzatore();
    goToStep(w.steps.review);
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
    organizzatore();
    goToStep(w.steps.review);
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
    const collegati = descritto.split(' ').map((id) => document.getElementById(id));
    expect(collegati.some((el) => el?.classList.contains('invalid-feedback'))).toBe(true);
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

  it('«Pubblica» senza organizzatore principale: porta al passo Persone, fuoco sul primo campo mancante', async () => {
    renderWizard();
    type(byId<HTMLInputElement>('ev-title'), 'Evento di prova');
    type(byId<HTMLTextAreaElement>('ev-description-it'), 'Una descrizione valida per il wizard.');
    goToStep(w.steps.review);
    await press(button(w.publish));

    expect(fetchMock).not.toHaveBeenCalled();
    const attivo = document.activeElement as HTMLElement;
    expect(attivo.id).toBe('wiz-primary-name');
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
    organizzatore();
    // Il ruolo proposto per una persona nuova è «Relatore».
    type(byId<HTMLInputElement>('person-name'), 'Relatore 1');
    type(byId<HTMLInputElement>('person-email'), 'relatore@example.org');
    // «Aggiungi» del modulo delle persone: quello che segue il suo campo email.
    const bloccoPersone = byId('person-email').closest('.row') ?? container;
    await press(button(w.step3.add, bloccoPersone));
    goToStep(w.steps.review);
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
    organizzatore();
    goToStep(w.steps.review);
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
      type(byId<HTMLInputElement>('person-name'), 'Relatore 1');
      type(byId<HTMLInputElement>('person-email'), 'relatore@example.org');
      await press(button(w.step3.add, byId('person-email').closest('.row') ?? container));
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

describe('passo «Quando» — la fine segue l inizio', () => {
  function fuoco(el: HTMLElement, dentro: boolean) {
    act(() => {
      if (dentro) el.focus();
      else el.blur();
    });
  }

  it('scrivendo nel campo, la fine si sposta all uscita con la durata che aveva, ignorando i valori intermedi', () => {
    renderWizard();
    goToStep(w.flow.steps.schedule);
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
    goToStep(w.flow.steps.schedule);
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
    goToStep(w.flow.steps.schedule);
    const inizio = byId<HTMLInputElement>('ev-starts');
    const fine = byId<HTMLInputElement>('ev-ends');
    type(fine, '2030-03-10T18:00');
    fuoco(inizio, true);
    fuoco(inizio, false);
    expect(fine.value).toBe('2030-03-10T18:00');
  });
});

/**
 * Il modello decide i default, e il wizard chiede solo l'evento: la
 * registrazione non parte mai da sola, e chi registra ha trascrizione,
 * sintesi, traduzione e tracce per partecipante; le lingue di traduzione si
 * scelgono nel riepilogo.
 */
describe('creazione — i default del modello', () => {
  const CREATO = { id: 'evt-tpl', slug: 'evento-modello', moderatorToken: 'token' };
  const modello: NonNullable<WizardProps['template']> = {
    id: 'tpl-webinar',
    name: 'Webinar pubblico',
    qaEnabled: true,
    chatEnabled: true,
    recordingEnabled: true,
    // Un modello salvato prima: avviava da solo. Il wizard non lo segue.
    autoStartRecording: true,
    participantsCanUnmute: false,
    participantsCanStartVideo: false,
    participantsCanShareScreen: false,
    maxParticipants: 300,
    aiTranscriptEnabled: true,
    aiSummaryEnabled: true,
    aiTranslationEnabled: true,
    multitrackRecordingEnabled: true,
    aiTargetLocales: null,
  };

  beforeEach(() => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url === '/api/events' && init.method === 'POST') return json(201, CREATO);
      return json(200, {});
    });
  });

  function payloadInviato(): Record<string, unknown> {
    const post = (fetchMock.mock.calls as Array<[string, RequestInit]>).find(
      ([url, init]) => url === '/api/events' && init?.method === 'POST',
    );
    return JSON.parse(String(post?.[1].body)) as Record<string, unknown>;
  }

  function compila() {
    type(byId<HTMLInputElement>('ev-title'), 'Evento di prova');
    type(byId<HTMLTextAreaElement>('ev-description-it'), 'Una descrizione valida per il wizard.');
    organizzatore();
  }

  it('dice quale modello e in uso e porta a cambiarlo', () => {
    const cambia = vi.fn();
    renderWizard({ template: modello, onChangeTemplate: cambia });
    expect(container.querySelector('.wizard-modello')?.textContent).toContain('Webinar pubblico');
    click(button(w.flow.changeTemplate));
    expect(cambia).toHaveBeenCalledTimes(1);
  });

  it('nel riepilogo: registrazione col pulsante REC, mai automatica, e le funzioni AI accese', async () => {
    renderWizard({ template: modello, aiPipelineEnabled: true, defaultTargetLocales: 'en,fr,es,de' });
    compila();
    goToStep(w.steps.review);
    const anteprima = container.querySelector<HTMLElement>('.anteprima-evento')!;
    expect(anteprima.textContent).toContain(w.flow.recordingManual);
    expect(anteprima.textContent).toContain(messages.admin.form.aiSummaryEnabled);

    await press(button(w.saveDraft));
    const payload = payloadInviato();
    expect(payload).toMatchObject({
      recordingEnabled: true,
      autoStartRecording: false,
      aiTranscriptEnabled: true,
      aiSummaryEnabled: true,
      aiTranslationEnabled: true,
      multitrackRecordingEnabled: true,
      aiTargetLocales: 'en,fr,es,de',
    });
  });

  it('il sopratitolo si spiega sotto il titolo, e con «|» si vede e si sceglie', async () => {
    renderWizard({ template: modello });
    const s1 = messages.admin.wizard.step1;
    expect(container.textContent).toContain(s1.kickerHint);
    expect(container.querySelector('#ev-parse-title-kicker')).toBeNull();
    type(byId<HTMLInputElement>('ev-title'), 'Ciclo | Il primo incontro');
    const casella = byId<HTMLInputElement>('ev-parse-title-kicker');
    expect(casella.checked).toBe(false);
    const anteprima = () => container.querySelector('.wizard-sopratitolo__titolo')!;
    expect(anteprima().querySelector('.event-title-kicker')).toBeNull();
    click(casella);
    expect(anteprima().querySelector('.event-title-kicker')?.textContent).toBe('Ciclo');
    expect(anteprima().querySelector('.event-title-main')?.textContent).toBe('Il primo incontro');
    type(byId<HTMLTextAreaElement>('ev-description-it'), 'Una descrizione valida per il wizard.');
    organizzatore();
    goToStep(w.steps.review);
    // Anche il riepilogo mostra il titolo come apparira'.
    expect(container.querySelector('.anteprima-evento__titolo .event-title-kicker')?.textContent).toBe('Ciclo');
    await press(button(w.saveDraft));
    expect(payloadInviato()).toMatchObject({ parseTitleKicker: true });
  });

  it('chi si iscrive: segue il sito finche non si sceglie, e solo su invito lo dice ovunque', async () => {
    const g = messages.admin.guided;
    const s3 = messages.admin.wizard.step3;
    renderWizard({ template: { ...modello, accessMode: null }, publicRegistrationEnabled: true });
    compila();
    goToStep(w.steps.invites);
    const sezione = container.querySelector('.wizard-iscrizione')!;
    expect(sezione.textContent).toContain(s3.accessSiteDefault);
    const scelta = (testo: string) =>
      Array.from(sezione.querySelectorAll('label')).find(
        (l) => l.querySelector('.formato-scelta__titolo')?.textContent === testo,
      )!;
    expect(scelta(g.access.open).querySelector('input')!.checked).toBe(true);

    click(scelta(g.access.invitation));
    expect(sezione.textContent).not.toContain(s3.accessSiteDefault);
    expect(sezione.textContent).toContain(s3.accessNoInvitees);
    // Solo su invito l'elenco degli invitati e' aperto: e' chi puo' iscriversi.
    const inviti = Array.from(container.querySelectorAll('details.wizard-group')).find((d) =>
      d.textContent?.includes(s3.invitationsHeading),
    ) as HTMLDetailsElement;
    expect(inviti.open).toBe(true);

    click(byId<HTMLInputElement>(sezione.querySelector('input[type=checkbox]')!.id));
    goToStep(w.steps.review);
    const anteprima = container.querySelector('.anteprima-evento')!;
    expect(anteprima.textContent).toContain(w.flow.accessInvitation.replace('{count}', '0'));
    expect(anteprima.textContent).toContain(w.flow.addInvitees);
    expect(anteprima.textContent).toContain(w.flow.askOrganization);

    await press(button(w.saveDraft));
    expect(payloadInviato()).toMatchObject({ accessMode: 'INVITATION', requireOrganization: true });
  });

  it('una scelta ereditata dal sito si conferma con un clic, e «Cambia formato» la porta con se', async () => {
    const g = messages.admin.guided;
    const cambia = vi.fn();
    renderWizard({
      template: { ...modello, accessMode: null },
      publicRegistrationEnabled: false,
      onChangeTemplate: cambia,
    });
    compila();
    goToStep(w.steps.invites);
    const sezione = container.querySelector('.wizard-iscrizione')!;
    const invito = Array.from(sezione.querySelectorAll('label')).find(
      (l) => l.querySelector('.formato-scelta__titolo')?.textContent === g.access.invitation,
    )!;
    // Il sito e' solo su invito: la scelta appare gia' fatta, ma non e' salvata.
    expect(invito.querySelector('input')!.checked).toBe(true);
    click(invito);
    expect(sezione.textContent).not.toContain(messages.admin.wizard.step3.accessSiteDefault);
    // Provata l'altra scelta e tornati indietro, si torna a seguire il sito.
    const aperto = Array.from(sezione.querySelectorAll('label')).find(
      (l) => l.querySelector('.formato-scelta__titolo')?.textContent === g.access.open,
    )!;
    click(aperto);
    click(invito);
    expect(sezione.textContent).toContain(messages.admin.wizard.step3.accessSiteDefault);
    click(button(w.flow.changeTemplate));
    expect(cambia).toHaveBeenCalledWith({ invitati: true });
  });

  it('senza lingue in cui tradurre, la traduzione non si accende da sola', async () => {
    renderWizard({ template: modello, aiPipelineEnabled: true, defaultTargetLocales: 'it' });
    compila();
    goToStep(w.steps.review);
    expect(container.textContent).not.toContain(messages.admin.form.aiTargetLocales);
    await press(button(w.saveDraft));
    expect(payloadInviato()).toMatchObject({ aiTranscriptEnabled: true, aiTranslationEnabled: false });
  });

  it('le lingue di traduzione si cambiano nel riepilogo', async () => {
    renderWizard({ template: modello, aiPipelineEnabled: true, defaultTargetLocales: 'en,fr' });
    compila();
    goToStep(w.steps.review);
    // Le lingue si aprono a richiesta, nell'anteprima.
    click(button(w.flow.changeLanguages));
    const francese = Array.from(container.querySelectorAll<HTMLInputElement>('#aiTargetLocales input[type="checkbox"]')).find(
      (el) => el.labels?.[0]?.getAttribute('lang') === 'fr',
    )!;
    click(francese);
    await press(button(w.saveDraft));
    expect(payloadInviato().aiTargetLocales).toBe('en');
  });

  it('senza modello, accendere la registrazione accende anche trascrizione, sintesi, traduzione e tracce', async () => {
    renderWizard({ aiPipelineEnabled: true, defaultTargetLocales: 'en,de' });
    compila();
    goToStep(w.steps.permissions);
    click(container.querySelector<HTMLElement>(`[aria-label="${messages.admin.form.recordingEnabled}"]`)!);
    // L'avvio automatico non si offre piu'.
    expect(container.querySelector(`[aria-label="${messages.admin.form.autoStartRecording}"]`)).toBeNull();
    expect(container.textContent).toContain(w.step2.recordingManualNote);
    goToStep(w.steps.review);
    await press(button(w.saveDraft));
    expect(payloadInviato()).toMatchObject({
      recordingEnabled: true,
      autoStartRecording: false,
      aiTranscriptEnabled: true,
      aiSummaryEnabled: true,
      aiTranslationEnabled: true,
      multitrackRecordingEnabled: true,
      aiTargetLocales: 'en,de',
    });
  });

  it('la bozza di un formato si offre tornando sullo stesso, non su un altro', () => {
    localStorage.setItem('pa-wizard-draft:new:tpl-altro', JSON.stringify({ title: { it: 'Altro' } }));
    renderWizard({ template: modello });
    expect(container.textContent).not.toContain(w.draftFound);

    act(() => root.unmount());
    root = createRoot(container);
    localStorage.setItem(`pa-wizard-draft:new:${modello.id}`, JSON.stringify({ title: { it: 'Stesso formato' } }));
    renderWizard({ template: modello });
    click(button(w.draftRestore));
    expect(byId<HTMLInputElement>('ev-title').value).toBe('Stesso formato');
  });

  it('la bozza della versione precedente (una per tutti) si offre ancora, e ripresa passa al formato', () => {
    localStorage.setItem('pa-wizard-draft:new', JSON.stringify({ title: { it: 'Di prima' } }));
    renderWizard({ template: modello });
    click(button(w.draftRestore));
    expect(byId<HTMLInputElement>('ev-title').value).toBe('Di prima');
    expect(localStorage.getItem('pa-wizard-draft:new')).toBeNull();
  });

  it('«Cambia formato» porta solo cio che si e scritto, e solo per poco', () => {
    const cambia = vi.fn();
    renderWizard({ template: modello, onChangeTemplate: cambia });
    type(byId<HTMLInputElement>('ev-title'), 'Evento portato');
    click(button(w.flow.changeTemplate));
    expect(cambia).toHaveBeenCalledTimes(1);
    const portati = JSON.parse(localStorage.getItem('pa-wizard-draft:trasloco')!) as {
      at: number;
      dati: Record<string, unknown>;
    };
    // Solo il titolo: descrizione e date erano quelle di partenza.
    expect(Object.keys(portati.dati)).toEqual(['title']);

    // Il formato nuovo li riprende.
    act(() => root.unmount());
    root = createRoot(container);
    renderWizard({ template: { ...modello, id: 'tpl-nuovo', name: 'Nuovo' } });
    expect(byId<HTMLInputElement>('ev-title').value).toBe('Evento portato');
    expect(localStorage.getItem('pa-wizard-draft:trasloco')).toBeNull();
    // Lo dice, e si puo' ripartire dai valori del formato.
    expect(container.textContent).toContain(w.flow.carriedOver);
    click(button(w.flow.startOver));
    expect(byId<HTMLInputElement>('ev-title').value).toBe('');

    // Scaduti, non si riprendono.
    localStorage.setItem(
      'pa-wizard-draft:trasloco',
      JSON.stringify({ at: Date.now() - 60 * 60 * 1000, dati: { title: { it: 'Vecchio' } } }),
    );
    act(() => root.unmount());
    root = createRoot(container);
    renderWizard({ template: modello });
    expect(byId<HTMLInputElement>('ev-title').value).toBe('');
  });
});

/**
 * Gli obbligatori si fanno notare prima di premere un pulsante: lampeggiano
 * finche' sono vuoti, la barra dice quali passi sono da completare, e il
 * riepilogo elenca cio' che manca con il link al campo.
 */
describe('obbligatori — si fanno notare', () => {
  beforeEach(() => {
    fetchMock.mockImplementation(async () => json(200, { rows: [] }));
  });

  it('il titolo vuoto lampeggia con la riga «serve per salvare», che sparisce scrivendo', () => {
    renderWizard();
    const campo = byId<HTMLInputElement>('ev-title').closest('.wizard-campo')!;
    expect(campo).toHaveClass('wizard-campo--vuoto');
    expect(campo.textContent).toContain(w.flow.requiredToSave);
    expect(byId('ev-title').getAttribute('aria-describedby')?.split(' ')).toContain('ev-title-promemoria');
    type(byId<HTMLInputElement>('ev-title'), 'Evento di prova');
    expect(byId('ev-title').getAttribute('aria-describedby')?.split(' ')).not.toContain('ev-title-promemoria');
    expect(campo).not.toHaveClass('wizard-campo--vuoto');
    expect(campo.textContent).not.toContain(w.flow.requiredToSave);
  });

  it('la barra dei passi dice quali sono da completare', () => {
    renderWizard();
    const nav = container.querySelector<HTMLElement>(`nav[aria-label="${w.stepsAriaLabel}"]`)!;
    const passo = (nome: string) =>
      Array.from(nav.querySelectorAll('button')).find((b) => b.textContent?.includes(nome))!;
    expect(passo(w.flow.steps.base).textContent).toContain(w.flow.toComplete);
    // L'organizzatore principale serve per pubblicare: anche «Persone» e' da completare.
    expect(passo(w.flow.steps.invites).textContent).toContain(w.flow.toComplete);
    expect(passo(w.flow.steps.schedule).textContent).not.toContain(w.flow.toComplete);
  });

  it('il riepilogo elenca cio che manca, e ogni voce porta al suo campo', () => {
    renderWizard();
    type(byId<HTMLTextAreaElement>('ev-description-it'), 'Una descrizione valida per il wizard.');
    goToStep(w.steps.review);
    const elenco = container.querySelector('.wizard-mancanti')!;
    expect(elenco.textContent).toContain(messages.admin.form.titleLabel);
    expect(elenco.textContent).toContain(w.flow.fieldOrganizerEmail);
    click(button(messages.admin.form.titleLabel, elenco));
    expect(document.activeElement?.id).toBe('ev-title');
  });

  it('il nome dell organizzatore vuoto dice che serve per pubblicare', () => {
    renderWizard();
    goToStep(w.steps.invites);
    const campo = byId<HTMLInputElement>('wiz-primary-name').closest('.wizard-campo')!;
    expect(campo).toHaveClass('wizard-campo--vuoto');
    expect(campo.textContent).toContain(w.flow.requiredToPublish);
  });
});
