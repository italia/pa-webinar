import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

import MaterialPanel from './material-panel';

/**
 * Il pannello «Materiali» di chi conduce: cosa dice e dove lascia il fuoco.
 *
 * - Un link senza titolo non partiva e non diceva nulla: ora lo dice, segna il
 *   campo e ci torna.
 * - Un materiale aggiunto chiudeva il modulo e il fuoco cadeva in cima alla
 *   pagina, senza che nulla dicesse che era entrato.
 * - Un materiale già tolto da un altro moderatore dava «Impossibile eliminare»,
 *   e un errore restava a video anche dopo aggiunte riuscite.
 * - Togliere chiede conferma con il pulsante stesso (primo clic arma, il
 *   secondo toglie), come nel resto della sala, non con una finestra del
 *   browser.
 *
 * I testi nuovi del pannello si cercano per struttura (classi, ruoli) invece
 * che per contenuto, così la prova non dipende dalla traduzione.
 */

const SLUG = 'evento-di-prova';
const t = messages.materials;

let container: HTMLDivElement;
let root: Root;
let elenco: {
  id: string;
  type: string;
  title: string;
  url: string;
  description: string | null;
  addedBy: string | null;
  createdAt: string;
  visibility?: string;
  openCount?: number;
  fileSize?: number | null;
  mimeType?: string | null;
}[];
const fetchMock = vi.fn();

function materiale(id: string) {
  return {
    id,
    type: 'LINK',
    title: `Materiale ${id}`,
    url: 'https://example.org/doc',
    description: null,
    addedBy: 'Moderatore',
    createdAt: '2026-09-25T10:00:00.000Z',
  };
}

async function render({
  isModerator = true,
  testi = messages,
}: { isModerator?: boolean; testi?: typeof messages } = {}) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="it" messages={testi} timeZone="Europe/Rome">
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <MaterialPanel
            eventSlug={SLUG}
            token={isModerator ? 'TOKEN_MODERATORE' : ''}
            isModerator={isModerator}
          />
        </SWRConfig>
      </NextIntlClientProvider>,
    );
  });
  await attendi();
}

/** Lascia finire le richieste in volo e i render che ne seguono. */
async function attendi() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function pulsante(testo: string): HTMLButtonElement {
  const b = Array.from(container.querySelectorAll('button')).find(
    (el) => el.textContent?.trim().endsWith(testo),
  );
  if (!b) throw new Error(`nessun pulsante «${testo}»`);
  return b;
}

function scrivi(el: HTMLInputElement, valore: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(el, valore);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const campoTitolo = () =>
  container.querySelector<HTMLInputElement>(`input[aria-label="${t.titleLabel}"]`)!;
const campoUrl = () => container.querySelector<HTMLInputElement>(`input[aria-label="${t.urlLabel}"]`)!;
const annuncio = () => container.querySelector('[role="status"]')?.textContent ?? '';
const tc = messages.common;
const tv = messages.admin.materials;

/** Il pulsante «Elimina» del materiale con questo titolo, armato o no. */
const eliminaDi = (titolo: string) =>
  container.querySelector<HTMLButtonElement>(
    `button[aria-label^="${t.deleteMaterial}: ${titolo}"]`,
  )!;

/** Primo clic arma, il secondo conferma. */
async function elimina(titolo: string) {
  act(() => eliminaDi(titolo).click());
  await act(async () => {
    eliminaDi(titolo).click();
  });
  await attendi();
}

/** Le richieste fatte con quel metodo, con il corpo già letto. */
function chiamate(metodo: string): { url: string; init: RequestInit }[] {
  return fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === metodo)
    .map(([url, init]) => ({ url: url as string, init: init as RequestInit }));
}

function file(id: string, over: Record<string, unknown> = {}) {
  return {
    ...materiale(id),
    type: 'FILE',
    url: `/api/assets/document/${id}.pdf`,
    mimeType: 'application/pdf',
    fileSize: 2_500_000,
    ...over,
  };
}
const erroreLista = () =>
  Array.from(container.querySelectorAll('[role="alert"]')).map((el) => el.textContent);

