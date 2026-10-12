import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { differenzaProfilo } from '@/lib/events/grant-profile';
import { createMaterialAdminSchema } from '@/lib/validation/materials';

import { fanoutEditDiff, materialPayload } from './edit-fanout';
import type { InitialEventShape, WizardForm } from './wizard-shell';

/**
 * La revoca di un co-moderatore o di un relatore tolto dal wizard.
 *
 * Il difetto: la cancellazione partiva con un'intestazione che le rotte non
 * leggono, riceveva 401, e lo scatto veniva aggiornato lo stesso. Il
 * salvataggio successivo non la riprovava e il collegamento restava valido
 * per sempre, senza che l'operatore lo sapesse.
 */

const EVENT_ID = 'evt-1';
const TOKEN = 'token-primario';

function snapshot(): InitialEventShape {
  return {
    id: EVENT_ID,
    slug: 'evento',
    moderatorToken: TOKEN,
    event: {} as InitialEventShape['event'],
    organizers: [
      { id: 'org-1', name: 'Ente', logoUrl: null, websiteUrl: null },
    ],
    eventModerators: [
      { id: 'mod-1', name: 'Anna Bianchi', email: 'anna@example.org', role: 'MODERATOR', personId: null, organizer: false, organization: null, organizationLogoUrl: null, publicListed: false },
      { id: 'spk-1', name: 'Luca Verdi', email: 'luca@example.org', role: 'SPEAKER', personId: null, organizer: false, organization: null, organizationLogoUrl: null, publicListed: false },
    ],
    invitations: [
      { id: 'inv-1', name: 'Ospite', email: 'ospite@example.org', role: 'GUEST', personId: null },
    ],
    materials: [
      {
        id: 'mat-1',
        title: 'Slide',
        url: 'https://example.org/slide.pdf',
        description: null,
        type: 'link',
        visibility: 'ALWAYS',
      },
    ],
    preEventQuestionnaire: null,
    postEventQuestionnaire: null,
  };
}

/** Il modulo legge solo le relazioni: il resto del modulo non serve qui. */
function formWithout(): WizardForm {
  return {
    organizers: [],
    moderators: [],
    speakers: [],
    invitations: [],
    materials: [],
    preEventQuestionnaire: { templateIds: [], adhocQuestions: [] },
    postEventQuestionnaire: { templateIds: [], adhocQuestions: [] },
  } as unknown as WizardForm;
}

type Responder = (url: string, init: RequestInit) => Response | Promise<Response>;

const fetchMock = vi.fn();

function respond(responder: Responder) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) =>
    responder(String(input), init),
  );
}

