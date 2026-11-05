import { act, type AnchorHTMLAttributes } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

const percorso = vi.hoisted(() => ({ valore: '/admin/events' }));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => percorso.valore,
  Link: ({
    href,
    ...resto
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...resto} />
  ),
}));

import AdminNav, { VOCI_PER_MEGAMENU } from './admin-nav';
import { sezioniPerRuolo } from './admin-nav-model';

/**
 * Il menu dell'amministrazione e' la fascia di navigazione di Bootstrap
 * Italia: il markup deve essere il loro (classi, ruoli, attributi), perche'
 * stili e comportamento sui telefoni vengono da li'.
 */
describe('menu dell’amministrazione', () => {
  let contenitore: HTMLDivElement;
  let radice: Root;
  // jsdom non ha matchMedia: lo schermo e' quello di un telefono, e il test
  // puo' «allargarlo» chiamando chi ascolta.
  let allarga: ((e: { matches: boolean }) => void) | null;
  beforeEach(() => {
    allarga = null;
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => {
        allarga = fn;
      },
      removeEventListener: () => {},
    }));
    percorso.valore = '/admin/events';
    contenitore = document.createElement('div');
    document.body.appendChild(contenitore);
    radice = createRoot(contenitore);
    act(() =>
      radice.render(
        <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
          <AdminNav role="admin" />
        </NextIntlClientProvider>
      )
    );
  });
  afterEach(() => {
    act(() => radice.unmount());
    contenitore.remove();
  });

  const tasto = (key: string) =>
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    });

  it('sta nella fascia di navigazione dell’header, con hamburger e pannello', () => {
    expect(
      contenitore.querySelector('.it-header-navbar-wrapper nav.navbar.has-megamenu')
    ).not.toBeNull();
    expect(contenitore.querySelector('.custom-navbar-toggler')).not.toBeNull();
    expect(
      contenitore.querySelector('.navbar-collapsable .menu-wrapper ul.navbar-nav')
    ).not.toBeNull();
  });

  it('megamenu solo per le sezioni ricche, tendina per le altre', () => {
    const sezioni = sezioniPerRuolo('admin');
    const voci = Array.from(contenitore.querySelectorAll('ul.navbar-nav > li.nav-item'));
    expect(voci).toHaveLength(sezioni.length);
    voci.forEach((li, i) => {
      const quante = sezioni[i]?.voci.length ?? 0;
      const ricca = quante >= VOCI_PER_MEGAMENU;
      expect(li.classList.contains('megamenu')).toBe(ricca);
      const pulsante = li.querySelector('button.nav-link.dropdown-toggle')!;
      const pannello = li.querySelector('.dropdown-menu')!;
      expect(pannello.getAttribute('role')).toBe('region');
      expect(pannello.getAttribute('aria-labelledby')).toBe(pulsante.id);
      expect(pulsante.getAttribute('aria-controls')).toBe(pannello.id);
      expect(pannello.querySelectorAll('a.list-item.dropdown-item')).toHaveLength(quante);
    });
  });

  it('segna la sezione e la pagina correnti', () => {
    const attiva = contenitore.querySelector('li.nav-item.active')!;
    const pulsante = attiva.querySelector('button')!;
    expect(pulsante.classList.contains('active')).toBe(true);
    expect(pulsante.getAttribute('aria-current')).toBe('location');
    expect(attiva.querySelector('a[aria-current="page"]')?.getAttribute('href')).toBe(
      '/admin/events'
    );
    expect(contenitore.querySelectorAll('li.nav-item.active')).toHaveLength(1);
  });

  it('la sezione si apre al clic e si chiude con Esc', () => {
    const pulsante = contenitore.querySelector<HTMLButtonElement>('li.nav-item button')!;
    const pannello = contenitore.querySelector('li.nav-item .dropdown-menu')!;
    act(() => pulsante.click());
    expect(pulsante.getAttribute('aria-expanded')).toBe('true');
    expect(pannello.classList.contains('show')).toBe(true);
    tasto('Escape');
    expect(pulsante.getAttribute('aria-expanded')).toBe('false');
    expect(pannello.classList.contains('show')).toBe(false);
  });

  it('il pannello dei telefoni prende il fuoco e lo restituisce all’hamburger', () => {
    const hamburger = contenitore.querySelector<HTMLButtonElement>(
      '.custom-navbar-toggler'
    )!;
    const pannello = contenitore.querySelector('.navbar-collapsable')!;
    act(() => hamburger.click());
    expect(hamburger.getAttribute('aria-expanded')).toBe('true');
    expect(pannello.classList.contains('expanded')).toBe(true);
    expect(document.activeElement).toBe(contenitore.querySelector('.close-menu'));
    tasto('Escape');
    expect(pannello.classList.contains('expanded')).toBe(false);
    expect(document.activeElement).toBe(hamburger);
  });

  it('con una sezione aperta nel pannello, Esc chiude prima la sezione', () => {
    const hamburger = contenitore.querySelector<HTMLButtonElement>(
      '.custom-navbar-toggler'
    )!;
    const pannello = contenitore.querySelector('.navbar-collapsable')!;
    const sezione = contenitore.querySelector<HTMLButtonElement>('li.nav-item button')!;
    act(() => hamburger.click());
    act(() => sezione.click());
    tasto('Escape');
    expect(sezione.getAttribute('aria-expanded')).toBe('false');
    expect(pannello.classList.contains('expanded')).toBe(true);
    tasto('Escape');
    expect(pannello.classList.contains('expanded')).toBe(false);
    expect(document.activeElement).toBe(hamburger);
  });

  it('se lo schermo si allarga, il pannello si chiude', () => {
    const hamburger = contenitore.querySelector<HTMLButtonElement>(
      '.custom-navbar-toggler'
    )!;
    const pannello = contenitore.querySelector('.navbar-collapsable')!;
    act(() => hamburger.click());
    expect(pannello.getAttribute('role')).toBe('dialog');
    act(() => allarga?.({ matches: true }));
    expect(pannello.classList.contains('expanded')).toBe(false);
    expect(pannello.getAttribute('role')).toBeNull();
  });
});