async function invia() {
  await act(async () => {
    container.querySelector('form')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
  });
  await attendi();
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  elenco = [materiale('m1')];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      elenco = [materiale('nuovo'), ...elenco];
      return new Response('{}', { status: 201 });
    }
    return new Response(JSON.stringify({ materials: elenco, uploadsEnabled: false }), {
      status: 200,
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  // Nessuna finestra di conferma del browser: se il pannello la chiedesse
  // ancora, questa prova lo direbbe.
  vi.stubGlobal('confirm', () => {
    throw new Error('confirm() non deve più essere usato');
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('MaterialPanel — aggiungere un link', () => {
  it('senza titolo lo dice, segna il campo e ci porta il fuoco', async () => {
    await render();
    act(() => pulsante(t.addMaterial).click());
    scrivi(campoUrl(), 'https://example.org/slide');
    await invia();

    expect(fetchMock).not.toHaveBeenCalledWith(
      `/api/events/${SLUG}/materials`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(erroreLista()).toContain(t.errors.titleMissing);
    expect(campoTitolo().getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(campoTitolo());

    // Scrivere il titolo toglie il segno.
    scrivi(campoTitolo(), 'Slide');
    expect(campoTitolo().getAttribute('aria-invalid')).toBeNull();
  });

  it('aggiunto: lo annuncia e il fuoco torna al pulsante che apre il modulo', async () => {
    await render();
    act(() => pulsante(t.addMaterial).click());
    scrivi(campoTitolo(), 'Slide');
    scrivi(campoUrl(), 'https://example.org/slide');
    await invia();

    expect(container.querySelector('form')).toBeNull();
    expect(annuncio()).toBe(t.materialAdded);
    expect(document.activeElement).toBe(pulsante(t.addMaterial));
  });

  it('annullato: il fuoco torna al pulsante che apre il modulo', async () => {
    await render();
    act(() => pulsante(t.addMaterial).click());
    act(() => pulsante(t.cancel).click());
    expect(document.activeElement).toBe(pulsante(t.addMaterial));
  });
});

describe('MaterialPanel — togliere un materiale', () => {
  it('già tolto da un altro (404): nessun errore, la lista rilegge', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        elenco = [];
        return new Response('{}', { status: 404 });
      }
      return new Response(JSON.stringify({ materials: elenco }), { status: 200 });
    });
    await render();
    await elimina('Materiale m1');

    expect(erroreLista()).not.toContain(t.errors.deleteFailed);
    expect(annuncio()).toBe(t.materialDeleted);
    expect(container.textContent).toContain(t.noMaterials);
  });

  it('un errore vero resta finché un’aggiunta non riesce', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return new Response('{}', { status: 500 });
      if (init?.method === 'POST') {
        elenco = [materiale('nuovo'), ...elenco];
        return new Response('{}', { status: 201 });
      }
      return new Response(JSON.stringify({ materials: elenco }), { status: 200 });
    });
    await render();
    await elimina('Materiale m1');
    expect(erroreLista()).toContain(t.errors.deleteFailed);

    act(() => pulsante(t.addMaterial).click());
    scrivi(campoTitolo(), 'Slide');
    scrivi(campoUrl(), 'https://example.org/slide');
    await invia();
    expect(erroreLista()).not.toContain(t.errors.deleteFailed);
  });
});

