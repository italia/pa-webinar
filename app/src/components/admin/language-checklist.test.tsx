// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

import LanguageChecklist, { parseLocaleList } from './language-checklist';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

function monta(value: string | null, onChange = vi.fn()) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <NextIntlClientProvider locale="it" messages={messages}>
        <LanguageChecklist legend="Lingue" value={value} onChange={onChange} />
      </NextIntlClientProvider>,
    );
  });
  return { host, onChange };
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const casella = (h: HTMLElement, nome: string) =>
  [...h.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].find(
    (i) => i.nextElementSibling?.textContent === nome,
  )!;

describe('LanguageChecklist', () => {
  it('legge i codici come la pipeline: minuscoli, validi, senza ripetizioni', () => {
    expect(parseLocaleList(' EN, fr,x,en , pt-br,!!')).toEqual(['en', 'fr', 'pt-br']);
    expect(parseLocaleList(null)).toEqual([]);
  });

  it('un codice salvato fuori dall’elenco resta spuntato e non si perde', () => {
    const onChange = vi.fn();
    const { host } = monta('en,uk', onChange);
    const uk = [...host.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].find((i) => i.id.endsWith('-uk'))!;
    expect(uk.checked).toBe(true);
    expect(host.querySelector('details')?.hasAttribute('open')).toBe(true);
    act(() => casella(host, 'Français').click());
    expect(onChange).toHaveBeenLastCalledWith('en,uk,fr');
  });

  it('prima le quattro lingue piu’ richieste, le altre in un gruppo chiuso', () => {
    const { host } = monta('en,fr,es,de');
    const visibili = [...host.querySelectorAll('.lang-checklist > .lang-checklist__grid label')].map((l) => l.textContent);
    expect(visibili).toEqual(['English', 'Français', 'Español', 'Deutsch']);
    expect(host.querySelector('details')?.hasAttribute('open')).toBe(false);
  });

  it('il gruppo si apre da solo se contiene una lingua gia’ scelta', () => {
    const { host } = monta('en,pl');
    expect(host.querySelector('details')?.hasAttribute('open')).toBe(true);
    expect(host.querySelector('summary')?.textContent).toContain('(1)');
  });

  it('spuntare aggiunge in fondo, togliere l’ultima da’ null', () => {
    const onChange = vi.fn();
    const { host } = monta('fr', onChange);
    act(() => casella(host, 'English').click());
    expect(onChange).toHaveBeenLastCalledWith('fr,en');
    act(() => casella(host, 'Français').click());
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
