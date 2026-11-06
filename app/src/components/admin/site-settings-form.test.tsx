// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SiteSetting } from '@prisma/client';

import messages from '@/i18n/messages/it.json';

import SiteSettingsForm from './site-settings-form';

/**
 * L'interruttore della rubrica nelle impostazioni: parte dal valore salvato,
 * e il salvataggio lo manda alla rotta.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  percorso: (p: string) => p,
}));

const s = messages.admin.settings;
const features = s.features;

let container: HTMLDivElement;
let root: Root;
const salva = vi.fn();

function render(impostazioni: Partial<SiteSetting>) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <SiteSettingsForm initialSettings={{ id: 'x', ...impostazioni } as SiteSetting} />
      </NextIntlClientProvider>
    );
  });
  const scheda = container.querySelector<HTMLButtonElement>(
    `button[aria-label="${s.tabs.features}"]`
  )!;
  act(() => {
    scheda.click();
  });
  return container.querySelector<HTMLInputElement>(
    '[data-testid="addressBookEnabled"] input[type="checkbox"]'
  )!;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  salva.mockReset();
  salva.mockImplementation(async (_url: string, init: RequestInit) => ({
    ok: true,
    json: async () => JSON.parse(init.body as string),
  }));
  vi.stubGlobal('fetch', salva);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('impostazioni, rubrica', () => {
  it('mostra etichetta e spiegazione accanto alla registrazione pubblica', () => {
    const interruttore = render({ addressBookEnabled: true });
    expect(interruttore.checked).toBe(true);
    const blocco = container.querySelector('[data-testid="addressBookEnabled"]')!;
    expect(blocco.textContent).toContain(features.addressBookEnabled);
    expect(blocco.textContent).toContain(features.addressBookEnabledHelp);
  });

  it('parte spenta se e salvata spenta', () => {
    expect(render({ addressBookEnabled: false }).checked).toBe(false);
  });

  it('spenta e salvata arriva alla rotta', async () => {
    const interruttore = render({ addressBookEnabled: true });
    act(() => {
      interruttore.click();
    });
    expect(interruttore.checked).toBe(false);
    const salvaBottone = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === messages.common.save
    )!;
    await act(async () => {
      salvaBottone.click();
    });
    expect(salva).toHaveBeenCalledTimes(1);
    const [url, init] = salva.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/admin/settings');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string).addressBookEnabled).toBe(false);
  });

  it('un rifiuto sul campo porta il fuoco sull’interruttore', async () => {
    salva.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        details: [{ path: ['addressBookEnabled'], code: 'invalid_type' }],
      }),
    });
    const interruttore = render({ addressBookEnabled: true });
    const salvaBottone = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === messages.common.save
    )!;
    await act(async () => {
      salvaBottone.click();
    });
    expect(document.activeElement).toBe(interruttore);
    expect(interruttore.getAttribute('aria-invalid')).toBe('true');
  });
});
