// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

import VoiceExcludedNotice from './voice-excluded-notice';

/**
 * L'avviso di chi partecipa fuori dalla registrazione: il suo pulsante e' un
 * consenso, e dice a che cosa.
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

function disegna(props: Partial<ComponentProps<typeof VoiceExcludedNotice>> = {}) {
  const onAcconsenti = vi.fn();
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <VoiceExcludedNotice
          destinazione={null}
          partecipanti="solo-voce"
          onAcconsenti={onAcconsenti}
          inCorso={false}
          errore={false}
          onChiudi={vi.fn()}
          {...props}
        />
      </NextIntlClientProvider>
    );
  });
  return onAcconsenti;
}

const g = messages.gdpr.consent;
const pulsante = () => container.querySelector('button') as HTMLButtonElement;

describe('VoiceExcludedNotice', () => {
  it('si chiude, e il pulsante dice dove restano i consensi', () => {
    const onChiudi = vi.fn();
    disegna({ onChiudi });
    const chiudi = container.querySelector<HTMLButtonElement>(
      '.live-listen-only__chiudi'
    )!;
    expect(chiudi.getAttribute('aria-label')).toBe(messages.live.consents.closeNotice);
    act(() => chiudi.click());
    expect(onChiudi).toHaveBeenCalledTimes(1);
  });

  it("sopra il pulsante c'e' il testo della destinazione in vigore", () => {
    disegna({ destinazione: 'REGISTRANTS' });
    expect(container.textContent).toContain(g.recordingReserved);
    disegna({ destinazione: 'PUBLIC' });
    expect(container.textContent).toContain(g.recordingPublic);
    disegna({ destinazione: null });
    expect(container.textContent).toContain(g.recording);
    disegna({ destinazione: 'PUBLIC', partecipanti: 'assente' });
    expect(container.textContent).toContain(g.recordingNoVideo);
  });

  it("il testo dell'evento si mostra, tranne dove non c'e' un video", () => {
    disegna({ testoConsenso: "Testo dell'ente." });
    expect(container.textContent).toContain("Testo dell'ente.");
    disegna({ testoConsenso: "Testo dell'ente.", partecipanti: 'assente' });
    expect(container.textContent).not.toContain("Testo dell'ente.");
    expect(container.textContent).toContain(g.recordingNoVideo);
  });

  it("il testo dell'ente scorre da se', e il pulsante ne resta fuori", () => {
    disegna({ testoConsenso: "Testo dell'ente." });
    const scatola = container.querySelector<HTMLElement>('.live-listen-only__testo-ente');
    expect(scatola?.textContent).toBe("Testo dell'ente.");
    expect(scatola?.tabIndex).toBe(0);
    expect(scatola?.contains(pulsante())).toBe(false);
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

  it("il testo dell'ente resta, accanto a quello della destinazione", () => {
    disegna({ testoConsenso: "Testo dell'ente.", destinazione: 'PUBLIC' });
    expect(container.textContent).toContain("Testo dell'ente.");
    expect(container.textContent).toContain(g.recordingPublic);
  });
});
