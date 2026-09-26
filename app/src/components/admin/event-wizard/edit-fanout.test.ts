import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fanoutEditDiff } from './edit-fanout';
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
      { id: 'org-1', name: 'Ente', organization: 'Ente', logoUrl: null, websiteUrl: null },
    ],
    eventModerators: [
      { id: 'mod-1', name: 'Anna Bianchi', email: 'anna@example.org', role: 'MODERATOR', personId: null },
      { id: 'spk-1', name: 'Luca Verdi', email: 'luca@example.org', role: 'SPEAKER', personId: null },
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