describe('MaterialPanel — togliere chiede conferma con il pulsante stesso', () => {
  it('il primo clic arma e non toglie; il secondo toglie', async () => {
    await render();
    act(() => eliminaDi('Materiale m1').click());
    expect(chiamate('DELETE')).toEqual([]);
    expect(eliminaDi('Materiale m1').classList.contains('is-armed')).toBe(true);
    expect(eliminaDi('Materiale m1').getAttribute('aria-label')).toBe(
      `${t.deleteMaterial}: Materiale m1 — ${tc.confirm}`,
    );

    await act(async () => {
      eliminaDi('Materiale m1').click();
    });
    await attendi();
    expect(chiamate('DELETE').map((c) => c.url)).toEqual([`/api/events/${SLUG}/materials/m1`]);
  });

  it('armato su un materiale, il clic su un altro arma quello e non toglie niente', async () => {
    elenco = [materiale('m1'), materiale('m2')];
    await render();
    act(() => eliminaDi('Materiale m1').click());
    act(() => eliminaDi('Materiale m2').click());
    expect(chiamate('DELETE')).toEqual([]);
    expect(eliminaDi('Materiale m1').classList.contains('is-armed')).toBe(false);
    expect(eliminaDi('Materiale m2').classList.contains('is-armed')).toBe(true);
  });

  it('da solo si disarma dopo qualche secondo', async () => {
    await render();
    vi.useFakeTimers();
    try {
      act(() => eliminaDi('Materiale m1').click());
      expect(eliminaDi('Materiale m1').classList.contains('is-armed')).toBe(true);
      act(() => {
        vi.advanceTimersByTime(4_100);
      });
      expect(eliminaDi('Materiale m1').classList.contains('is-armed')).toBe(false);
      // La richiesta di conferma non vale più e non resta da leggere.
      expect(annuncio()).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('armato, lo annuncia nella regione di stato, con il materiale', async () => {
    // Il nome del pulsante che cambia sotto il fuoco quasi nessun lettore di
    // schermo lo legge.
    elenco = [materiale('m1'), materiale('m2')];
    await render();
    act(() => eliminaDi('Materiale m1').click());
    expect(annuncio()).toBe(`${t.deleteMaterial}: Materiale m1. ${t.confirmDelete}`);
    // Un altro materiale: un altro annuncio, non lo stesso testo che non si rileggerebbe.
    act(() => eliminaDi('Materiale m2').click());
    expect(annuncio()).toBe(`${t.deleteMaterial}: Materiale m2. ${t.confirmDelete}`);
  });
});

describe('MaterialPanel — dove va il fuoco dopo aver tolto un materiale', () => {
  beforeEach(() => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        const id = url.split('/').pop();
        elenco = elenco.filter((x) => x.id !== id);
        return new Response('{}', { status: 200 });
      }
      return new Response(JSON.stringify({ materials: elenco }), { status: 200 });
    });
  });

  const titoloDi = (titolo: string) =>
    Array.from(container.querySelectorAll<HTMLAnchorElement>('.material-item__title')).find((a) =>
      a.textContent?.startsWith(titolo),
    );

  it('al titolo della voce seguente', async () => {
    elenco = [materiale('m1'), materiale('m2'), materiale('m3')];
    await render();
    act(() => eliminaDi('Materiale m2').focus());
    await elimina('Materiale m2');
    expect(titoloDi('Materiale m2')).toBeUndefined();
    expect(annuncio()).toBe(t.materialDeleted);
    expect(document.activeElement).toBe(titoloDi('Materiale m3'));
  });

  it('tolta l’ultima voce, al pulsante per aggiungere', async () => {
    elenco = [materiale('m1'), materiale('m2')];
    await render();
    await elimina('Materiale m2');
    expect(document.activeElement).toBe(pulsante(t.addMaterial));
  });

  it('con il modulo aperto, al titolo del pannello', async () => {
    await render();
    act(() => pulsante(t.addMaterial).click());
    await elimina('Materiale m1');
    const titolo = container.querySelector('.live-panel-header__title');
    expect(document.activeElement).toBe(titolo);
    expect(titolo?.getAttribute('tabindex')).toBe('-1');
  });

  it('se non si toglie, il fuoco resta dov’è', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return new Response('{}', { status: 500 });
      return new Response(JSON.stringify({ materials: elenco }), { status: 200 });
    });
    elenco = [materiale('m1'), materiale('m2')];
    await render();
    act(() => eliminaDi('Materiale m1').focus());
    await elimina('Materiale m1');
    expect(erroreLista()).toContain(t.errors.deleteFailed);
    expect(document.activeElement).toBe(eliminaDi('Materiale m1'));
  });
});

describe('MaterialPanel — quando il pubblico vede un materiale', () => {
  const etichette = () =>
    Array.from(container.querySelectorAll('.material-item__badge')).map((el) => el.textContent?.trim());

  it('chi conduce vede la fase di ogni voce, anche del predefinito', async () => {
    // Prima dell'inizio il pubblico non vede il predefinito: senza etichetta
    // chi controlla la sala in anticipo non se ne accorgerebbe.
    elenco = [
      { ...materiale('m1'), visibility: 'ALWAYS' },
      { ...materiale('m2'), visibility: 'BEFORE' },
    ];
    await render();
    expect(etichette()).toEqual([tv.visibilityAlways, tv.visibilityBefore]);
  });

  it('il pubblico non vede etichette', async () => {
    elenco = [{ ...materiale('m1'), visibility: 'ALWAYS' }];
    await render({ isModerator: false });
    expect(etichette()).toEqual([]);
  });
});