function json(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function calls(method: string, fragment: string): Array<[string, RequestInit]> {
  return (fetchMock.mock.calls as Array<[string, RequestInit]>).filter(
    ([url, init]) => (init?.method ?? 'GET') === method && url.includes(fragment),
  );
}

function headerNames(init: RequestInit | undefined): string[] {
  return Object.keys((init?.headers ?? {}) as Record<string, string>).map((h) => h.toLowerCase());
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fanoutEditDiff — revoche', () => {
  it('revoca co-moderatore e relatore con Authorization: Bearer e nessun altra intestazione', async () => {
    respond(() => json(200, { revoked: true }));
    const initial = snapshot();

    const report = await fanoutEditDiff(EVENT_ID, TOKEN, formWithout(), initial, 'it');

    const revoche = calls('DELETE', '/moderators/');
    expect(revoche.map(([url]) => url)).toEqual([
      `/api/events/${EVENT_ID}/moderators/mod-1`,
      `/api/events/${EVENT_ID}/moderators/spk-1`,
    ]);
    for (const [, init] of revoche) {
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    }
    // Nessuna richiesta del fan-out usa un'intestazione diversa da queste
    // due: le rotte non leggerebbero il token e risponderebbero 401.
    for (const [, init] of fetchMock.mock.calls as Array<[string, RequestInit]>) {
      for (const name of headerNames(init)) {
        expect(['content-type', 'authorization']).toContain(name);
      }
    }
    expect(report.revocationFailed).toEqual([]);
    expect(initial.eventModerators).toEqual([]);
  });

  it('una revoca rifiutata resta nello scatto, si dice per nome, e il salvataggio successivo la riprova', async () => {
    respond((url, init) =>
      init.method === 'DELETE' && url.endsWith('/moderators/mod-1')
        ? json(500, { error: 'Internal error' })
        : json(200, {}),
    );
    const initial = snapshot();

    const primo = await fanoutEditDiff(EVENT_ID, TOKEN, formWithout(), initial, 'it');

    expect(primo.revocationFailed).toEqual(['Anna Bianchi']);
    // Non e' una risorsa generica: l'avviso la nomina a parte.
    expect(primo.failed).not.toContain('moderators');
    expect(initial.eventModerators.map((m) => m.id)).toEqual(['mod-1']);

    respond(() => json(200, { revoked: true }));
    const secondo = await fanoutEditDiff(EVENT_ID, TOKEN, formWithout(), initial, 'it');

    expect(calls('DELETE', '/moderators/mod-1')).toHaveLength(2);
    expect(secondo.revocationFailed).toEqual([]);
    expect(initial.eventModerators).toEqual([]);
  });

  it('il token rifiutato (401) conta come revoca mancata', async () => {
    respond((url, init) =>
      init.method === 'DELETE' && url.includes('/moderators/')
        ? json(401, { error: 'Moderator token required' })
        : json(200, {}),
    );
    const initial = snapshot();

    const report = await fanoutEditDiff(EVENT_ID, TOKEN, formWithout(), initial, 'it');

    expect(report.revocationFailed).toEqual(['Anna Bianchi', 'Luca Verdi']);
    expect(initial.eventModerators).toHaveLength(2);
  });

  it('una revoca senza rete resta da fare', async () => {
    respond((url, init) => {
      if (init.method === 'DELETE' && url.endsWith('/moderators/spk-1')) {
        throw new TypeError('Failed to fetch');
      }
      return json(200, {});
    });
    const initial = snapshot();

    const report = await fanoutEditDiff(EVENT_ID, TOKEN, formWithout(), initial, 'it');

    expect(report.revocationFailed).toEqual(['Luca Verdi']);
    expect(initial.eventModerators.map((m) => m.id)).toEqual(['spk-1']);
  });

  it('gia revocato altrove (404) e lo stato voluto: lo scatto si aggiorna senza avvisi', async () => {
    respond((url, init) =>
      init.method === 'DELETE' ? json(404, { error: 'Co-moderator not found' }) : json(200, {}),
    );
    const initial = snapshot();

    const report = await fanoutEditDiff(EVENT_ID, TOKEN, formWithout(), initial, 'it');

    expect(report.revocationFailed).toEqual([]);
    expect(report.failed).toEqual([]);
    expect(initial.eventModerators).toEqual([]);
    expect(initial.organizers).toEqual([]);
    expect(initial.invitations).toEqual([]);
    expect(initial.materials).toEqual([]);
  });
});

