// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

const nav = vi.hoisted(() => ({ pathname: '/admin/events' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));

import { ToastProvider, useToast, type ToastApi } from './toast';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let api: ToastApi;

function Cattura() {
  api = useToast();
  return null;
}

function monta() {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages}>
        <ToastProvider>
          <Cattura />
        </ToastProvider>
      </NextIntlClientProvider>,
    );
  });
}

beforeEach(() => {
  nav.pathname = '/admin/events';
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  monta();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('ToastProvider', () => {
  it('un errore resta finche\' non lo si chiude, ed e\' annunciato subito', () => {
    act(() => api.error('Salvataggio non riuscito'));
    act(() => vi.advanceTimersByTime(10_000));
    const avviso = container.querySelector('[role="alert"]');
    expect(avviso?.textContent).toContain('Salvataggio non riuscito');
    act(() => (avviso!.querySelector('button') as HTMLButtonElement).click());
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('un successo si chiude da solo, ma non mentre il puntatore e\' sopra', () => {
    act(() => api.success('Salvato'));
    const toast = container.querySelector('[role="status"]')!;
    act(() => {
      toast.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    act(() => vi.advanceTimersByTime(10_000));
    expect(container.textContent).toContain('Salvato');
    act(() => {
      toast.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    });
    act(() => vi.advanceTimersByTime(5_000));
    expect(container.textContent).not.toContain('Salvato');
  });

  it('il pulsante di chiusura ha l\'etichetta nella lingua della pagina', () => {
    act(() => api.info('Ciao'));
    expect(container.querySelector('button')?.getAttribute('aria-label')).toBe(messages.common.close);
  });

  it('cambiando pagina un errore si chiude, una conferma resta', () => {
    act(() => {
      api.error('Non salvato');
      api.success('Creato');
    });
    nav.pathname = '/admin/events/1';
    monta();
    expect(container.textContent).not.toContain('Non salvato');
    expect(container.textContent).toContain('Creato');
  });

  it('oltre cinque escono prima le conferme, non un errore non letto', () => {
    act(() => {
      api.error('Errore da leggere');
      for (let i = 0; i < 6; i++) api.success(`Ok ${i}`);
    });
    expect(container.textContent).toContain('Errore da leggere');
    expect(container.querySelectorAll('[role="status"], [role="alert"]').length).toBe(5);
  });

  it('con cinque errori aperti una conferma nuova si vede, ed esce l\'errore piu\' vecchio', () => {
    act(() => {
      for (let i = 0; i < 5; i++) api.error(`Errore ${i}`);
      api.success('Salvato');
    });
    expect(container.textContent).toContain('Salvato');
    expect(container.textContent).not.toContain('Errore 0');
  });

  it('con il fuoco dentro, l\'uscita del puntatore non fa ripartire il conto', () => {
    act(() => api.success('Salvato'));
    const toast = container.querySelector('[role="status"]')!;
    const chiudi = toast.querySelector('button') as HTMLButtonElement;
    act(() => {
      toast.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      chiudi.focus();
      toast.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    });
    act(() => vi.advanceTimersByTime(10_000));
    expect(container.textContent).toContain('Salvato');
  });
});