describe('MaterialPanel — chi ha aggiunto il materiale', () => {
  it('un nome si mostra; nessun nome, o una parola fissa del passato, diventa la dicitura tradotta', async () => {
    elenco = [
      { ...materiale('a'), title: 'Con nome', addedBy: 'Conduzione' },
      { ...materiale('b'), title: 'Senza nome', addedBy: null },
      { ...materiale('c'), title: 'Parola fissa', addedBy: 'Moderator' },
    ];
    await render({ isModerator: false });
    const testo = container.textContent ?? '';
    expect(testo).toContain(t.addedBy.replace('{name}', 'Conduzione'));
    expect(testo).not.toContain(t.addedBy.replace('{name}', 'Moderator'));
    expect(testo.split(t.addedByStaff).length - 1).toBe(2);
  });
});

describe('MaterialPanel — caricare un file', () => {
  beforeEach(() => {
    fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify({ materials: elenco, uploadsEnabled: true }), { status: 200 }),
    );
  });

  async function modoFile() {
    await render();
    act(() => pulsante(t.addMaterial).click());
    act(() => pulsante(t.modeFile).click());
  }

  function scegli(file: File) {
    const input = container.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  const campoTitoloFile = () =>
    container.querySelector<HTMLInputElement>(`input[aria-label="${t.titleOptional}"]`)!;

  it('un file scelto si vede con nome e peso, e il titolo si propone dal nome', async () => {
    await modoFile();
    scegli(new File(['%PDF-1.7'], 'slide_finali.pdf', { type: 'application/pdf' }));
    expect(container.querySelector('.material-panel__chosen-name')?.textContent).toContain('slide_finali.pdf');
    expect(campoTitoloFile().value).toBe('slide finali');
    // Cambiato il file, il titolo proposto lo segue.
    scegli(new File(['PK'], 'Bilancio.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }));
    expect(campoTitoloFile().value).toBe('Bilancio');
  });

  it('un titolo scritto a mano non viene sovrascritto da un altro file', async () => {
    await modoFile();
    scegli(new File(['%PDF'], 'a.pdf', { type: 'application/pdf' }));
    scrivi(campoTitoloFile(), 'Il mio titolo');
    scegli(new File(['%PDF'], 'b.pdf', { type: 'application/pdf' }));
    expect(campoTitoloFile().value).toBe('Il mio titolo');
  });

  it('un tipo non ammesso si rifiuta subito, prima dell’invio', async () => {
    await modoFile();
    scegli(new File(['x'], 'foto.png', { type: 'image/png' }));
    expect(container.querySelector('.material-panel__chosen')).toBeNull();
    expect(erroreLista().join(' ')).toContain(t.errors.fileType);
  });
});

describe('MaterialPanel — ogni voce dice dove porta', () => {
  it('un link mostra il sito; un file tipo e peso', async () => {
    elenco = [
      { ...materiale('l'), url: 'https://www.example.org/programma' },
      file('f'),
    ];
    await render({ isModerator: false });
    const meta = Array.from(container.querySelectorAll('.material-item__meta')).map((el) =>
      el.textContent?.trim(),
    );
    expect(meta[0]).toBe('example.org');
    expect(meta[1]).toMatch(/^PDF · 2,4\sMB$/);
  });
});

describe('MaterialPanel — quante volte è stato aperto', () => {
  it('chi conduce vede il numero, per file e per link', async () => {
    elenco = [
      { ...materiale('l'), openCount: 5 },
      file('f', { openCount: 12 }),
    ];
    // Qui conta quale messaggio riceve quale numero; le parole sono del
    // catalogo, e i due messaggi di prova le sostituiscono con un'etichetta.
    const materials: Record<string, unknown> = {
      ...messages.materials,
      openCount: 'aperture: {count}',
      downloadCount: 'download: {count}',
    };
    await render({ testi: { ...messages, materials } as typeof messages });
    const numeri = Array.from(container.querySelectorAll('.material-item__count')).map(
      (el) => el.textContent,
    );
    expect(numeri).toEqual(['aperture: 5', 'download: 12']);
  });

  it('il pubblico non lo riceve e non lo vede', async () => {
    elenco = [materiale('l')];
    await render({ isModerator: false });
    expect(container.querySelector('.material-item__count')).toBeNull();
  });
});

describe('MaterialPanel — aprire un materiale lo conta', () => {
  // jsdom non naviga: il clic sul link resta un evento, come nel browser
  // quando la scheda nuova si apre.
  const fermaNavigazione = (e: Event) => e.preventDefault();
  beforeEach(() => document.addEventListener('click', fermaNavigazione, true));
  afterEach(() => document.removeEventListener('click', fermaNavigazione, true));

  const aperture = () =>
    fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/opened'));

  it('il clic sul titolo manda il conteggio con il token, senza aspettare', async () => {
    await render({ isModerator: false });
    const titolo = container.querySelector<HTMLAnchorElement>('.material-item__title')!;
    expect(titolo.getAttribute('href')).toBe('https://example.org/doc');
    expect(titolo.getAttribute('target')).toBe('_blank');
    act(() => titolo.click());
    expect(aperture()).toHaveLength(1);
    expect(aperture()[0]![0]).toBe(`/api/events/${SLUG}/materials/m1/opened`);
    expect(aperture()[0]![1]).toMatchObject({ method: 'POST', keepalive: true });
  });

  it('chi ha un token lo manda come Bearer', async () => {
    await render();
    act(() => container.querySelector<HTMLAnchorElement>('.material-item__open')!.click());
    expect(aperture()[0]![1]).toMatchObject({
      headers: { Authorization: 'Bearer TOKEN_MODERATORE' },
    });
  });

  it('conta il clic centrale, non il destro', async () => {
    await render({ isModerator: false });
    const titolo = container.querySelector<HTMLAnchorElement>('.material-item__title')!;
    act(() => {
      titolo.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }));
      titolo.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 2 }));
    });
    expect(aperture()).toHaveLength(1);
  });
});