describe('fanoutEditDiff — altre cancellazioni', () => {
  it('una cancellazione fallita non tocca lo scatto e finisce fra le risorse non salvate', async () => {
    respond((url, init) =>
      init.method === 'DELETE' && !url.includes('/moderators/')
        ? json(500, { error: 'Internal error' })
        : json(200, {}),
    );
    const initial = snapshot();

    const report = await fanoutEditDiff(EVENT_ID, TOKEN, formWithout(), initial, 'it');

    expect(report.failed).toEqual(['organizers', 'invitations', 'materials']);
    expect(report.reason).toBe('Internal error');
    expect(initial.organizers.map((o) => o.id)).toEqual(['org-1']);
    expect(initial.invitations.map((i) => i.id)).toEqual(['inv-1']);
    expect(initial.materials.map((m) => m.id)).toEqual(['mat-1']);
  });

  it('la rimozione di un organizzatore porta il token come Bearer', async () => {
    respond(() => json(200, { deleted: true }));

    await fanoutEditDiff(EVENT_ID, TOKEN, formWithout(), snapshot(), 'it');

    const rimozioni = calls('DELETE', '/organizers/');
    expect(rimozioni).toHaveLength(1);
    const [url, init] = rimozioni[0]!;
    expect(url).toBe(`/api/events/${EVENT_ID}/organizers/org-1`);
    expect(init.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
  });
});

/**
 * Contratto fra il wizard e l'API dei materiali: la bozza del wizard, passata
 * da materialPayload, e' accettata dallo schema della rotta cosi' com'e', con
 * il tipo che l'API conosce.
 */
describe('fanoutEditDiff — profilo delle persone', () => {
  const persone = (patch: Record<string, unknown>) =>
    ({
      ...formWithout(),
      organizers: [{ name: 'Ente', logoUrl: null, websiteUrl: null }],
      invitations: [{ name: 'Ospite', email: 'ospite@example.org', role: 'GUEST', personId: null }],
      materials: snapshot().materials.map((m) => ({ ...m, id: undefined })),
      moderators: [
        {
          name: 'Anna Bianchi',
          email: 'anna@example.org',
          personId: null,
          organizer: false,
          organization: null,
          organizationLogoUrl: null,
          publicListed: false,
          ...patch,
        },
      ],
      speakers: [
        {
          name: 'Luca Verdi',
          email: 'luca@example.org',
          personId: null,
          organization: null,
          organizationLogoUrl: null,
          publicListed: false,
        },
      ],
    }) as unknown as WizardForm;

  it('un ente o un segno cambiati si salvano con PATCH, senza revocare il link', async () => {
    respond(() => json(200, {}));
    const initial = snapshot();

    const report = await fanoutEditDiff(
      EVENT_ID,
      TOKEN,
      persone({ organizer: true, organization: 'Ente di esempio', publicListed: true }),
      initial,
      'it',
    );

    expect(calls('DELETE', '/moderators/')).toEqual([]);
    expect(calls('POST', '/moderators')).toEqual([]);
    const aggiornamenti = calls('PATCH', '/moderators/');
    expect(aggiornamenti.map(([url]) => url)).toEqual([`/api/events/${EVENT_ID}/moderators/mod-1`]);
    expect(JSON.parse(String(aggiornamenti[0]![1].body))).toEqual({
      organizer: true,
      organization: 'Ente di esempio',
      publicListed: true,
    });
    expect(report.failed).toEqual([]);
    // Lo scatto si aggiorna: un secondo salvataggio non ripete la richiesta.
    fetchMock.mockClear();
    await fanoutEditDiff(
      EVENT_ID,
      TOKEN,
      persone({ organizer: true, organization: 'Ente di esempio', publicListed: true }),
      initial,
      'it',
    );
    expect(calls('PATCH', '/moderators/')).toEqual([]);
  });

  it('senza cambi non parte nessuna richiesta per le persone', async () => {
    respond(() => json(200, {}));
    await fanoutEditDiff(EVENT_ID, TOKEN, persone({}), snapshot(), 'it');
    expect(calls('PATCH', '/moderators/')).toEqual([]);
    expect(calls('POST', '/moderators')).toEqual([]);
    expect(calls('DELETE', '/moderators/')).toEqual([]);
  });

  it('un aggiornamento rifiutato finisce fra le risorse non salvate e si riprova', async () => {
    respond((url, init) => (init.method === 'PATCH' ? json(500, { error: 'Internal error' }) : json(200, {})));
    const initial = snapshot();
    const report = await fanoutEditDiff(EVENT_ID, TOKEN, persone({ publicListed: true }), initial, 'it');
    expect(report.failed).toContain('moderators');
    expect(initial.eventModerators.find((m) => m.id === 'mod-1')?.publicListed).toBe(false);
  });
});

describe('materialPayload', () => {
  it.each([
    ['file', 'FILE'],
    ['link', 'LINK'],
  ] as const)('una bozza «%s» diventa un materiale %s valido', (tipo, atteso) => {
    const bozza = {
      id: 'bozza-1',
      title: 'Slide della sessione',
      url: 'https://storage.example.org/assets/documents/slide.pdf',
      description: null,
      type: tipo,
      visibility: 'AFTER' as const,
    };
    const parsed = createMaterialAdminSchema.safeParse(materialPayload(bozza));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.type).toBe(atteso);
    expect(parsed.success && parsed.data.visibility).toBe('AFTER');
    expect(materialPayload(bozza)).not.toHaveProperty('id');
  });
});

