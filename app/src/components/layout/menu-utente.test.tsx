// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

const percorso = { valore: '/admin/events' };
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => percorso.valore,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  Link: ({ href, children, ...resto }: { href: string; children: ReactNode }) => (
    <a href={href} {...resto}>
      {children}
    </a>
  ),
}));

import MenuUtente from './menu-utente';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mostra(pagina: string) {
  percorso.valore = pagina;
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <MenuUtente staff={{ ruolo: 'admin', nome: 'Persona Staff' }} />
      </NextIntlClientProvider>
    );
  });
  return container.querySelector('a[href="/admin/events"]');
}

describe('menu utente', () => {
  it('nell amministrazione non ripete il menu: solo chi e entrato e l uscita', () => {
    expect(mostra('/admin/events/[id]')).toBeNull();
    expect(container.textContent).toContain(messages.admin.login.logout);
  });

  it('dalle pagine pubbliche riporta all amministrazione', () => {
    expect(mostra('/events/[slug]')?.textContent).toContain(messages.nav.admin);
  });
});
