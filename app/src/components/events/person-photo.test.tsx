import { act } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import PersonPhoto from './person-photo';

/**
 * La foto di una persona, o le sue iniziali. L'indirizzo della foto risponde
 * 404 a chi non può vederla (una persona non presentata, il solo link di
 * conduzione): al posto di un'immagine rotta compaiono le iniziali, anche
 * quando l'errore arriva prima che la pagina venuta dal server si idrati.
 */
const FOTO = '/api/avatar/person/11111111-1111-4111-8111-111111111111';
const ALTRA = '/api/avatar/person/22222222-2222-4222-8222-222222222222';

let container: HTMLDivElement;
let root: Root | null;

const props = {
  name: 'Relatrice Uno',
  size: 48,
  className: 'foto',
  initialsClassName: 'iniziali',
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = null;
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container.remove();
});

function disegna(src: string | null) {
  act(() => {
    root ??= createRoot(container);
    root.render(<PersonPhoto {...props} src={src} loading="lazy" />);
  });
}

describe('PersonPhoto', () => {
  it('con la foto: l’immagine, decorativa, con le sue misure', () => {
    disegna(FOTO);
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toBe(FOTO);
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('width')).toBe('48');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.className).toBe('foto');
  });

  it('senza foto: le iniziali, nascoste ai lettori di schermo', () => {
    disegna(null);
    const span = container.querySelector('span.iniziali')!;
    expect(span.textContent).toBe('RU');
    expect(span.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('img')).toBeNull();
  });

  it('la foto non si vede (404): le iniziali, e una foto nuova si prova di nuovo', () => {
    disegna(FOTO);
    act(() => {
      container.querySelector('img')!.dispatchEvent(new Event('error'));
    });
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('span.iniziali')?.textContent).toBe('RU');

    disegna(ALTRA);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(ALTRA);
  });

  it('un errore arrivato prima dell’idratazione si ripete dopo: le iniziali, non un’immagine rotta', async () => {
    container.innerHTML = renderToString(<PersonPhoto {...props} src={FOTO} />);
    const img = container.querySelector('img')!;
    // Il browser ha già provato a caricarla, prima che React ascolti: finita,
    // senza pixel. Rimettere l'indirizzo rifà la richiesta, che fallisce di
    // nuovo, e questa volta l'errore arriva.
    Object.defineProperty(img, 'complete', { configurable: true, get: () => true });
    let riprovata = 0;
    Object.defineProperty(img, 'src', {
      configurable: true,
      get: () => img.getAttribute('src') ?? '',
      set: (v: string) => {
        riprovata += 1;
        img.setAttribute('src', v);
        queueMicrotask(() => img.dispatchEvent(new Event('error')));
      },
    });
    await act(async () => {
      root = hydrateRoot(container, <PersonPhoto {...props} src={FOTO} />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(riprovata).toBe(1);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('span.iniziali')?.textContent).toBe('RU');
  });

  it('un’immagine ancora in arrivo non si tocca', async () => {
    container.innerHTML = renderToString(<PersonPhoto {...props} src={FOTO} />);
    const img = container.querySelector('img')!;
    Object.defineProperty(img, 'complete', { configurable: true, get: () => false });
    let riprovata = 0;
    Object.defineProperty(img, 'src', {
      configurable: true,
      get: () => img.getAttribute('src') ?? '',
      set: (v: string) => {
        riprovata += 1;
        img.setAttribute('src', v);
      },
    });
    await act(async () => {
      root = hydrateRoot(container, <PersonPhoto {...props} src={FOTO} />);
    });
    expect(riprovata).toBe(0);
    expect(container.querySelector('img')).not.toBeNull();
  });
});