describe('materialPayload — file caricato', () => {
  it('porta la chiave nello storage e i dati del file; un link no', () => {
    const file = materialPayload({
      title: 'Slide',
      url: 'https://storage.example.org/assets/documents/2026/10/slide.pdf',
      description: null,
      type: 'file',
      visibility: 'ALWAYS',
      fileName: 'slide.pdf',
      fileSize: 2048,
      mimeType: 'application/pdf',
      blobPath: 'assets/documents/2026/10/slide.pdf',
    });
    const parsed = createMaterialAdminSchema.safeParse(file);
    expect(parsed.success && parsed.data).toMatchObject({
      type: 'FILE',
      blobPath: 'assets/documents/2026/10/slide.pdf',
      fileName: 'slide.pdf',
      fileSize: 2048,
      mimeType: 'application/pdf',
    });
    const link = materialPayload({
      title: 'Programma',
      url: 'https://www.example.org/assets/programma.pdf',
      description: null,
      type: 'link',
      visibility: 'ALWAYS',
    });
    expect(link).not.toHaveProperty('blobPath');
    expect(link.type).toBe('LINK');
  });
});

describe('differenzaProfilo', () => {
  it('una bozza senza profilo non conta come modifica', () => {
    const salvato = { organizer: false, organization: null, organizationLogoUrl: null, publicListed: false };
    expect(differenzaProfilo(salvato, {})).toBeNull();
    expect(differenzaProfilo(salvato, { organization: '' })).toBeNull();
  });

  it('manda solo i campi cambiati', () => {
    expect(
      differenzaProfilo(
        { organizer: false, organization: 'A', organizationLogoUrl: null, publicListed: false },
        { organizer: false, organization: 'B', organizationLogoUrl: null, publicListed: true },
      ),
    ).toEqual({ organization: 'B', publicListed: true });
  });
});

describe('fanoutEditDiff — persone riconosciute dalla concessione', () => {
  const senzaEmail = (id: string, name: string) => ({
    id,
    name,
    email: null,
    role: 'MODERATOR' as const,
    personId: null,
    organizer: false,
    organization: null,
    organizationLogoUrl: null,
    publicListed: false,
  });
  const voce = (grantId: string, name: string, patch: Record<string, unknown> = {}) => ({
    grantId,
    name,
    email: '',
    personId: null,
    organizer: false,
    organization: null,
    organizationLogoUrl: null,
    publicListed: false,
    ...patch,
  });

  it('due concessioni senza email: il profilo va a quella giusta', async () => {
    respond(() => json(200, {}));
    const initial = { ...snapshot(), eventModerators: [senzaEmail('a', 'A'), senzaEmail('b', 'B')] };
    const form = {
      ...formWithout(),
      moderators: [voce('a', 'A', { publicListed: true }), voce('b', 'B')],
    } as unknown as WizardForm;

    await fanoutEditDiff(EVENT_ID, TOKEN, form, initial, 'it');

    expect(calls('PATCH', '/moderators/').map(([url]) => url)).toEqual([`/api/events/${EVENT_ID}/moderators/a`]);
    expect(calls('DELETE', '/moderators/')).toEqual([]);
    expect(calls('POST', '/moderators')).toEqual([]);
  });

  it('un cambio di ruolo senza email crea la concessione nuova e solo dopo revoca la vecchia', async () => {
    respond((url, init) => (init.method === 'POST' ? json(201, { id: 'nuova' }) : json(200, {})));
    const initial = { ...snapshot(), eventModerators: [senzaEmail('a', 'A')] };
    const form = { ...formWithout(), speakers: [voce('a', 'A')] } as unknown as WizardForm;

    await fanoutEditDiff(EVENT_ID, TOKEN, form, initial, 'it');

    const [post] = calls('POST', '/moderators');
    const body = JSON.parse(String(post![1].body)) as Record<string, unknown>;
    expect(body.role).toBe('SPEAKER');
    expect('email' in body).toBe(false);
    expect(calls('DELETE', '/moderators/').map(([url]) => url)).toEqual([`/api/events/${EVENT_ID}/moderators/a`]);
    expect(initial.eventModerators.map((m) => m.id)).toEqual(['nuova']);
  });

  it('se la concessione nuova non nasce, la vecchia resta', async () => {
    respond((url, init) => (init.method === 'POST' ? json(422, { error: 'Validation failed' }) : json(200, {})));
    const initial = { ...snapshot(), eventModerators: [senzaEmail('a', 'A')] };
    const form = { ...formWithout(), speakers: [voce('a', 'A')] } as unknown as WizardForm;

    const report = await fanoutEditDiff(EVENT_ID, TOKEN, form, initial, 'it');

    expect(calls('DELETE', '/moderators/')).toEqual([]);
    expect(report.failed).toContain('moderators');
    expect(initial.eventModerators.map((m) => m.id)).toEqual(['a']);
  });

  it('riprovando dopo una revoca mancata non crea una seconda concessione', async () => {
    respond((url, init) =>
      init.method === 'POST' ? json(201, { id: 'nuova' }) : init.method === 'DELETE' ? json(500, {}) : json(200, {}),
    );
    const initial = { ...snapshot(), eventModerators: [senzaEmail('a', 'A')] };
    const form = { ...formWithout(), speakers: [voce('a', 'A')] } as unknown as WizardForm;

    const primo = await fanoutEditDiff(EVENT_ID, TOKEN, form, initial, 'it');
    expect(primo.revocationFailed).toEqual(['A']);
    fetchMock.mockClear();
    respond(() => json(200, {}));
    await fanoutEditDiff(EVENT_ID, TOKEN, form, initial, 'it');

    expect(calls('POST', '/moderators')).toEqual([]);
    expect(calls('DELETE', '/moderators/').map(([url]) => url)).toEqual([`/api/events/${EVENT_ID}/moderators/a`]);
    expect(initial.eventModerators.map((m) => m.id)).toEqual(['nuova']);
  });

  it('una bozza vecchia, senza profilo, non cancella il profilo salvato', async () => {
    respond(() => json(200, {}));
    const salvata = { ...senzaEmail('a', 'A'), organization: 'Ente', publicListed: true };
    const initial = { ...snapshot(), eventModerators: [salvata] };
    const form = {
      ...formWithout(),
      moderators: [{ grantId: 'a', name: 'A', email: '', personId: null }],
    } as unknown as WizardForm;

    await fanoutEditDiff(EVENT_ID, TOKEN, form, initial, 'it');

    expect(calls('PATCH', '/moderators/')).toEqual([]);
    expect(calls('DELETE', '/moderators/')).toEqual([]);
  });
});

