import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const percorso = vi.hoisted(() => ({ valore: '/events/[slug]' }));
vi.mock('@/i18n/navigation', () => ({ usePathname: () => percorso.valore }));

import EventDetailLoading from './loading';

/**
 * Il segnaposto della pagina evento avvolge anche la sala: per la sala deve
 * avere la forma e l'altezza della sala d'attesa, o il piede della pagina
 * salta quando la sala arriva.
 */
describe('segnaposto della pagina evento', () => {
  let contenitore: HTMLDivElement;
  let radice: Root;
  beforeEach(() => {
    contenitore = document.createElement('div');
    document.body.appendChild(contenitore);
    radice = createRoot(contenitore);
  });
  afterEach(() => {
    act(() => radice.unmount());
    contenitore.remove();
  });

  it('per la sala mostra il segnaposto della sala', () => {
    percorso.valore = '/events/[slug]/live';
    act(() => radice.render(<EventDetailLoading />));
    expect(contenitore.querySelector('.waiting-shell[aria-busy="true"]')).not.toBeNull();
  });

  it('per la pagina evento e le altre sottopagine resta quello della pagina', () => {
    for (const p of ['/events/[slug]', '/events/[slug]/registration']) {
      percorso.valore = p;
      act(() => radice.render(<EventDetailLoading />));
      expect(contenitore.querySelector('.waiting-shell')).toBeNull();
      expect(contenitore.querySelector('.container.py-5')).not.toBeNull();
    }
  });
});
