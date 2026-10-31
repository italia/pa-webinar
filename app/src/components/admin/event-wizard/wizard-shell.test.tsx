import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';
import { ISTANZA_PREDEFINITA } from '@/lib/capacity/model';

import EventWizard, { type InitialEventShape, type WizardProps } from './wizard-shell';

/**
 * Il wizard dell'evento dal punto di vista di chi lo usa: cosa vede quando il
 * server rifiuta i dati, e cosa succede a una revoca che non va a buon fine.
 */

const push = vi.fn();
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push }),
  percorso: (p: string) => p,
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
const toastError = vi.fn();
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ error: toastError, success: vi.fn(), info: vi.fn() }),
}));

// Il ritaglio vero disegna su un canvas: lo sostituisce uno che conferma subito.
vi.mock('@/components/ui/image-crop-dialog', () => ({
  default: function RitaglioFinto(props: { onConferma: (f: File) => void }) {
    return (
      <button
        type="button"
        onClick={() =>
          props.onConferma(new File([new Uint8Array([0xff, 0xd8, 0xff])], 'foto.jpg', { type: 'image/jpeg' }))
        }
      >
        conferma-ritaglio
      </button>
    );
  },
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
  defaultRetentionDays: 30,
  capacita: { ...ISTANZA_PREDEFINITA, instanceBridges: 1 },
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
 * Al passo indicato per nome, o con questa etichetta. I quattro passi e le
 * impostazioni avanzate sono nella barra; «Permessi» e «Contenuti» di una
 * volta sono sezioni delle impostazioni avanzate, che qui si aprono.
 */
function goToStep(label: 'base' | 'invites' | 'review' | 'permissions' | 'content' | (string & {})) {
  const nav = container.querySelector<HTMLElement>(`nav[aria-label="${w.stepsAriaLabel}"]`)!;
  const vai = (testo: string) => {
    const b = Array.from(nav.querySelectorAll<HTMLButtonElement>('button')).find((el) =>
      el.textContent?.includes(testo),
    );
    if (!b) throw new Error(`nessun passo «${testo}»`);
    click(b);
  };
  const sezione: Record<string, string> = {
    content: 'content',
    recording: 'recording',
  };
  const passo: Record<string, string> = {
    base: w.flow.steps.base,
    invites: w.flow.steps.invites,
    permissions: w.flow.steps.permissions,
    review: w.flow.steps.review,
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
  goToStep('invites');
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

/** Le chiamate al server tranne la lettura della libreria dei modelli di
 *  domande, che il riepilogo fa per contare le domande. */
function chiamateAlServer() {
  return (fetchMock.mock.calls as Array<[string, RequestInit?]>).filter(
    ([url]) => !String(url).startsWith('/api/admin/question-templates'),
  );
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
    goToStep('review');
    await press(button(w.publish));

    expect(alertText()).toBe(w.validationFailed);
    expect(chiamateAlServer()).toHaveLength(0);
    expect(byId('ev-description-it')).toHaveClass('is-invalid');
    expect(container.querySelector('.invalid-feedback')?.textContent).toBe(
      w.step1.validation.descriptionRequired.replace('{min}', '10'),
    );
  });

  it('la bozza chiede la stessa descrizione: la creazione salva comunque l evento', async () => {
    renderWizard();
    type(byId<HTMLInputElement>('ev-title'), 'Evento di prova');
    goToStep('review');
    await press(button(w.saveDraft));

    expect(alertText()).toBe(w.validationFailed);
    expect(chiamateAlServer()).toHaveLength(0);
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
    goToStep('review');
    await press(button(w.publish));

    expect(chiamateAlServer()).toHaveLength(1);
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
      moderatorPhotoId: null,
      accessMode: null,
      requireOrganization: false,
      requireOrganizationRole: false,
      requireOrganizationType: false,
    },
    organizers: [],
    eventModerators: [
      { id: 'mod-1', name: 'Anna Bianchi', email: 'anna@example.org', role: 'MODERATOR', personId: null, organizer: false, organization: null, organizationLogoUrl: null, publicListed: false, photoId: null },
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

    goToStep('invites');
    const riga = Array.from(container.querySelectorAll('li')).find((li) =>
      li.textContent?.includes('Anna Bianchi'),
    )!;
    click(button(w.step3.remove, riga));

    goToStep('review');
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
    // Il passo «Permessi».
    expect(attivo?.textContent).toContain(w.flow.steps.permissions);
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
    goToStep('permissions');

    expect(interruttoreLavagna()).toBeDisabled();
    expect(container.textContent).toContain(messages.admin.form.whiteboardUnavailable);
  });

  it('con il servizio lavagna l interruttore funziona come prima', () => {
    renderWizard({ whiteboardInfraReady: true });
    goToStep('permissions');

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
    goToStep('permissions');

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
    goToStep('review');
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
    goToStep('review');
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
    goToStep('review');
    await press(button(w.publish));

    expect(chiamateAlServer()).toHaveLength(0);
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
    goToStep('review');
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
    goToStep('review');
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
      goToStep('invites');
      type(byId<HTMLInputElement>('person-name'), 'Relatore 1');
      type(byId<HTMLInputElement>('person-email'), 'relatore@example.org');
      await press(button(w.step3.add, byId('person-email').closest('.row') ?? container));
      goToStep('review');
      await press(button(w.saveDraft));
    } finally {
      setItem.mockRestore();
    }
    expect(toastError).toHaveBeenCalledWith(
      w.partialFailure.replace('{items}', w.resources.speakers),
    );
  });
});

/**
 * Le lingue dell'evento nel passo «Evento»: un solo elenco (aiTargetLocales)
 * per le schede, la traduzione automatica al salvataggio (la decide il
 * server) e quella di sottotitoli e sintesi. Il wizard manda le lingue che ha
 * toccato (textEdits): delle altre il server tiene il testo che ha.
 */
describe('lingue dell evento e traduzione automatica', () => {
  const tt = messages.admin.textTranslation;
  const CREATO = { id: 'evt-lingue', slug: 'evt-lingue', moderatorToken: 'tok-l' };

  function compila() {
    type(byId<HTMLInputElement>('ev-title'), 'Evento di prova');
    type(byId<HTMLTextAreaElement>('ev-description-it'), 'Una descrizione valida per il wizard.');
  }
  function payload(metodo: 'POST' | 'PUT'): Record<string, unknown> {
    const chiamata = (fetchMock.mock.calls as Array<[string, RequestInit]>).find(
      ([url, init]) => init?.method === metodo && /^\/api\/events(\/[^/]+)?$/.test(url),
    );
    return JSON.parse(String(chiamata?.[1].body)) as Record<string, unknown>;
  }
  const scheda = (nome: string) =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((b) =>
      b.textContent?.startsWith(nome),
    )!;

  it('creazione, motore acceso: le lingue senza testo si traducono al salvataggio, e lo decide il server', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      if (String(input) === '/api/events' && init.method === 'POST') return json(201, CREATO);
      return json(200, {});
    });
    renderWizard({
      textTranslationAvailable: true,
      enabledLocales: ['it', 'en', 'de'],
      defaultTargetLocales: 'en,de,uk',
    });
    expect(container.querySelector('.lingue-evento__riga')!.textContent).toContain('English · Deutsch');
    expect(container.textContent).toContain(tt.helpAuto);
    expect(scheda('English').textContent).toContain(tt.state.onSave);
    // Il campo dice la sua lingua, anche alle tecnologie assistive.
    click(scheda('English'));
    expect(byId('ev-title').getAttribute('lang')).toBe('en');
    expect(container.querySelector('label[for="ev-title"]')!.textContent).toContain(
      tt.titleLabel.replace('{language}', 'English'),
    );
    expect(byId('ev-description-en').getAttribute('lang')).toBe('en');
    expect(container.textContent).toContain(
      tt.panel.onSave.replace('{source}', 'italiano'),
    );
    click(scheda('Italiano'));
    compila();
    organizzatore();
    goToStep('review');
    await press(button(w.saveDraft));

    expect(payload('POST')).toMatchObject({
      aiTargetLocales: 'en,de,uk',
      textEdits: { touched: [] },
    });
    // Nessuna richiesta di traduzione dal browser: la chiede il server.
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/text-translation'))).toBe(false);
    expect(sessionStorage.getItem(`pa-wizard-unsaved:${CREATO.id}`)).toBeNull();
  });

  it('motore spento: nessuna promessa di traduzione; l amministrazione vede dove accenderla', () => {
    renderWizard({ enabledLocales: ['it', 'en'], defaultTargetLocales: 'en' });
    expect(container.textContent).not.toContain(tt.helpAuto);
    expect(container.textContent).toContain(tt.helpManual.replace('{source}', 'italiano'));
    expect(scheda('English').textContent).toContain(tt.state.empty);
    expect(container.textContent).not.toContain(tt.engineOff);

    act(() => root.unmount());
    root = createRoot(container);
    renderWizard({ enabledLocales: ['it', 'en'], defaultTargetLocales: 'en', isSiteAdmin: true });
    expect(container.textContent).toContain(tt.engineOff);
  });

  const evento: InitialEventShape = {
    id: 'evt-l',
    slug: 'evento-lingue',
    moderatorToken: 'token-l',
    event: {
      title: { it: 'Evento di prova', en: 'Test event', de: 'Testveranstaltung' },
      description: {
        it: 'Una descrizione valida per il wizard.',
        en: 'A valid description.',
        de: 'Eine gültige Beschreibung.',
      },
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
      aiTargetLocales: 'en,de',
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
      moderatorPhotoId: null,
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
  };
  const statoServer = {
    engine: 'available' as const,
    principale: 'it',
    lingue: [
      { code: 'it', page: true, event: true, state: 'principale' as const, origin: null, current: true },
      { code: 'en', page: true, event: true, state: 'machine' as const, origin: 'MACHINE' as const, current: true },
      { code: 'de', page: true, event: true, state: 'human' as const, origin: 'HUMAN' as const, current: true },
    ],
    job: null,
    testi: { title: {}, description: {} },
  };

  it('modifica: manda solo le lingue toccate; «Segna come riletta» tocca la lingua', async () => {
    fetchMock.mockImplementation(async () => json(200, {}));
    renderWizard({
      mode: 'edit',
      initialEvent: structuredClone(evento),
      textTranslationAvailable: true,
      statoLingueIniziale: statoServer,
      enabledLocales: ['it', 'en', 'de'],
    });
    expect(scheda('English').textContent).toContain(tt.state.machine);
    expect(scheda('Deutsch').textContent).toContain(tt.state.human);

    goToStep('review');
    await press(button(w.updateEvent));
    expect(payload('PUT')).toMatchObject({ textEdits: { touched: [] }, aiTargetLocales: 'en,de' });

    fetchMock.mockClear();
    goToStep('base');
    click(scheda('English'));
    // Da tastiera: il pulsante premuto sparisce con l'avviso, e il fuoco va
    // sulla scheda della lingua, non sulla pagina; il nuovo stato si annuncia.
    button(tt.markReviewed).focus();
    click(button(tt.markReviewed));
    expect(scheda('English').textContent).toContain(tt.state.human);
    expect(document.activeElement).toBe(scheda('English'));
    expect(container.querySelector('#aiTargetLocales [role="status"]')!.textContent).toBe(
      tt.status.item.replace('{language}', 'English').replace('{state}', tt.stateLower.human),
    );
    click(scheda('Deutsch'));
    type(byId<HTMLInputElement>('ev-title'), 'Neuer Titel');
    goToStep('review');
    await press(button(w.updateEvent));
    expect(payload('PUT')).toMatchObject({
      textEdits: { touched: ['de', 'en'] },
      title: { it: 'Evento di prova', en: 'Test event', de: 'Neuer Titel' },
    });
  });

  it('il testo principale cambiato: la lingua scritta da una persona e da aggiornare; «Ritraduci» la svuota', async () => {
    fetchMock.mockImplementation(async () => json(200, {}));
    renderWizard({
      mode: 'edit',
      initialEvent: structuredClone(evento),
      textTranslationAvailable: true,
      statoLingueIniziale: statoServer,
      enabledLocales: ['it', 'en', 'de'],
    });
    type(byId<HTMLInputElement>('ev-title'), 'Un altro evento');
    expect(scheda('Deutsch').textContent).toContain(tt.state.stale);
    expect(scheda('English').textContent).toContain(tt.state.onSave);
    click(scheda('Deutsch'));
    click(button(tt.retranslate));
    button(tt.retranslateConfirm).focus();
    click(button(tt.retranslateConfirm));
    expect(byId<HTMLInputElement>('ev-title').value).toBe('');
    expect(scheda('Deutsch').textContent).toContain(tt.state.onSave);
    expect(document.activeElement).toBe(scheda('Deutsch'));
    expect(container.querySelector('#aiTargetLocales [role="status"]')!.textContent).toBe(
      tt.status.item.replace('{language}', 'Deutsch').replace('{state}', tt.stateLower.onSave),
    );
    goToStep('review');
    await press(button(w.updateEvent));
    const corpo = payload('PUT');
    expect(corpo.textEdits).toEqual({ touched: ['de'] });
    expect((corpo.title as Record<string, string>).de).toBe('');
  });

  it('togliere una lingua con un testo chiede conferma, e al salvataggio il testo se ne va', async () => {
    fetchMock.mockImplementation(async () => json(200, {}));
    renderWizard({
      mode: 'edit',
      initialEvent: structuredClone(evento),
      enabledLocales: ['it', 'en', 'de'],
    });
    click(byId('ev-lingue-cambia'));
    const deutsch = Array.from(container.querySelectorAll<HTMLInputElement>('#aiTargetLocales input[type="checkbox"]')).find(
      (c) => c.labels?.[0]?.getAttribute('lang') === 'de',
    )!;
    click(deutsch);
    expect(container.textContent).toContain(tt.removeQuestion.replace(/\{language\}/g, 'Deutsch'));
    expect(scheda('Deutsch')).toBeTruthy();
    click(button(tt.removeConfirm));
    expect(scheda('Deutsch')).toBeUndefined();
    goToStep('review');
    await press(button(w.updateEvent));
    const corpo = payload('PUT');
    expect(corpo.aiTargetLocales).toBe('en');
    expect(corpo.textEdits).toEqual({ touched: ['de'] });
    expect((corpo.title as Record<string, string>).de).toBe('');
  });

  it('una bozza ripresa tocca le lingue che cambia', async () => {
    fetchMock.mockImplementation(async () => json(200, {}));
    localStorage.setItem(
      'pa-wizard-draft:evt-l',
      JSON.stringify({ title: { ...evento.event.title, en: 'Draft title' } }),
    );
    renderWizard({ mode: 'edit', initialEvent: structuredClone(evento), enabledLocales: ['it', 'en', 'de'] });
    click(button(w.draftRestore));
    goToStep('review');
    await press(button(w.updateEvent));
    expect(payload('PUT').textEdits).toEqual({ touched: ['en'] });
  });

  it('una bozza ripresa riporta solo le lingue toccate: le altre restano quelle del server', async () => {
    fetchMock.mockImplementation(async () => json(200, {}));
    // La bozza ricordava l'inglese vuoto (prima della traduzione) e il tedesco scritto a mano.
    localStorage.setItem(
      'pa-wizard-draft:evt-l',
      JSON.stringify({
        title: { ...evento.event.title, en: '', de: 'Mein Titel' },
        lingueToccate: ['de'],
      }),
    );
    renderWizard({ mode: 'edit', initialEvent: structuredClone(evento), enabledLocales: ['it', 'en', 'de'] });
    click(button(w.draftRestore));
    goToStep('review');
    await press(button(w.updateEvent));
    const corpo = payload('PUT');
    expect(corpo.textEdits).toEqual({ touched: ['de'] });
    expect(corpo.title).toMatchObject({ en: 'Test event', de: 'Mein Titel' });
  });

  it('una bozza di prima senza lingue tiene quelle del modulo, e il testo delle altre lingue', async () => {
    fetchMock.mockImplementation(async () => json(200, {}));
    // La versione precedente salvava null per un evento senza traduzione,
    // senza dire le lingue toccate.
    localStorage.setItem(
      'pa-wizard-draft:evt-l',
      JSON.stringify({ title: evento.event.title, description: evento.event.description, aiTargetLocales: null }),
    );
    renderWizard({
      mode: 'edit',
      initialEvent: { ...structuredClone(evento), event: { ...evento.event, aiTargetLocales: null } },
      enabledLocales: ['it', 'en', 'de'],
      defaultTargetLocales: 'en,de',
    });
    click(button(w.draftRestore));
    expect(container.querySelector('.lingue-evento__riga')!.textContent).toContain('English · Deutsch');
    goToStep('review');
    await press(button(w.updateEvent));
    const corpo = payload('PUT');
    expect(corpo.aiTargetLocales).toBe('en,de');
    expect(corpo.textEdits).toEqual({ touched: [] });
    expect(corpo.title).toMatchObject({ en: 'Test event', de: 'Testveranstaltung' });
  });

  it('creazione: una bozza di prima senza lingue parte da quelle del sito', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      if (String(input) === '/api/events' && init.method === 'POST') return json(201, CREATO);
      return json(200, {});
    });
    localStorage.setItem(
      'pa-wizard-draft:new',
      JSON.stringify({ title: { it: 'Evento di prova' }, aiTargetLocales: null }),
    );
    renderWizard({ enabledLocales: ['it', 'en', 'de'], defaultTargetLocales: 'en,de' });
    click(button(w.draftRestore));
    compila();
    organizzatore();
    goToStep('review');
    await press(button(w.saveDraft));
    expect(payload('POST').aiTargetLocales).toBe('en,de');
  });

  it('con il link di conduzione le lingue toccate restano tali dopo il salvataggio', async () => {
    let revocaRiesce = false;
    fetchMock.mockImplementation(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
      if (init.method === 'DELETE') return revocaRiesce ? json(200, {}) : json(500, {});
      return json(200, {});
    });
    renderWizard({
      mode: 'edit',
      viaToken: 'token-l',
      initialEvent: {
        ...structuredClone(evento),
        eventModerators: [
          { id: 'mod-t', name: 'Anna Bianchi', email: 'anna@example.org', role: 'MODERATOR', personId: null, organizer: false, organization: null, organizationLogoUrl: null, publicListed: false, photoId: null },
        ],
      },
      enabledLocales: ['it', 'en', 'de'],
    });
    click(scheda('English'));
    type(byId<HTMLInputElement>('ev-title'), 'Edited title');
    goToStep('invites');
    const riga = Array.from(container.querySelectorAll('li')).find((li) => li.textContent?.includes('Anna Bianchi'))!;
    click(button(w.step3.remove, riga));
    goToStep('review');
    await press(button(w.updateEvent));
    expect(push).not.toHaveBeenCalled();
    fetchMock.mockClear();
    revocaRiesce = true;
    await press(button(w.updateEvent));
    // Nessuna lettura dell'amministrazione, e l'inglese resta di chi l'ha scritto.
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/text-translation'))).toBe(false);
    expect(payload('PUT').textEdits).toEqual({ touched: ['en'] });
  });

  it('nessuna lingua oltre la principale e una scelta: si salva vuoto, non «quelle del sito»', async () => {
    fetchMock.mockImplementation(async () => json(200, {}));
    renderWizard({
      mode: 'edit',
      initialEvent: { ...structuredClone(evento), event: { ...evento.event, title: { it: 'Evento di prova' }, description: { it: evento.event.description.it! } } },
      enabledLocales: ['it', 'en', 'de'],
    });
    click(byId('ev-lingue-cambia'));
    for (const l of ['en', 'de']) {
      const casella = Array.from(
        container.querySelectorAll<HTMLInputElement>('#aiTargetLocales input[type="checkbox"]'),
      ).find((c) => c.labels?.[0]?.getAttribute('lang') === l)!;
      click(casella);
    }
    goToStep('review');
    await press(button(w.updateEvent));
    expect(payload('PUT').aiTargetLocales).toBe('');
    // Le lingue tolte, anche senza un testo, sono una scelta: il server le
    // toglie solo se toccate.
    expect(payload('PUT').textEdits).toEqual({ touched: ['de', 'en'] });
  });

  it('un evento che non aveva scelto lingue parte da quelle del sito, senza aggiungere quelle con un testo', () => {
    renderWizard({
      mode: 'edit',
      initialEvent: { ...structuredClone(evento), event: { ...evento.event, aiTargetLocales: null } },
      enabledLocales: ['it', 'en', 'de'],
      defaultTargetLocales: 'en,fr',
    });
    const riga = container.querySelector('.lingue-evento__riga')!.textContent!;
    expect(riga).toContain('English · ');
    expect(riga).not.toContain('Deutsch');
    // Il tedesco ha un testo: la sua scheda resta.
    expect(scheda('Deutsch')).toBeTruthy();
  });

  it('salvato e rimasto sulla pagina, le lingue mandate non sono piu toccate', async () => {
    let revocaRiesce = false;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      if (init.method === 'DELETE') return revocaRiesce ? json(200, {}) : json(500, {});
      return json(200, {});
    });
    renderWizard({
      mode: 'edit',
      initialEvent: {
        ...structuredClone(evento),
        eventModerators: [
          { id: 'mod-l', name: 'Anna Bianchi', email: 'anna@example.org', role: 'MODERATOR', personId: null, organizer: false, organization: null, organizationLogoUrl: null, publicListed: false, photoId: null },
        ],
      },
      enabledLocales: ['it', 'en', 'de'],
    });
    click(scheda('English'));
    type(byId<HTMLInputElement>('ev-title'), 'Edited title');
    goToStep('invites');
    const riga = Array.from(container.querySelectorAll('li')).find((li) => li.textContent?.includes('Anna Bianchi'))!;
    click(button(w.step3.remove, riga));
    goToStep('review');
    await press(button(w.updateEvent));
    // La revoca non e' riuscita: il wizard resta aperto.
    expect(push).not.toHaveBeenCalled();
    expect(payload('PUT').textEdits).toEqual({ touched: ['en'] });

    fetchMock.mockClear();
    revocaRiesce = true;
    await press(button(w.updateEvent));
    expect(payload('PUT').textEdits).toEqual({ touched: [] });
  });

  it('le lingue di sottotitoli e sintesi sono quelle dell evento: dal riepilogo si va al passo «Evento»', () => {
    renderWizard({
      template: {
        id: 'tpl-l',
        name: 'Registrato',
        qaEnabled: true,
        chatEnabled: false,
        recordingEnabled: true,
        autoStartRecording: false,
        participantsCanUnmute: false,
        participantsCanStartVideo: false,
        participantsCanShareScreen: false,
        maxParticipants: 100,
        aiTranscriptEnabled: true,
        aiTranslationEnabled: true,
        aiTargetLocales: 'en,fr',
      },
      aiPipelineEnabled: true,
    });
    compila();
    organizzatore();
    goToStep('review');
    const riga = container.querySelector('.anteprima-evento')!;
    expect(riga.textContent).toContain(w.flow.translationLine.replace('{list}', 'English, Français'));
    click(button(tt.changeInEventStep.replace('{step}', w.flow.steps.base)));
    expect(document.activeElement?.id).toBe('ev-lingue-cambia');
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
    goToStep('review');
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
    // Chi scrive «|» di solito vuole il sopratitolo: si accende da solo.
    const casella = () => byId<HTMLInputElement>('ev-parse-title-kicker');
    expect(casella().checked).toBe(true);
    const anteprima = () => container.querySelector('.wizard-sopratitolo__titolo')!;
    expect(anteprima().querySelector('.event-title-kicker')?.textContent).toBe('Ciclo');
    expect(anteprima().querySelector('.event-title-main')?.textContent).toBe('Il primo incontro');
    // Spento a mano, resta spento anche se il titolo cambia.
    click(casella());
    expect(anteprima().querySelector('.event-title-kicker')).toBeNull();
    type(byId<HTMLInputElement>('ev-title'), 'Ciclo | Il secondo incontro');
    expect(casella().checked).toBe(false);
    type(byId<HTMLInputElement>('ev-title'), 'Ciclo | Il primo incontro');
    click(casella());
    type(byId<HTMLTextAreaElement>('ev-description-it'), 'Una descrizione valida per il wizard.');
    organizzatore();
    goToStep('review');
    // Anche il riepilogo mostra il titolo come apparira'.
    expect(container.querySelector('.anteprima-evento__titolo .event-title-kicker')?.textContent).toBe('Ciclo');
    await press(button(w.saveDraft));
    expect(payloadInviato()).toMatchObject({ parseTitleKicker: true });
  });

  it('acceso dal «|» e poi tolto il «|»: l\'evento torna a seguire il sito', async () => {
    renderWizard({ template: modello });
    type(byId<HTMLInputElement>('ev-title'), 'Ciclo | Il primo incontro');
    expect(byId<HTMLInputElement>('ev-parse-title-kicker').checked).toBe(true);
    type(byId<HTMLInputElement>('ev-title'), 'Il primo incontro');
    type(byId<HTMLTextAreaElement>('ev-description-it'), 'Una descrizione valida per il wizard.');
    organizzatore();
    goToStep('review');
    await press(button(w.saveDraft));
    expect(payloadInviato().parseTitleKicker ?? null).toBeNull();
  });

  it('con il sopratitolo gia\' acceso dal sito, scrivere «|» non fissa niente per l\'evento', async () => {
    renderWizard({ template: modello, siteDefaultParseTitleKicker: true });
    type(byId<HTMLInputElement>('ev-title'), 'Ciclo | Il primo incontro');
    expect(byId<HTMLInputElement>('ev-parse-title-kicker').checked).toBe(true);
    type(byId<HTMLTextAreaElement>('ev-description-it'), 'Una descrizione valida per il wizard.');
    organizzatore();
    goToStep('review');
    await press(button(w.saveDraft));
    // Resta «come il sito»: se il sito cambia idea, l'evento la segue.
    expect(payloadInviato().parseTitleKicker ?? null).toBeNull();
  });

  it('chi si iscrive: segue il sito finche non si sceglie, e solo su invito lo dice ovunque', async () => {
    const g = messages.admin.guided;
    const s3 = messages.admin.wizard.step3;
    renderWizard({ template: { ...modello, accessMode: null }, publicRegistrationEnabled: true });
    compila();
    goToStep('invites');
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
    goToStep('review');
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
    goToStep('invites');
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
    goToStep('review');
    expect(container.textContent).not.toContain(messages.admin.form.aiTargetLocales);
    await press(button(w.saveDraft));
    expect(payloadInviato()).toMatchObject({ aiTranscriptEnabled: true, aiTranslationEnabled: false });
  });

  it('senza modello, accendere la registrazione accende anche trascrizione, sintesi, traduzione e tracce', async () => {
    renderWizard({ aiPipelineEnabled: true, defaultTargetLocales: 'en,de' });
    compila();
    goToStep('recording');
    click(container.querySelector<HTMLElement>(`[aria-label="${messages.admin.form.recordingEnabled}"]`)!);
    // L'avvio automatico non si offre piu'.
    expect(container.querySelector(`[aria-label="${messages.admin.form.autoStartRecording}"]`)).toBeNull();
    expect(container.textContent).toContain(w.step2.recordingManualNote);
    goToStep('review');
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
 * Gli obbligatori li segna l'asterisco: niente righe ripetute ne' lampeggi
 * prima di un tentativo. Dopo «Avanti» il campo che manca e' un errore,
 * accanto al campo, e la barra dice quali passi sono da completare; il
 * riepilogo elenca cio' che manca con il link al campo.
 */
describe('obbligatori — l\'errore al tentativo', () => {
  beforeEach(() => {
    fetchMock.mockImplementation(async () => json(200, { rows: [] }));
  });

  it('il titolo vuoto non ripete che e\' obbligatorio: l\'errore compare con «Avanti»', async () => {
    renderWizard();
    const campo = byId<HTMLInputElement>('ev-title').closest('.wizard-campo')!;
    expect(campo).not.toHaveClass('wizard-campo--insisti');
    expect(container.querySelector('#ev-title-promemoria')).toBeNull();
    await press(button(`${messages.common.next} →`));
    expect(campo).toHaveClass('wizard-campo--insisti');
  });

  it('la barra dei passi dice quali sono da completare solo dopo un tentativo', async () => {
    renderWizard();
    const nav = container.querySelector<HTMLElement>(`nav[aria-label="${w.stepsAriaLabel}"]`)!;
    const passo = (nome: string) =>
      Array.from(nav.querySelectorAll('button')).find((b) => b.textContent?.includes(nome))!;
    expect(passo(w.flow.steps.base).textContent).not.toContain(w.flow.toComplete);
    await press(button(`${messages.common.next} →`));
    expect(passo(w.flow.steps.base).textContent).toContain(w.flow.toComplete);
    // L'organizzatore principale serve per pubblicare: anche «Persone» e' da completare.
    expect(passo(w.flow.steps.invites).textContent).toContain(w.flow.toComplete);
    expect(passo(w.flow.steps.schedule).textContent).not.toContain(w.flow.toComplete);
  });

  it('il riepilogo elenca cio che manca, e ogni voce porta al suo campo', () => {
    renderWizard();
    type(byId<HTMLTextAreaElement>('ev-description-it'), 'Una descrizione valida per il wizard.');
    goToStep('review');
    const elenco = container.querySelector('.wizard-mancanti')!;
    expect(elenco.textContent).toContain(messages.admin.form.titleLabel);
    expect(elenco.textContent).toContain(w.flow.fieldOrganizerEmail);
    click(button(messages.admin.form.titleLabel, elenco));
    expect(document.activeElement?.id).toBe('ev-title');
  });

  it('il nome dell organizzatore vuoto dice che serve per pubblicare (non per salvare)', () => {
    renderWizard();
    goToStep('invites');
    const campo = byId<HTMLInputElement>('wiz-primary-name').closest('.wizard-campo')!;
    expect(campo.textContent).toContain(w.flow.requiredToPublish);
  });

  it('in creazione la bozza si salva da ogni passo', () => {
    renderWizard();
    expect(button(w.saveDraft)).toBeTruthy();
    goToStep(w.flow.steps.schedule);
    expect(button(w.saveDraft)).toBeTruthy();
  });
});

describe('foto delle persone', () => {
  const FOTO_PRINCIPALE = '11111111-1111-4111-8111-111111111111';
  const FOTO_ANNA = '22222222-2222-4222-8222-222222222222';
  const conFoto = (): InitialEventShape =>
    ({
      id: 'evt-foto',
      slug: 'evento-foto',
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
        moderatorName: 'Mario Rossi',
        moderatorEmail: 'mario@example.org',
        moderatorPhotoId: FOTO_PRINCIPALE,
      },
      organizers: [],
      eventModerators: [
        { id: 'mod-1', name: 'Anna Bianchi', email: 'anna@example.org', role: 'MODERATOR', personId: null, organizer: false, organization: null, organizationLogoUrl: null, publicListed: true, photoId: FOTO_ANNA },
      ],
      invitations: [],
      materials: [],
      preEventQuestionnaire: null,
      postEventQuestionnaire: null,
    }) as unknown as InitialEventShape;

  const chiamate = () => fetchMock.mock.calls as Array<[string, RequestInit]>;

  it('si vedono, si tolgono dalla riga della persona, e il salvataggio le porta', async () => {
    fetchMock.mockImplementation(async () => json(200, {}));
    renderWizard({ mode: 'edit', initialEvent: conFoto() });
    goToStep('invites');

    // L'organizzatore principale: il pannello si apre da solo, con la foto.
    const primario = byId('wiz-primary-name').closest('section')!;
    expect(primario.querySelector('details.wizard-primary__more')?.hasAttribute('open')).toBe(true);
    expect(primario.querySelector('img')?.getAttribute('src')).toBe(`/api/avatar/person/${FOTO_PRINCIPALE}`);

    // La riga di Anna: la foto accanto al nome, e i pulsanti con il suo nome.
    const riga = Array.from(container.querySelectorAll('li.wizard-person')).find((li) =>
      li.textContent?.includes('Anna Bianchi'),
    )!;
    expect(riga.querySelector('img.person-avatar')?.getAttribute('src')).toBe(`/api/avatar/person/${FOTO_ANNA}`);
    const togli = Array.from(riga.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.getAttribute('aria-label') === w.step3.personPhotoRemoveFor.replace('{name}', 'Anna Bianchi'),
    )!;
    click(togli);
    expect(riga.querySelector('img.person-avatar')).toBeNull();

    goToStep('review');
    await press(button(w.updateEvent));

    const put = chiamate().find(([url, init]) => url === '/api/events/evt-foto' && init.method === 'PUT');
    expect(JSON.parse(String(put![1].body)).moderatorPhotoId).toBe(FOTO_PRINCIPALE);
    const patch = chiamate().find(
      ([url, init]) => url === '/api/events/evt-foto/moderators/mod-1' && init.method === 'PATCH',
    );
    expect(JSON.parse(String(patch![1].body))).toEqual({ photoId: null });
  });

  it('con un link di conduzione si vedono ma non si cambiano', () => {
    renderWizard({ mode: 'edit', initialEvent: conFoto(), initialStep: 'invites', viaToken: 'token-primario' });
    const step3 = w.step3;
    const etichette = [step3.personPhotoAdd, step3.personPhotoChange, step3.personPhotoRemove];
    const pulsanti = Array.from(container.querySelectorAll('button')).filter((b) =>
      etichette.includes(b.textContent?.trim() ?? ''),
    );
    expect(pulsanti).toEqual([]);
    expect(container.querySelector('input[type="file"][accept="image/jpeg,image/png,image/webp"]')).toBeNull();
    expect(container.textContent).toContain(step3.personPhotoStaffOnly);
  });
});

/**
 * Il programma nel suo passo, fra «Persone» e il riepilogo: con l'agenda
 * spenta lo dice e la accende; accesa, gli argomenti con chi interviene, che
 * alla creazione partono dopo le persone, con le concessioni appena create.
 * Ci si arriva anche dalla scheda sotto la descrizione e dal riepilogo.
 */
describe('programma', () => {
  const sp = w.step3;
  const tp = w.programme;

  function scegli(el: HTMLSelectElement, value: string) {
    act(() => {
      el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  function compilaEvento() {
    renderWizard();
    type(byId<HTMLInputElement>('ev-title'), 'Evento di prova');
    type(byId<HTMLTextAreaElement>('ev-description-it'), 'Una descrizione valida per il wizard.');
    organizzatore();
    type(byId<HTMLInputElement>('person-name'), 'Relatore 1');
    type(byId<HTMLInputElement>('person-email'), 'relatore@example.org');
    click(button(sp.add, byId('person-email').closest('.row') ?? container));
  }

  /** I nomi dei passi nella barra, in ordine. */
  function passi(): string[] {
    const nav = container.querySelector<HTMLElement>(`nav[aria-label="${w.stepsAriaLabel}"]`)!;
    return Array.from(nav.querySelectorAll('ol > li:not(.wizard-passi__avanzate) button')).map(
      (b) => b.querySelector('.d-flex.flex-column > span')?.textContent ?? '',
    );
  }
  const passoAttivo = () =>
    container.querySelector('nav [aria-current="step"]')?.textContent ?? '';
  const avanti = () => button(`${messages.common.next} →`);
  /** Il pulsante «+ Intervento» di una persona (ha il nome nell'etichetta). */
  const intervento = (nome: string) => {
    const b = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${tp.addTalkFor.replace('{name}', nome)}"]`,
    );
    if (!b) throw new Error(`nessun «+ Intervento» per ${nome}`);
    return b;
  };

  it('un evento ha sei passi: il programma dopo «Persone», i permessi prima del riepilogo', () => {
    renderWizard();
    expect(passi()).toEqual([
      w.flow.steps.base,
      w.flow.steps.schedule,
      w.flow.steps.invites,
      w.flow.steps.programme,
      w.flow.steps.permissions,
      w.flow.steps.review,
    ]);
  });

  it('una chiamata istantanea non ha il programma, e il programma chiesto per indirizzo apre «Persone»', () => {
    renderWizard({
      mode: 'edit',
      initialEvent: { ...structuredClone(ATTIVA), event: { ...structuredClone(ATTIVA.event), eventType: 'INSTANT' } },
      initialStep: 'programme',
    });
    expect(passi()).toEqual([
      w.flow.steps.base,
      w.flow.steps.schedule,
      w.flow.steps.invites,
      w.flow.steps.permissions,
      w.flow.steps.review,
    ]);
    expect(passoAttivo()).toContain(w.flow.steps.invites);
    expect(container.textContent).not.toContain(tp.peoplePointer);
    goToStep('base');
    expect(container.querySelector('.wizard-programma-scheda')).toBeNull();
  });

  it('«Avanti» va da «Persone» al programma, poi ai permessi e al riepilogo; in «Persone» lo si dice', () => {
    compilaEvento();
    expect(container.textContent).toContain(tp.peoplePointer);
    // Il programma non e' piu' nel passo «Persone».
    expect(container.querySelector('.wizard-programma')).toBeNull();
    click(avanti());
    expect(passoAttivo()).toContain(w.flow.steps.programme);
    expect(container.querySelector('h2')?.textContent).toBe(tp.heading);
    // Accanto, l'anteprima della pagina.
    expect(container.querySelector('.anteprima-pagina')).not.toBeNull();
    click(avanti());
    expect(passoAttivo()).toContain(w.flow.steps.permissions);
    click(avanti());
    expect(passoAttivo()).toContain(w.flow.steps.review);
    click(button(`← ${messages.common.back}`));
    expect(passoAttivo()).toContain(w.flow.steps.permissions);
  });

  it('agenda spenta: lo dice; «Accendi» prepara il primo argomento, che prende il fuoco', () => {
    compilaEvento();
    goToStep(w.flow.steps.programme);
    expect(container.textContent).toContain(tp.statusOff);
    click(button(tp.turnOn));
    const titolo = byId<HTMLInputElement>('wiz-programma-0-titolo');
    expect(document.activeElement).toBe(titolo);
    // Chi interviene: nessuno, l'organizzatore principale e le persone del passo.
    const opzioni = Array.from(byId<HTMLSelectElement>('wiz-programma-0-chi').options).map((o) => o.text);
    expect(opzioni).toEqual([sp.programNone, 'Mario Rossi (Co-organizzatore)', 'Relatore 1 (Relatore)']);
  });

  it('creazione: il programma parte dopo le persone, con la concessione appena creata', async () => {
    const CREATO = { id: 'evt-prog', slug: 'evt-prog', moderatorToken: 'tok-prog' };
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url === '/api/events' && init.method === 'POST') return json(201, CREATO);
      if (url.endsWith('/moderators') && init.method === 'POST') return json(201, { id: 'g-relatore' });
      if (url.endsWith('/agenda') && init.method === 'PUT') return json(200, { items: [] });
      return json(200, {});
    });
    compilaEvento();
    goToStep(w.flow.steps.programme);
    // Dalla persona: la riga nasce con lei, e accende l'agenda.
    click(intervento('Relatore 1'));
    type(byId<HTMLInputElement>('wiz-programma-0-titolo'), 'Intervento');
    type(byId<HTMLInputElement>('wiz-programma-0-min'), '20');
    click(button(sp.programAdd));
    type(byId<HTMLInputElement>('wiz-programma-1-titolo'), 'Domande');
    scegli(byId<HTMLSelectElement>('wiz-programma-1-chi'), 'primary');
    // Una riga lasciata vuota non si salva.
    click(button(sp.programAdd));

    goToStep('review');
    expect(container.querySelector('.anteprima-evento')?.textContent).toContain('Programma: 2 argomenti');
    await press(button(w.saveDraft));

    const chiamate = fetchMock.mock.calls as Array<[string, RequestInit]>;
    const iPut = chiamate.findIndex(([u, i]) => u === `/api/events/${CREATO.id}/agenda` && i.method === 'PUT');
    const iPersona = chiamate.findIndex(([u, i]) => u === `/api/events/${CREATO.id}/moderators` && i.method === 'POST');
    expect(iPut).toBeGreaterThan(iPersona);
    const [, init] = chiamate[iPut]!;
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${CREATO.moderatorToken}`);
    expect(JSON.parse(String(init.body))).toEqual({
      base: [],
      plan: [
        { label: 'Intervento', plannedMinutes: 20, speakerGrantId: 'g-relatore', speakerPrimary: false },
        { label: 'Domande', plannedMinutes: null, speakerGrantId: null, speakerPrimary: true },
      ],
    });
    expect(push).toHaveBeenCalledWith(`/admin/events/${CREATO.id}?created=1`);
  });

  it('creazione: una persona aggiunta dal programma va fra le persone, e l’argomento alla sua concessione', async () => {
    const CREATO = { id: 'evt-nuova', slug: 'evt-nuova', moderatorToken: 'tok-nuova' };
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url === '/api/events' && init.method === 'POST') return json(201, CREATO);
      if (url.endsWith('/moderators') && init.method === 'POST') {
        const corpo = JSON.parse(String(init.body)) as { email: string };
        return json(201, { id: corpo.email === 'carla@example.org' ? 'g-carla' : 'g-altro' });
      }
      if (url.endsWith('/agenda') && init.method === 'PUT') return json(200, { items: [] });
      return json(200, {});
    });
    renderWizard();
    type(byId<HTMLInputElement>('ev-title'), 'Evento di prova');
    type(byId<HTMLTextAreaElement>('ev-description-it'), 'Una descrizione valida per il wizard.');
    organizzatore();
    goToStep(w.flow.steps.programme);
    expect(container.textContent).toContain(tp.noPeople);
    click(button(tp.newPerson));
    const modulo = container.querySelector<HTMLElement>('.wizard-programma__nuova')!;
    const campi = modulo.querySelectorAll<HTMLInputElement>('input[type="text"], input[type="email"]');
    type(campi[0]!, 'Carla Verdi');
    type(campi[1]!, 'carla@example.org');
    click(button(tp.newPersonAssign, modulo));
    expect(document.activeElement?.id).toBe('wiz-programma-0-titolo');
    type(byId<HTMLInputElement>('wiz-programma-0-titolo'), 'Il nuovo servizio');

    // Nel passo «Persone» c'e' anche lei.
    goToStep('invites');
    expect(
      Array.from(container.querySelectorAll('li.wizard-person')).some((li) => li.textContent?.includes('Carla Verdi')),
    ).toBe(true);

    goToStep('review');
    await press(button(w.saveDraft));
    const chiamate = fetchMock.mock.calls as Array<[string, RequestInit]>;
    const persona = chiamate.find(([u, i]) => u === `/api/events/${CREATO.id}/moderators` && i.method === 'POST');
    expect(JSON.parse(String(persona![1].body))).toMatchObject({
      name: 'Carla Verdi',
      email: 'carla@example.org',
      role: 'SPEAKER',
      publicListed: false,
    });
    const put = chiamate.find(([u, i]) => u === `/api/events/${CREATO.id}/agenda` && i.method === 'PUT');
    expect(JSON.parse(String(put![1].body))).toEqual({
      base: [],
      plan: [{ label: 'Il nuovo servizio', plannedMinutes: null, speakerGrantId: 'g-carla', speakerPrimary: false }],
    });
  });

  it('creazione: spento dalle impostazioni avanzate, il programma non si salva, e lo dicono interruttore e riepilogo', async () => {
    const CREATO = { id: 'evt-spento', slug: 'evt-spento', moderatorToken: 'tok-spento' };
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url === '/api/events' && init.method === 'POST') return json(201, CREATO);
      if (url.endsWith('/moderators') && init.method === 'POST') return json(201, { id: 'g-relatore' });
      if (url.endsWith('/agenda') && init.method === 'PUT') return json(200, { items: [] });
      return json(200, {});
    });
    compilaEvento();
    goToStep(w.flow.steps.programme);
    click(intervento('Relatore 1'));
    type(byId<HTMLInputElement>('wiz-programma-0-titolo'), 'Intervento');
    goToStep('permissions');
    act(() => {
      container
        .querySelector<HTMLInputElement>(`input[aria-label="${messages.admin.form.agendaEnabled}"]`)!
        .click();
    });
    const plurale = '{count, plural, one {# argomento} other {# argomenti}}';
    expect(container.textContent).toContain(tp.toggleOffWarningCreate.replace(plurale, '1 argomento'));
    // Nel passo, gli argomenti si leggono soltanto e lo si dice.
    goToStep(w.flow.steps.programme);
    expect(byId<HTMLInputElement>('wiz-programma-0-titolo').readOnly).toBe(true);
    expect(container.textContent).toContain(tp.offKeptCreate);
    goToStep('review');
    expect(container.querySelector('.anteprima-evento')?.textContent).toContain(
      tp.reviewOffCreate.replace(plurale, '1 argomento'),
    );
    await press(button(w.saveDraft));
    const chiamate = fetchMock.mock.calls as Array<[string, RequestInit]>;
    const post = chiamate.find(([u, i]) => u === '/api/events' && i.method === 'POST');
    expect(JSON.parse(String(post![1].body)).agendaEnabled).toBe(false);
    expect(chiamate.some(([u]) => u === `/api/events/${CREATO.id}/agenda`)).toBe(false);
  });

  it('un programma rifiutato arriva alla pagina dell evento fra le risorse non salvate', async () => {
    const CREATO = { id: 'evt-prog-ko', slug: 'evt-prog-ko', moderatorToken: 'tok' };
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url === '/api/events' && init.method === 'POST') return json(201, CREATO);
      if (url.endsWith('/agenda') && init.method === 'PUT') return json(422, { error: 'Invalid agenda plan' });
      return json(200, {});
    });
    compilaEvento();
    goToStep(w.flow.steps.programme);
    click(button(tp.turnOn));
    type(byId<HTMLInputElement>('wiz-programma-0-titolo'), 'Intervento');
    goToStep('review');
    await press(button(w.saveDraft));
    const salvato = JSON.parse(sessionStorage.getItem(`pa-wizard-unsaved:${CREATO.id}`) ?? '{}');
    expect(salvato).toEqual({ unsaved: ['agenda'], publishFailed: false });
  });

  it('una durata che non e una durata ferma «Avanti» sul programma, e il riepilogo degli errori porta al campo', () => {
    compilaEvento();
    goToStep(w.flow.steps.programme);
    click(button(tp.turnOn));
    type(byId<HTMLInputElement>('wiz-programma-0-titolo'), 'Intervento');
    type(byId<HTMLInputElement>('wiz-programma-0-min'), 'dieci');
    click(avanti());
    expect(passoAttivo()).toContain(w.flow.steps.programme);
    const minuti = byId<HTMLInputElement>('wiz-programma-0-min');
    expect(minuti).toHaveClass('is-invalid');
    expect(document.activeElement).toBe(minuti);
    expect(container.textContent).toContain(messages.agenda.minutesInvalid);
    // Il fuoco altrove, il collegamento «da correggere» lo riporta al campo.
    byId<HTMLInputElement>('wiz-programma-0-titolo').focus();
    const daCorreggere = container.querySelector<HTMLElement>('.mt-4.small[role="status"]')!;
    click(button(sp.programMinutesFor.replace('{n}', '1'), daCorreggere));
    expect(document.activeElement).toBe(minuti);
  });

  it('una durata che non e una durata ferma il salvataggio, e porta al passo del programma', async () => {
    compilaEvento();
    goToStep(w.flow.steps.programme);
    click(button(tp.turnOn));
    type(byId<HTMLInputElement>('wiz-programma-0-titolo'), 'Intervento');
    type(byId<HTMLInputElement>('wiz-programma-0-min'), 'dieci');
    goToStep('review');
    // Nel riepilogo cio' che manca dice il passo del programma.
    expect(container.querySelector('.wizard-mancanti')?.textContent).toContain(w.flow.steps.programme);
    await press(button(w.saveDraft));

    expect(chiamateAlServer()).toHaveLength(0);
    expect(passoAttivo()).toContain(w.flow.steps.programme);
    const minuti = byId<HTMLInputElement>('wiz-programma-0-min');
    expect(minuti).toHaveClass('is-invalid');
    expect(document.activeElement).toBe(minuti);
  });

  it('gli orari seguono l inizio dell evento e la somma delle durate; oltre la fine lo dice', () => {
    compilaEvento();
    goToStep(w.flow.steps.programme);
    click(button(tp.turnOn));
    type(byId<HTMLInputElement>('wiz-programma-0-titolo'), 'Uno');
    type(byId<HTMLInputElement>('wiz-programma-0-min'), '45');
    click(button(sp.programAdd));
    type(byId<HTMLInputElement>('wiz-programma-1-titolo'), 'Due');
    type(byId<HTMLInputElement>('wiz-programma-1-min'), '30');
    const ore = Array.from(container.querySelectorAll('.wizard-programma__ora')).map((o) => o.textContent);
    // Un evento nuovo comincia alle 10 e dura un'ora.
    expect(ore).toEqual(['10:00', '10:45']);
    const totale = container.querySelector('.wizard-programma__totale')?.textContent ?? '';
    expect(totale).toContain('fino alle 11:15');
    expect(totale).toContain('15 minuti');
  });

  it('togliere una persona in «Persone» toglie la sua scelta senza aprire il programma; il programma poi lo dice', () => {
    compilaEvento();
    goToStep(w.flow.steps.programme);
    click(intervento('Relatore 1'));
    type(byId<HTMLInputElement>('wiz-programma-0-titolo'), 'Intervento');
    goToStep('invites');
    const riga = Array.from(container.querySelectorAll('li.wizard-person')).find((li) =>
      li.textContent?.includes('Relatore 1'),
    )!;
    click(button(sp.remove, riga));
    // Rimessa subito con lo stesso indirizzo, la persona non si ritrova
    // l'intervento di prima: la scelta e' stata tolta subito, senza passare
    // dal programma.
    type(byId<HTMLInputElement>('person-name'), 'Relatore 1');
    type(byId<HTMLInputElement>('person-email'), 'relatore@example.org');
    click(button(sp.add, byId('person-email').closest('.row') ?? container));
    goToStep('review');
    expect(container.querySelector('.anteprima-evento')?.textContent).toContain('Programma: 1 argomento');
    goToStep(w.flow.steps.programme);
    expect(byId<HTMLSelectElement>('wiz-programma-0-chi').value).toBe('');
    expect(container.textContent).toContain('Un argomento non ha più chi interviene');
    // Detto una volta: tornando al passo non lo ripete.
    goToStep('review');
    goToStep(w.flow.steps.programme);
    expect(container.textContent).not.toContain('Un argomento non ha più chi interviene');
  });

  it('una scelta tolta a mano nel programma non si dice come persona tolta', () => {
    compilaEvento();
    goToStep(w.flow.steps.programme);
    click(intervento('Relatore 1'));
    type(byId<HTMLInputElement>('wiz-programma-0-titolo'), 'Intervento');
    scegli(byId<HTMLSelectElement>('wiz-programma-0-chi'), '');
    goToStep('review');
    goToStep(w.flow.steps.programme);
    expect(container.textContent).not.toContain('Un argomento non ha più chi interviene');
  });

  it('«Cambia formato» porta il programma acceso, anche verso un formato con l’agenda spenta', () => {
    const cambia = vi.fn();
    renderWizard({
      template: {
        id: 'tpl-senza-agenda',
        name: 'Riunione',
        qaEnabled: false,
        chatEnabled: true,
        recordingEnabled: false,
        autoStartRecording: false,
        agendaEnabled: false,
        participantsCanUnmute: true,
        participantsCanStartVideo: true,
        participantsCanShareScreen: true,
        maxParticipants: 20,
      },
      onChangeTemplate: cambia,
    });
    goToStep(w.flow.steps.programme);
    click(button(sp.programAdd));
    type(byId<HTMLInputElement>('wiz-programma-0-titolo'), 'Apertura');
    click(button(w.flow.changeTemplate));
    const portati = JSON.parse(localStorage.getItem('pa-wizard-draft:trasloco')!) as {
      dati: Record<string, unknown>;
    };
    expect(portati.dati.agendaEnabled).toBe(true);
    expect((portati.dati.agenda as Array<{ label: string }>)[0]!.label).toBe('Apertura');
  });

  it('una bozza ripresa senza la persona di un argomento toglie la scelta, e il programma lo dice', () => {
    // Una bozza di prima del programma: le persone, ma non gli argomenti
    // (restano quelli salvati, che nominano chi nella bozza non c'e').
    localStorage.setItem(
      `pa-wizard-draft:${ATTIVA.id}`,
      JSON.stringify({ moderators: [], speakers: [] }),
    );
    renderWizard({ mode: 'edit', initialEvent: structuredClone(ATTIVA) });
    click(button(w.draftRestore));
    goToStep(w.flow.steps.programme);
    expect(byId<HTMLInputElement>('wiz-programma-0-titolo').value).toBe('Apertura');
    expect(byId<HTMLSelectElement>('wiz-programma-0-chi').value).toBe('');
    expect(container.textContent).toContain('Un argomento non ha più chi interviene');
  });

  it('la scheda sotto la descrizione porta al programma, e poi lo riassume', () => {
    compilaEvento();
    goToStep('base');
    const scheda = container.querySelector<HTMLElement>('.wizard-programma-scheda')!;
    expect(scheda.textContent).toContain(tp.cardEmpty);
    click(button(tp.cardPrepare, scheda));
    expect(passoAttivo()).toContain(w.flow.steps.programme);
    click(intervento('Relatore 1'));
    type(byId<HTMLInputElement>('wiz-programma-0-titolo'), 'Intervento');
    type(byId<HTMLInputElement>('wiz-programma-0-min'), '30');
    goToStep('base');
    const dopo = container.querySelector<HTMLElement>('.wizard-programma-scheda')!;
    expect(dopo.textContent).toContain('1 argomento · 10:00–10:30');
    click(button(tp.cardChange, dopo));
    expect(passoAttivo()).toContain(w.flow.steps.programme);
  });

  it('una descrizione che contiene gia un programma lo fa notare, e porta al passo', () => {
    renderWizard();
    type(
      byId<HTMLTextAreaElement>('ev-description-it'),
      'Una mattina di lavoro.\n\n## Programma\n\n- 10:00 Apertura\n- 10:30 Interventi',
    );
    const scheda = container.querySelector<HTMLElement>('.wizard-programma-scheda')!;
    expect(scheda.textContent).toContain(tp.descriptionHasProgramme);
    click(button(tp.goToProgramme, scheda));
    expect(passoAttivo()).toContain(w.flow.steps.programme);
  });

  it('il riepilogo ha sempre la riga del programma: vuota porta a prepararlo', () => {
    renderWizard();
    goToStep('review');
    const anteprima = container.querySelector<HTMLElement>('.anteprima-evento')!;
    expect(anteprima.textContent).toContain(tp.reviewEmpty);
    click(button(tp.reviewPrepare, anteprima));
    expect(passoAttivo()).toContain(w.flow.steps.programme);
  });

  it('impostazioni avanzate: l’interruttore porta al programma e, spento con argomenti, dice che restano', () => {
    renderWizard({ mode: 'edit', initialEvent: structuredClone(ATTIVA) });
    goToStep('permissions');
    const interruttore = container.querySelector<HTMLInputElement>(
      `input[aria-label="${messages.admin.form.agendaEnabled}"]`,
    )!;
    expect(container.textContent).not.toContain('resta salvato');
    act(() => {
      interruttore.click();
    });
    expect(container.textContent).toContain(
      tp.toggleOffWarning.replace('{count, plural, one {# argomento} other {# argomenti}}', '1 argomento'),
    );
    click(button(`${tp.toggleLink} →`));
    expect(passoAttivo()).toContain(w.flow.steps.programme);
    expect(container.textContent).toContain(tp.statusOff);
  });

  it('modifica: un agenda gia usata in sala si legge soltanto, e non si manda', async () => {
    fetchMock.mockImplementation(async () => json(200, {}));
    renderWizard({
      mode: 'edit',
      initialEvent: {
        ...structuredClone(ATTIVA),
        agendaLocked: true,
      },
    });
    goToStep(w.flow.steps.programme);
    expect(byId<HTMLInputElement>('wiz-programma-0-titolo').readOnly).toBe(true);
    expect(byId<HTMLSelectElement>('wiz-programma-0-chi').disabled).toBe(true);
    expect(() => button(sp.programAdd)).toThrow();
    expect(container.querySelector('.wizard-programma__persone')).toBeNull();
    expect(container.textContent).toContain(sp.programFrozen);
    // Togliere la persona in «Persone» non tocca un'agenda gia' usata.
    goToStep('invites');
    const riga = Array.from(container.querySelectorAll('li.wizard-person')).find((li) =>
      li.textContent?.includes('Anna Bianchi'),
    )!;
    click(button(sp.remove, riga));
    goToStep(w.flow.steps.programme);
    expect(container.textContent).not.toContain('Un argomento non ha più chi interviene');
    goToStep('review');
    await press(button(w.updateEvent));
    expect((fetchMock.mock.calls as Array<[string]>).some(([u]) => u.endsWith('/agenda'))).toBe(false);
  });

  it('modifica: il programma salvato torna con chi interviene, e cambiato si manda con la base letta', async () => {
    fetchMock.mockImplementation(async () => json(200, { items: [] }));
    renderWizard({ mode: 'edit', initialEvent: structuredClone(ATTIVA), initialStep: 'programme' });
    expect(passoAttivo()).toContain(w.flow.steps.programme);
    expect(byId<HTMLInputElement>('wiz-programma-0-titolo').value).toBe('Apertura');
    expect(byId<HTMLSelectElement>('wiz-programma-0-chi').value).toBe('e:anna@example.org');
    expect(byId<HTMLInputElement>('wiz-programma-0-min').value).toBe('10');
    type(byId<HTMLInputElement>('wiz-programma-0-min'), '15');
    // In modifica si salva dal passo stesso.
    await press(button(w.updateEvent));
    const put = (fetchMock.mock.calls as Array<[string, RequestInit]>).find(
      ([u, i]) => u === '/api/events/evt-prog/agenda' && i.method === 'PUT',
    );
    expect(JSON.parse(String(put?.[1].body))).toEqual({
      base: ['a1'],
      plan: [{ id: 'a1', label: 'Apertura', plannedMinutes: 15, speakerGrantId: 'mod-1', speakerPrimary: false }],
    });
  });

  it('con il solo link di conduzione il programma si cambia, e una persona nuova parte col token', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url.endsWith('/moderators') && init.method === 'POST') return json(201, { id: 'g-carla' });
      return json(200, { items: [] });
    });
    renderWizard({
      mode: 'edit',
      initialEvent: structuredClone(ATTIVA),
      initialStep: 'programme',
      viaToken: 'token-primario',
    });
    click(button(tp.newPerson));
    const modulo = container.querySelector<HTMLElement>('.wizard-programma__nuova')!;
    const campi = modulo.querySelectorAll<HTMLInputElement>('input[type="text"], input[type="email"]');
    type(campi[0]!, 'Carla Verdi');
    type(campi[1]!, 'carla@example.org');
    click(button(tp.newPersonAssign, modulo));
    type(byId<HTMLInputElement>('wiz-programma-1-titolo'), 'Domande');
    await press(button(w.updateEvent));
    const chiamate = fetchMock.mock.calls as Array<[string, RequestInit]>;
    const iPersona = chiamate.findIndex(([u, i]) => u === '/api/events/evt-prog/moderators' && i.method === 'POST');
    const iPut = chiamate.findIndex(([u, i]) => u === '/api/events/evt-prog/agenda' && i.method === 'PUT');
    expect(iPersona).toBeGreaterThanOrEqual(0);
    expect(iPut).toBeGreaterThan(iPersona);
    expect((chiamate[iPut]![1].headers as Record<string, string>).Authorization).toBe('Bearer token-primario');
    expect(JSON.parse(String(chiamate[iPut]![1].body)).plan[1]).toEqual({
      label: 'Domande',
      plannedMinutes: null,
      speakerGrantId: 'g-carla',
      speakerPrimary: false,
    });
  });
});

/** Un evento salvato con l'agenda accesa e un argomento, per la modifica. */
const ATTIVA: InitialEventShape = {
  id: 'evt-prog',
  slug: 'evento-programma',
  moderatorToken: 'token-primario',
  event: {
    title: { it: 'Evento con programma' },
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
    agendaEnabled: true,
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
    moderatorPhotoId: null,
    accessMode: null,
    requireOrganization: false,
    requireOrganizationRole: false,
    requireOrganizationType: false,
  },
  organizers: [],
  eventModerators: [
    { id: 'mod-1', name: 'Anna Bianchi', email: 'anna@example.org', role: 'MODERATOR', personId: null, organizer: false, organization: null, organizationLogoUrl: null, publicListed: true, photoId: null },
  ],
  invitations: [],
  materials: [],
  preEventQuestionnaire: null,
  postEventQuestionnaire: null,
  agenda: [{ id: 'a1', label: 'Apertura', plannedMinutes: 10, speakerGrantId: 'mod-1', speakerPrimary: false }],
  agendaLocked: false,
};

describe('foto di una persona in viaggio verso il server', () => {
  it('il wizard non salva e non cambia passo finche\' la foto non e\' arrivata', async () => {
    let rispondi: (r: Response) => void = () => {};
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/admin/person-photos') {
        return new Promise<Response>((r) => (rispondi = r));
      }
      return json(200, {});
    });
    renderWizard();
    type(byId<HTMLInputElement>('ev-title'), 'Evento di prova');
    type(byId<HTMLTextAreaElement>('ev-description-it'), 'Una descrizione valida per il wizard.');
    organizzatore();

    const input = byId<HTMLInputElement>('wiz-primary-photo-file');
    Object.defineProperty(input, 'files', {
      value: [new File([new Uint8Array([1])], 'ritratto.png', { type: 'image/png' })],
      configurable: true,
    });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await press(button('conferma-ritaglio'));

    const avanti = () => button(`${messages.common.next} →`);
    expect(avanti().disabled).toBe(true);
    // Neanche dalla barra dei passi: il campo smonterebbe e la foto andrebbe persa.
    goToStep('review');
    expect(container.querySelector('#wiz-primary-name')).not.toBeNull();

    await act(async () => {
      rispondi(json(201, { id: '11111111-1111-4111-8111-111111111111', url: '/api/avatar/person/x' }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(avanti().disabled).toBe(false);
    goToStep('review');
    expect(container.querySelector('#wiz-primary-name')).toBeNull();
  });
});

describe('file in viaggio verso il server', () => {
  // Il caricamento dei campi «file o link» passa da XMLHttpRequest.
  class XhrFinto {
    static ultimo: XhrFinto | null = null;
    upload = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    status = 0;
    responseText = '';
    annullato = false;
    constructor() {
      XhrFinto.ultimo = this;
    }
    open() {}
    send() {}
    abort() {
      this.annullato = true;
      this.onabort?.();
    }
    rispondi(corpo: unknown) {
      this.status = 200;
      this.responseText = JSON.stringify(corpo);
      this.onload?.();
    }
  }
  const ORIGINE = window.location.origin;

  beforeEach(() => {
    XhrFinto.ultimo = null;
    vi.stubGlobal('XMLHttpRequest', XhrFinto);
    URL.createObjectURL = () => 'blob:prova';
    URL.revokeObjectURL = () => {};
  });

  async function scegli(prefisso: string, file: File) {
    const input = container.querySelector<HTMLInputElement>(`input[type="file"][id^="${prefisso}-file-"]`);
    if (!input) throw new Error(`nessun selettore ${prefisso}`);
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
  }
  function payloadPost(): Record<string, unknown> {
    const chiamata = (fetchMock.mock.calls as Array<[string, RequestInit]>).find(
      ([url, init]) => init?.method === 'POST' && url === '/api/events',
    );
    return JSON.parse(String(chiamata?.[1].body)) as Record<string, unknown>;
  }

  it('la copertina: il wizard non cambia passo finche\' non e\' arrivata, e il file arriva al modulo', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      if (String(input) === '/api/events' && init.method === 'POST')
        return json(201, { id: 'evt-c', slug: 'evt-c', moderatorToken: 'tok-c' });
      return json(200, {});
    });
    renderWizard();
    type(byId<HTMLInputElement>('ev-title'), 'Evento di prova');
    type(byId<HTMLTextAreaElement>('ev-description-it'), 'Una descrizione valida per il wizard.');
    // Un SVG non si ritaglia: parte subito.
    await scegli('ev-cover', new File(['<svg/>'], 'copertina.svg', { type: 'image/svg+xml' }));
    const xhr = XhrFinto.ultimo!;

    const avanti = () => button(`${messages.common.next} →`);
    expect(avanti().disabled).toBe(true);
    // Neanche dalla barra dei passi o dalla scheda del programma: il campo
    // smonterebbe e interromperebbe il caricamento.
    goToStep('invites');
    click(button(w.programme.cardPrepare));
    expect(container.querySelector('#ev-title')).not.toBeNull();
    expect(xhr.annullato).toBe(false);

    const url = `${ORIGINE}/api/assets/image/2026/10/copertina.svg`;
    await act(async () => {
      xhr.rispondi({ url, key: 'assets/image/copertina.svg', mime: 'image/svg+xml', size: 6, filename: 'copertina.svg' });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(avanti().disabled).toBe(false);
    organizzatore();
    goToStep('review');
    await press(button(w.saveDraft));
    expect(payloadPost()).toMatchObject({ coverImageUrl: url });
  });

  it('i materiali: «Aggiungi materiale» aspetta il file, e dopo il modulo riparte vuoto', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      if (String(input) === '/api/events' && init.method === 'POST')
        return json(201, { id: 'evt-m', slug: 'evt-m', moderatorToken: 'tok-m' });
      return json(200, {});
    });
    renderWizard();
    type(byId<HTMLInputElement>('ev-title'), 'Evento di prova');
    type(byId<HTMLTextAreaElement>('ev-description-it'), 'Una descrizione valida per il wizard.');
    organizzatore();
    goToStep('content');
    const aggiungi = () => button(w.step4.addMaterial);
    const carica = async (nome: string) => {
      type(byId<HTMLInputElement>('mat-title'), nome);
      await scegli('mat-url', new File([new Uint8Array([1])], `${nome}.pdf`, { type: 'application/pdf' }));
      expect(aggiungi().disabled).toBe(true);
      await act(async () => {
        XhrFinto.ultimo!.rispondi({
          url: `${ORIGINE}/api/assets/document/${nome}.pdf`,
          key: `assets/document/${nome}.pdf`,
          mime: 'application/pdf',
          size: 1,
          filename: `${nome}.pdf`,
        });
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      click(aggiungi());
      // Il campo segue il modulo azzerato: il file appena aggiunto non resta.
      expect(container.querySelector('[data-testid="mat-url"] a.campo-file__nome')).toBeNull();
    };
    await carica('slide');
    await carica('programma');
    goToStep('review');
    await press(button(w.saveDraft));
    const materiali = (fetchMock.mock.calls as Array<[string, RequestInit]>)
      .filter(([url]) => url === '/api/admin/events/evt-m/materials')
      .map(([, init]) => JSON.parse(String(init.body)) as Record<string, unknown>);
    expect(materiali).toMatchObject([
      { title: 'slide', type: 'FILE', url: `${ORIGINE}/api/assets/document/slide.pdf` },
      { title: 'programma', type: 'FILE', url: `${ORIGINE}/api/assets/document/programma.pdf` },
    ]);
  });

  it('il documento della privacy: dalle impostazioni avanzate non si torna al riepilogo finche\' non e\' arrivato', async () => {
    renderWizard();
    goToStep('review');
    goToStep(w.flow.steps.advanced);
    apriSezione('data');
    await scegli('rev-privacy-doc', new File([new Uint8Array([1])], 'privacy.pdf', { type: 'application/pdf' }));
    const xhr = XhrFinto.ultimo!;
    click(button(`← ${w.flow.backToReview}`));
    expect(container.querySelector('[data-testid="rev-privacy-doc"]')).not.toBeNull();
    expect(xhr.annullato).toBe(false);

    await act(async () => {
      xhr.rispondi({
        url: `${ORIGINE}/api/assets/document/privacy.pdf`,
        key: 'assets/document/privacy.pdf',
        mime: 'application/pdf',
        size: 1,
        filename: 'privacy.pdf',
      });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    click(button(`← ${w.flow.backToReview}`));
    expect(container.querySelector('[data-testid="rev-privacy-doc"]')).toBeNull();
  });
});