/**
 * Un questionario con risposte non si svuota dal wizard: la DELETE
 * cancellerebbe anche le risposte, che il passo mostra in sola lettura.
 */
describe('fanoutEditDiff — questionari con risposte', () => {
  const conQuestionario = (risposte: number): InitialEventShape => ({
    ...snapshot(),
    organizers: [],
    eventModerators: [],
    invitations: [],
    materials: [],
    postEventQuestionnaire: { templateIds: ['tpl-1'], adhocQuestions: [] },
    questionnaireResponses: { pre: 0, post: risposte },
  });

  it('con risposte, svuotarlo non manda nessuna richiesta', async () => {
    respond(() => json(200, {}));

    const report = await fanoutEditDiff(EVENT_ID, TOKEN, formWithout(), conQuestionario(4), 'it');

    expect(calls('DELETE', '/questionnaires/')).toHaveLength(0);
    expect(calls('PUT', '/questionnaires/')).toHaveLength(0);
    expect(report.failed).toEqual([]);
  });

  it('le risposte arrivate a wizard aperto: il rifiuto si dice una volta e non si ripete', async () => {
    respond((url, init) =>
      init.method === 'DELETE' && url.includes('/questionnaires/')
        ? json(409, { error: 'The questionnaire has responses: confirm to delete them too.', code: 'HAS_RESPONSES' })
        : json(200, {}),
    );
    const initial = conQuestionario(0);

    const primo = await fanoutEditDiff(EVENT_ID, TOKEN, formWithout(), initial, 'it');
    expect(primo.failed).toEqual(['questionnaires']);
    expect(initial.questionnaireResponses?.post).toBe(1);

    fetchMock.mockClear();
    const secondo = await fanoutEditDiff(EVENT_ID, TOKEN, formWithout(), initial, 'it');
    expect(calls('DELETE', '/questionnaires/')).toHaveLength(0);
    expect(secondo.failed).toEqual([]);
  });

  it('senza risposte, svuotarlo lo elimina come prima', async () => {
    respond(() => json(200, { deleted: true }));

    await fanoutEditDiff(EVENT_ID, TOKEN, formWithout(), conQuestionario(0), 'it');

    const eliminazioni = calls('DELETE', '/questionnaires/');
    expect(eliminazioni).toHaveLength(1);
    expect(eliminazioni[0]![0]).toBe(`/api/admin/events/${EVENT_ID}/questionnaires/POST_EVENT`);
  });
});
