// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...resto }: { href: string; children: ReactNode }) => (
    <a href={href} {...resto}>
      {children}
    </a>
  ),
  percorso: (p: string) => p,
}));

import NuovaEtichetta from './nuova-etichetta';

/**
 * Una categoria nuova dal wizard: nasce dal nome, gia' scelta; un nome che
 * c'e' gia' sceglie quella esistente invece di farne una doppia.
 */

const m = messages.admin.wizard.step1;
let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => {
    f(0);
    return 0;
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

function mostra() {
  const onCreata = vi.fn();
  const onScegliEsistente = vi.fn();
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <NuovaEtichetta
          defaultLocale="it"
          esistenti={[{ slug: 'community', name: { it: 'Community' }, color: null }]}
          onCreata={onCreata}
          onScegliEsistente={onScegliEsistente}
        />
      </NextIntlClientProvider>
    );
  });
  return { onCreata, onScegliEsistente };
}

const pulsante = (testo: string) =>
  Array.from(container.querySelectorAll('button')).find((b) =>
    b.textContent?.includes(testo)
  );

function scrivi(valore: string) {
  const input = container.querySelector<HTMLInputElement>('input[type=text]')!;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )!.set!;
  act(() => {
    setter.call(input, valore);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('NuovaEtichetta', () => {
  it('crea la categoria dal nome e la passa al wizard', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ slug: 'to4os-prova', name: { it: 'TO4OS prova' }, color: null }),
        {
          status: 201,
        }
      )
    );
    const { onCreata } = mostra();
    act(() => pulsante(m.newTag)?.click());
    scrivi('  TO4OS prova ');
    await act(async () => pulsante(m.newTagAdd)?.click());

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/admin/tags');
    expect(JSON.parse(init.body as string)).toEqual({
      slug: 'to4os-prova',
      name: { it: 'TO4OS prova' },
    });
    expect(onCreata).toHaveBeenCalledWith({
      slug: 'to4os-prova',
      name: { it: 'TO4OS prova' },
      color: null,
    });
    expect(container.querySelector('[role=status]')?.textContent).toBe(
      m.newTagCreated.replace('{name}', 'TO4OS prova')
    );
  });

  it('due Invio di fila mandano una richiesta sola', async () => {
    let rispondi: (r: Response) => void = () => {};
    fetchMock.mockReturnValue(new Promise<Response>((r) => (rispondi = r)));
    mostra();
    act(() => pulsante(m.newTag)?.click());
    scrivi('Doppio');
    const input = container.querySelector<HTMLInputElement>('input[type=text]')!;
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () =>
      rispondi(
        new Response(
          JSON.stringify({ slug: 'doppio', name: { it: 'Doppio' }, color: null }),
          { status: 201 }
        )
      )
    );
  });

  it('un nome che c e gia sceglie la categoria esistente, senza chiamare il server', () => {
    const { onScegliEsistente } = mostra();
    act(() => pulsante(m.newTag)?.click());
    scrivi('community');
    act(() => pulsante(m.newTagAdd)?.click());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onScegliEsistente).toHaveBeenCalledWith('community');
  });

  it('un nome senza lettere ne cifre si ferma con l avviso', () => {
    mostra();
    act(() => pulsante(m.newTag)?.click());
    scrivi('!!!');
    act(() => pulsante(m.newTagAdd)?.click());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelector('[role=alert]')?.textContent).toBe(m.newTagInvalid);
  });

  it('un nome in un altro alfabeto riceve un indirizzo generato', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ slug: 'categoria-x', name: { it: 'Δήμος' }, color: null }),
        {
          status: 201,
        }
      )
    );
    mostra();
    act(() => pulsante(m.newTag)?.click());
    scrivi('Δήμος');
    await act(async () => pulsante(m.newTagAdd)?.click());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const corpo = JSON.parse(init.body as string) as {
      slug: string;
      name: Record<string, string>;
    };
    expect(corpo.slug).toMatch(/^categoria-[a-z0-9]+$/);
    expect(corpo.name).toEqual({ it: 'Δήμος' });
  });

  it('una categoria creata nel frattempo da altri lo dice', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 409 }));
    mostra();
    act(() => pulsante(m.newTag)?.click());
    scrivi('Nuova');
    await act(async () => pulsante(m.newTagAdd)?.click());
    expect(container.querySelector('[role=alert]')?.textContent).toBe(m.newTagConflict);
  });
});