describe('MaterialPanel — filtrare un elenco lungo', () => {
  const filtri = () => Array.from(container.querySelectorAll<HTMLButtonElement>('.material-panel__filter'));
  const titoli = () =>
    Array.from(container.querySelectorAll('.material-item__title')).map((el) =>
      el.firstChild?.textContent,
    );

  it('poche voci: niente filtro', async () => {
    elenco = [materiale('l1'), file('f1'), materiale('l2'), file('f2')];
    await render({ isModerator: false });
    expect(filtri()).toEqual([]);
  });

  it('solo link: niente filtro, anche con molte voci', async () => {
    elenco = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => materiale(id));
    await render({ isModerator: false });
    expect(filtri()).toEqual([]);
  });

  it('file e link mescolati: tutti, solo i file, solo i link', async () => {
    elenco = [materiale('l1'), file('f1'), materiale('l2'), file('f2'), file('f3')];
    await render({ isModerator: false });
    expect(filtri()).toHaveLength(3);
    expect(filtri().map((b) => b.querySelector('.material-panel__filter-count')?.textContent)).toEqual([
      '5',
      '3',
      '2',
    ]);
    expect(filtri()[0]!.getAttribute('aria-pressed')).toBe('true');

    act(() => filtri()[1]!.click());
    expect(titoli()).toEqual(['Materiale f1', 'Materiale f2', 'Materiale f3']);
    expect(filtri()[1]!.getAttribute('aria-pressed')).toBe('true');

    act(() => filtri()[2]!.click());
    expect(titoli()).toEqual(['Materiale l1', 'Materiale l2']);
  });
});

