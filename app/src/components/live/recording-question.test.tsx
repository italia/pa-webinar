// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';
import { useRecordingQuestion } from '@/hooks/use-recording-question';

import RecordingQuestion from './recording-question';

/**
 * La domanda della chiamata rapida all'avvio della registrazione: il si' e' un
 * consenso con il suo testo, il no e la chiusura lasciano fuori, e un si' che
 * non riesce si dice.
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
  document.body.innerHTML = '';
});

const t = messages.live.recordingQuestion;

type Props = Parameters<typeof RecordingQuestion>[0];

function disegna(props: Partial<Props> = {}) {
  const tutte: Props = {
    aperta: true,
    destinazione: null,
    voce: 'rimovibile',
    onSi: vi.fn(),
    onNo: vi.fn(),
    inCorso: false,
    errore: false,
    testoCambiato: false,
    ...props,
  };
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <RecordingQuestion {...tutte} />
      </NextIntlClientProvider>
    );
  });
  return tutte;
}

const pulsante = (testo: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === testo
  );

describe("la domanda all'avvio della registrazione", () => {
  it("chiede, con il testo del consenso legato al si'", () => {
    disegna();
    expect(document.body.textContent).toContain(t.title);
    expect(document.body.textContent).toContain(t.question);
    const si = pulsante(t.yes)!;
    const testo = document.getElementById(si.getAttribute('aria-describedby')!);
    expect(testo?.textContent).toContain(messages.gdpr.consent.recording);
    expect(document.body.textContent).toContain(messages.live.consents.button);
  });

  it("si' e no hanno lo stesso peso", () => {
    disegna();
    expect(pulsante(t.yes)!.className).toBe(pulsante(t.no)!.className);
  });

  it("il si' chiama il consenso, il no chiude", () => {
    const props = disegna();
    act(() => pulsante(t.yes)!.click());
    expect(props.onSi).toHaveBeenCalledTimes(1);
    act(() => pulsante(t.no)!.click());
    expect(props.onNo).toHaveBeenCalledTimes(1);
  });

  it("mentre la sala si ricollega nessuna risposta si puo' dare", () => {
    const props = disegna({ inCorso: true });
    expect(pulsante(t.yes)!.disabled).toBe(true);
    expect(pulsante(t.no)!.disabled).toBe(true);
    expect(document.body.textContent).toContain(messages.live.listenOnly.joining);
    expect(props.onNo).not.toHaveBeenCalled();
  });

  it("un errore si dice solo dopo un si' dato qui", () => {
    disegna({ errore: true });
    expect(document.body.textContent).not.toContain(messages.live.listenOnly.error);
    act(() => pulsante(t.yes)!.click());
    disegna({ errore: true });
    expect(document.body.textContent).toContain(messages.live.listenOnly.error);
  });
});

function Sala({ inCorso, fuori }: { inCorso: boolean; fuori: boolean | null }) {
  const domanda = useRecordingQuestion({ attiva: true, inCorso, fuori });
  return (
    <span data-aperta={String(domanda.aperta)}>
      <button type="button" onClick={domanda.rispondi}>
        no
      </button>
    </span>
  );
}

describe('useRecordingQuestion', () => {
  const sala = (inCorso: boolean, fuori: boolean | null) =>
    act(() => root.render(<Sala inCorso={inCorso} fuori={fuori} />));
  const aperta = () => container.querySelector('span')!.dataset.aperta === 'true';

  it("si apre a ogni avvio per chi e' fuori, e un no vale fino al prossimo", () => {
    sala(false, true);
    expect(aperta()).toBe(false);
    sala(true, true);
    expect(aperta()).toBe(true);
    act(() => container.querySelector('button')!.click());
    expect(aperta()).toBe(false);
    sala(false, true);
    sala(true, true);
    expect(aperta()).toBe(true);
  });

  it("chi e' dentro non la vede, nemmeno dopo un ritiro nella stessa registrazione", () => {
    sala(true, false);
    expect(aperta()).toBe(false);
    sala(true, true);
    expect(aperta()).toBe(false);
  });
});
