// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

import StepPermissions, { type StepPermissionsValue } from './step-3-permissions';

/**
 * La parte «registrazione» delle impostazioni avanzate, su un'installazione
 * che non puo' registrare: non propone niente, ma un evento che ha gia' la
 * registrazione accesa la mostra, per poterla spegnere.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  percorso: (p: string) => p,
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/',
}));

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

function render(recordingEnabled: boolean, recordingAvailable: boolean) {
  const value = {
    recordingEnabled,
    permissionMatrix: {},
  } as unknown as StepPermissionsValue;
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <StepPermissions
          parte="registrazione"
          value={value}
          onChange={vi.fn()}
          whiteboardInfraReady={false}
          recordingAvailable={recordingAvailable}
        />
      </NextIntlClientProvider>
    );
  });
}

describe('registrazione nelle impostazioni avanzate', () => {
  const interruttore = () =>
    container.querySelector(`[aria-label="${messages.admin.form.recordingEnabled}"]`);

  it('dove si puo registrare propone l interruttore', () => {
    render(false, true);
    expect(interruttore()).not.toBeNull();
  });

  it('dove non si puo registrare dice perche e non propone niente', () => {
    render(false, false);
    expect(interruttore()).toBeNull();
    expect(container.textContent).toBe(messages.admin.recording.notConfigured);
  });

  it('un evento che ha gia la registrazione accesa la puo spegnere', () => {
    render(true, false);
    expect(interruttore()).not.toBeNull();
  });
});
