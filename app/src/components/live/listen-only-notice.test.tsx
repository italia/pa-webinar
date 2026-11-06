// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

import ListenOnlyNotice from './listen-only-notice';

/**
 * L'avviso di chi e' in solo ascolto: il suo pulsante e' un consenso, e dice a
 * che cosa.
 */

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

function disegna(props: Partial<ComponentProps<typeof ListenOnlyNotice>> = {}) {
  const onAcconsenti = vi.fn();
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <ListenOnlyNotice
          destinazione={null}
          voce="fissa"
          onAcconsenti={onAcconsenti}
          inCorso={false}
          errore={false}
          {...props}
        />
      </NextIntlClientProvider>
    );
  });
  return onAcconsenti;
}

const g = messages.gdpr.consent;
const pulsante = () => container.querySelector('button') as HTMLButtonElement;

describe('ListenOnlyNotice', () => {
  it("sopra il pulsante c'e' il testo della destinazione in vigore", () => {
    disegna({ destinazione: 'REGISTRANTS' });
    expect(container.textContent).toContain(g.recordingReserved);
    disegna({ destinazione: 'PUBLIC' });
    expect(container.textContent).toContain(g.recordingPublic);
    disegna({ destinazione: null });
    expect(container.textContent).toContain(g.recording);
    disegna({ destinazione: 'PUBLIC', voce: 'assente' });
    expect(container.textContent).toContain(g.recordingNoVideo);
  });

  it("il pulsante e' descritto da quel testo, e il clic acconsente", () => {
    const onAcconsenti = disegna({ destinazione: 'PUBLIC' });
    const id = pulsante().getAttribute('aria-describedby');
    expect(document.getElementById(id ?? '')?.textContent).toBe(g.recordingPublic);
    act(() => pulsante().click());
    expect(onAcconsenti).toHaveBeenCalledTimes(1);
  });

  it("in corso il pulsante e' fermo", () => {
    disegna({ inCorso: true });
    expect(pulsante().disabled).toBe(true);
    expect(pulsante().textContent).toBe(messages.live.listenOnly.joining);
  });

  it('un errore e un testo cambiato si dicono in modo diverso', () => {
    disegna({ errore: true });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      messages.live.listenOnly.error
    );
    disegna({ testoCambiato: true });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      messages.live.consents.textChanged
    );
    disegna();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
