import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

import GuidedFormat from './guided-format';

/**
 * Le quattro domande di un evento nuovo: l'anteprima segue le risposte, e
 * «Continua» porta con se' il formato scelto.
 */

const g = messages.admin.guided;
const f = messages.admin.wizard.flow;
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

function render(onContinue = vi.fn()) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <GuidedFormat onContinue={onContinue} />
      </NextIntlClientProvider>,
    );
  });
  return onContinue;
}

function scegli(testo: string) {
  const label = Array.from(container.querySelectorAll('label')).find((l) =>
    l.querySelector('.formato-scelta__titolo')?.textContent === testo,
  );
  if (!label) throw new Error(`nessuna scelta «${testo}»`);
  act(() => {
    label.click();
  });
}

describe('formato guidato', () => {
  it('parte da «fino a 100, tutti in video, con registrazione», e l anteprima lo dice', () => {
    render();
    const anteprima = container.querySelector('.formato__anteprima')!;
    expect(anteprima.textContent).toContain(f.voiceAll);
    expect(anteprima.textContent).toContain(f.recordingManual);
    expect(anteprima.textContent).toContain(f.accessOpen);
  });

  it('l anteprima segue le risposte, e «Continua» porta il formato', () => {
    const onContinue = render();
    scegli(g.people.piccolo);
    scegli(g.voice.speakers);
    scegli(g.rec.no);
    scegli(g.access.invitation);
    const anteprima = container.querySelector('.formato__anteprima')!;
    expect(anteprima.textContent).toContain(f.voiceSpeakers);
    expect(anteprima.textContent).toContain(g.rec.noDesc);
    expect(anteprima.textContent).toContain(g.previewInvitation);
    const continua = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes(g.continue),
    )!;
    act(() => continua.click());
    expect(onContinue).toHaveBeenCalledWith({
      persone: 'piccolo',
      voce: 'relatori',
      registra: 'no',
      accesso: 'invitati',
    });
  });
});
