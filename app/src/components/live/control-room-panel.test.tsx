import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

import ControlRoomPanel, { type FunzioneSala } from './control-room-panel';

vi.mock('./presentation-timer', () => ({ PresentationTimerControls: () => null }));

let container: HTMLDivElement;
let root: Root;
const onToggle = vi.fn();

const funzioni: FunzioneSala[] = [
  { key: 'chatEnabled', label: 'Chat', on: true },
  { key: 'qaEnabled', label: 'Domande', on: false },
];

function disegna(lista: FunzioneSala[] = funzioni) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages}>
        <ControlRoomPanel
          api={null}
          eventId="e1"
          token="t"
          recordingEnabled={false}
          isRecording={false}
          faseRegistratore={null}
          registrazione={{ azionabile: false, bloccato: false, inPausa: false, avvia: vi.fn(), ferma: vi.fn(), avviso: '' }}
          funzioni={lista}
          onToggleFunzione={onToggle}
          lavagna={false}
          eventSlug="evento"
        />
      </NextIntlClientProvider>,
    );
  });
}

const interruttore = (nome: string) =>
  Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"], [role="switch"]')).find((el) =>
    (el.closest('label')?.textContent ?? el.getAttribute('aria-label') ?? '').includes(nome),
  );

const pulsante = (testo: string) =>
  Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === testo);

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  onToggle.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Regia — funzioni della sala', () => {
  it('spegnere chiede conferma sul posto, e solo la conferma spegne', () => {
    disegna();
    act(() => interruttore('Chat')!.click());
    expect(onToggle).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Spegnere «Chat» per tutti?');
    act(() => pulsante(messages.common.cancel)!.click());
    expect(container.textContent).not.toContain('Spegnere «Chat» per tutti?');
    act(() => interruttore('Chat')!.click());
    act(() => pulsante(messages.live.controlRoom.turnOff)!.click());
    expect(onToggle).toHaveBeenCalledWith('chatEnabled', true);
  });

  it('accendere e\' immediato', () => {
    disegna();
    act(() => interruttore('Domande')!.click());
    expect(onToggle).toHaveBeenCalledWith('qaEnabled', false);
  });

  it('se un altro la spegne mentre si conferma, la domanda non torna alla riaccensione', () => {
    disegna();
    act(() => interruttore('Chat')!.click());
    expect(container.textContent).toContain('Spegnere «Chat» per tutti?');
    disegna([{ ...funzioni[0]!, on: false }, funzioni[1]!]);
    disegna();
    expect(container.textContent).not.toContain('Spegnere «Chat» per tutti?');
  });

  it('Esc chiude la domanda', () => {
    disegna();
    act(() => interruttore('Chat')!.click());
    const domanda = container.querySelector<HTMLElement>('[role="alertdialog"]')!;
    expect(document.activeElement).toBe(domanda);
    act(() => {
      domanda.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(onToggle).not.toHaveBeenCalled();
  });
});