describe('MaterialPanel — correggere un materiale', () => {
  const modifica = (titolo: string) =>
    container.querySelector<HTMLButtonElement>(`button[aria-label="${tv.editButton}: ${titolo}"]`)!;
  const modulo = () => container.querySelector<HTMLFormElement>('.material-item__edit');

  async function salva() {
    await act(async () => {
      modulo()!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await attendi();
  }

  beforeEach(() => {
    elenco = [{ ...materiale('m1'), description: 'Prima versione', visibility: 'ALWAYS' }];
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        const patch = JSON.parse(String(init.body)) as Record<string, unknown>;
        elenco = elenco.map((m) => ({ ...m, ...patch }));
        return new Response(JSON.stringify(elenco[0]), { status: 200 });
      }
      return new Response(JSON.stringify({ materials: elenco }), { status: 200 });
    });
  });

  it('il pubblico non ha gli strumenti', async () => {
    await render({ isModerator: false });
    expect(container.querySelector('.material-item__tools')).toBeNull();
  });

  it('si apre al suo posto con i valori della riga, e il fuoco va al titolo', async () => {
    await render();
    act(() => modifica('Materiale m1').click());
    const [titolo, descrizione] = Array.from(modulo()!.querySelectorAll('input'));
    expect(titolo!.value).toBe('Materiale m1');
    expect(descrizione!.value).toBe('Prima versione');
    expect(modulo()!.querySelector('select')!.value).toBe('ALWAYS');
    expect(document.activeElement).toBe(titolo);
  });

  it('manda solo ciò che è cambiato, con il token, e la lista rilegge', async () => {
    await render();
    act(() => modifica('Materiale m1').click());
    const titolo = modulo()!.querySelector('input')!;
    scrivi(titolo, 'Slide finali');
    const fase = modulo()!.querySelector('select')!;
    act(() => {
      fase.value = 'AFTER';
      fase.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await salva();

    const [patch] = chiamate('PATCH');
    expect(patch!.url).toBe(`/api/events/${SLUG}/materials/m1`);
    expect(patch!.init.headers).toMatchObject({ Authorization: 'Bearer TOKEN_MODERATORE' });
    expect(JSON.parse(String(patch!.init.body))).toEqual({ title: 'Slide finali', visibility: 'AFTER' });
    expect(modulo()).toBeNull();
    expect(annuncio()).not.toBe('');
    expect(container.textContent).toContain('Slide finali');
    // Il fuoco torna al pulsante che aveva aperto la modifica.
    expect(document.activeElement).toBe(modifica('Slide finali'));
  });

  it('niente di cambiato: si chiude senza chiamare il server', async () => {
    await render();
    act(() => modifica('Materiale m1').click());
    await salva();
    expect(chiamate('PATCH')).toEqual([]);
    expect(modulo()).toBeNull();
  });

  it('un titolo vuoto non parte: lo dice e resta nel modulo', async () => {
    await render();
    act(() => modifica('Materiale m1').click());
    const titolo = modulo()!.querySelector('input')!;
    scrivi(titolo, '   ');
    await salva();
    expect(chiamate('PATCH')).toEqual([]);
    expect(titolo.getAttribute('aria-invalid')).toBe('true');
    expect(modulo()!.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('un rifiuto del server resta nel modulo, che non si chiude', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return new Response('{}', { status: 500 });
      return new Response(JSON.stringify({ materials: elenco }), { status: 200 });
    });
    await render();
    act(() => modifica('Materiale m1').click());
    scrivi(modulo()!.querySelector('input')!, 'Altro');
    await salva();
    expect(modulo()).not.toBeNull();
    expect(modulo()!.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('Esc annulla', async () => {
    await render();
    act(() => modifica('Materiale m1').click());
    act(() => {
      modulo()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(modulo()).toBeNull();
  });
});

describe('MaterialPanel — copiare un link', () => {
  const copia = () =>
    container.querySelectorAll<HTMLButtonElement>('.material-item__tools button')[0]!;

  it('copia l’indirizzo e lo annuncia', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    await render();
    await act(async () => {
      copia().click();
    });
    expect(writeText).toHaveBeenCalledWith('https://example.org/doc');
    expect(annuncio()).not.toBe('');
    expect(copia().classList.contains('is-done')).toBe(true);
  });

  it('se il browser non lo permette, lo dice', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('negato')) },
    });
    await render();
    await act(async () => {
      copia().click();
    });
    expect(erroreLista()).toHaveLength(1);
  });

  it('un file non ha «copia link»: il suo indirizzo è quello del download', async () => {
    elenco = [file('f1')];
    await render();
    // Restano modifica ed elimina.
    expect(container.querySelectorAll('.material-item__tools button')).toHaveLength(2);
  });
});

describe('MaterialPanel — la fase scelta all’aggiunta', () => {
  it('un link parte con la fase scelta', async () => {
    await render();
    act(() => pulsante(t.addMaterial).click());
    scrivi(campoTitolo(), 'Programma');
    scrivi(campoUrl(), 'https://example.org/programma');
    const fase = container.querySelector<HTMLSelectElement>('form select')!;
    expect(fase.value).toBe('ALWAYS');
    act(() => {
      fase.value = 'BEFORE';
      fase.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await invia();
    const [post] = chiamate('POST');
    expect(JSON.parse(String(post!.init.body))).toMatchObject({
      title: 'Programma',
      url: 'https://example.org/programma',
      visibility: 'BEFORE',
    });
  });
});
