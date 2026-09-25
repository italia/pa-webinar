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
 */

const SLUG = 'evento-di-prova';
const t = messages.materials;

let container: HTMLDivElement;
let root: Root;
let elenco: { id: string; type: string; title: string; url: string; description: null; addedBy: string; createdAt: string }[];
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

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <MaterialPanel eventSlug={SLUG} token="TOKEN_MODERATORE" isModerator />
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
  vi.stubGlobal('confirm', () => true);
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
    await act(async () => {
      container.querySelector<HTMLButtonElement>(`button[aria-label="${t.deleteMaterial}"]`)!.click();
    });
    await attendi();

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
    await act(async () => {
      container.querySelector<HTMLButtonElement>(`button[aria-label="${t.deleteMaterial}"]`)!.click();
    });
    await attendi();
    expect(erroreLista()).toContain(t.errors.deleteFailed);

    act(() => pulsante(t.addMaterial).click());
    scrivi(campoTitolo(), 'Slide');
    scrivi(campoUrl(), 'https://example.org/slide');
    await invia();
    expect(erroreLista()).not.toContain(t.errors.deleteFailed);
  });
});
