import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

import TemplateManagement from './template-management';

/**
 * L'interruttore della lavagna nel modulo dei modelli: la sala mostra la
 * lavagna solo se l'installazione ne ha il servizio, quindi il modello non
 * deve prometterla quando manca.
 */

vi.mock('@/components/ui/confirm-dialog', () => ({
  useConfirm: () => async () => true,
}));

const t = messages.admin.templates;

let container: HTMLDivElement;
let root: Root;

function render(whiteboardInfraReady: boolean) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <TemplateManagement templates={[]} whiteboardInfraReady={whiteboardInfraReady} />
      </NextIntlClientProvider>,
    );
  });
  const nuovo = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === t.create,
  );
  if (!nuovo) throw new Error('pulsante «Nuovo template» non trovato');
  act(() => {
    nuovo.click();
  });
}

function interruttoreLavagna(): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>(
    `input[aria-label="${t.whiteboardLabel}"]`,
  );
  if (!el) throw new Error('interruttore della lavagna non trovato');
  return el;
}

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

describe('TemplateManagement — lavagna', () => {
  it('senza il servizio lavagna non si accende e dice perche', () => {
    render(false);
    expect(interruttoreLavagna()).toBeDisabled();
    expect(container.textContent).toContain(messages.admin.form.whiteboardUnavailable);
  });

  it('con il servizio lavagna si accende come prima', () => {
    render(true);
    expect(interruttoreLavagna()).toBeEnabled();
    expect(container.textContent).not.toContain(messages.admin.form.whiteboardUnavailable);
    act(() => {
      interruttoreLavagna().click();
    });
    expect(interruttoreLavagna()).toBeChecked();
  });
});
