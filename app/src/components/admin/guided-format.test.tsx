// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

function render(
  onContinue = vi.fn(),
  recordingAvailable = true,
  props: Partial<React.ComponentProps<typeof GuidedFormat>> = {},
) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <GuidedFormat onContinue={onContinue} recordingAvailable={recordingAvailable} {...props} />
      </NextIntlClientProvider>,
    );
  });
  return onContinue;
}

const anteprima = () => container.querySelector('.formato__anteprima')!.textContent ?? '';

function continua() {
  const pulsante = Array.from(container.querySelectorAll('button')).find((b) =>
    b.textContent?.includes(g.continue),
  )!;
  act(() => pulsante.click());
}

/** La risposta scelta alla domanda sulla registrazione. */
function registraScelta() {
  const scelta = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]')).find(
    (i) => i.name.endsWith('-registra') && i.checked,
  );
  return scelta?.value;
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

describe('formato guidato, dove il video della sala non c e', () => {
  const assente = { partecipantiNelVideo: 'assente' } as const;
  const risposte = () =>
    Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
      .filter((i) => i.name.endsWith('-registra'))
      .map((i) => i.value);

  it('non propone un video pubblico', () => {
    render(vi.fn(), true, assente);
    expect(risposte()).toEqual(['riservata', 'no']);
    expect(container.textContent).not.toContain(g.rec.publicDesc);
  });

  it('la risposta che il formato avrebbe proposto resta visibile come riservata', () => {
    render(vi.fn(), true, assente);
    expect(registraScelta()).toBe('riservata');
    expect(anteprima()).toContain(f.recordingDestinationReserved);
    expect(anteprima()).not.toContain(f.recordingDestinationPublic);
  });

  it('una risposta pubblica rimasta nell indirizzo non si promette', () => {
    const onContinue = render(vi.fn(), true, {
      ...assente,
      initial: { persone: 'medio', voce: 'tutti', registra: 'pubblica', accesso: 'tutti' },
    });
    expect(registraScelta()).toBe('riservata');
    continua();
    expect(onContinue).toHaveBeenCalledWith(expect.objectContaining({ registra: 'riservata' }));
  });

  it('il no resta no, e le domande restano sulla pagina', () => {
    const onContinue = render(vi.fn(), true, assente);
    scegli(g.rec.no);
    expect(registraScelta()).toBe('no');
    continua();
    expect(onContinue).toHaveBeenCalledWith(expect.objectContaining({ registra: 'no' }));
  });

  it('con il video le tre risposte restano', () => {
    render(vi.fn(), true, { partecipantiNelVideo: 'visibili' });
    expect(risposte()).toEqual(['riservata', 'pubblica', 'no']);
  });
});

describe('formato guidato', () => {
  it('parte da «fino a 100, tutti in video, con registrazione», e l anteprima lo dice', () => {
    render();
    expect(anteprima()).toContain(f.voiceAll);
    expect(anteprima()).toContain(f.recordingManual);
    expect(anteprima()).toContain(f.accessOpen);
  });

  it('l anteprima segue le risposte, e «Continua» porta il formato', () => {
    const onContinue = render();
    scegli(g.people.piccolo);
    scegli(g.voice.speakers);
    scegli(g.rec.no);
    scegli(g.access.invitation);
    expect(anteprima()).toContain(f.voiceSpeakers);
    expect(anteprima()).toContain(g.rec.noDesc);
    expect(anteprima()).toContain(g.previewInvitation);
    continua();
    expect(onContinue).toHaveBeenCalledWith({
      persone: 'piccolo',
      voce: 'relatori',
      registra: 'no',
      accesso: 'invitati',
    });
  });

  it('dove non si puo registrare non fa la domanda e non promette la registrazione', () => {
    const onContinue = render(vi.fn(), false);
    expect(container.textContent).not.toContain(g.recQ);
    expect(container.textContent).not.toContain(f.recordingManual);
    expect(container.textContent).toContain(g.introNoRecording);
    expect(container.textContent).not.toContain(g.intro);
    expect(container.textContent).not.toContain(f.recordingDestinationPublic);
    expect(container.textContent).not.toContain(f.recordingDestinationReserved);
    expect(container.textContent).not.toContain(g.rec.reserved);
    expect(container.textContent).not.toContain(f.consentsHostsAlways);
    continua();
    expect(onContinue).toHaveBeenCalledWith(expect.objectContaining({ registra: 'no' }));
  });
});

describe('la domanda sulla registrazione', () => {
  it('ha tre risposte, in una griglia a tre colonne', () => {
    render();
    const risposte = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
      .filter((i) => i.name.endsWith('-registra'))
      .map((i) => i.value);
    expect(risposte).toEqual(['riservata', 'pubblica', 'no']);
    const griglia = container.querySelector<HTMLInputElement>('input[value="riservata"]')!.closest('.formato__scelte');
    expect(griglia?.classList.contains('formato__scelte--tre')).toBe(true);
    expect(container.textContent).toContain(g.recQ);
    expect(container.textContent).toContain(g.rec.reservedDesc);
    expect(container.textContent).toContain(g.rec.publicDesc);
  });

  it('la proposta segue le altre risposte finche nessuno la tocca', () => {
    render();
    expect(registraScelta()).toBe('pubblica');
    scegli(g.people.piccolo);
    expect(registraScelta()).toBe('riservata');
    expect(anteprima()).toContain(f.recordingDestinationReserved);
    scegli(g.people.medio);
    expect(registraScelta()).toBe('pubblica');
    scegli(g.access.invitation);
    expect(registraScelta()).toBe('riservata');
    scegli(g.access.open);
    scegli(g.voice.speakers);
    scegli(g.people.piccolo);
    expect(registraScelta()).toBe('pubblica');
  });

  it('una risposta scelta non cambia piu da sola', () => {
    const onContinue = render();
    scegli(g.rec.public);
    scegli(g.people.piccolo);
    scegli(g.access.invitation);
    expect(registraScelta()).toBe('pubblica');
    continua();
    expect(onContinue).toHaveBeenCalledWith(
      expect.objectContaining({ persone: 'piccolo', registra: 'pubblica', accesso: 'invitati' }),
    );
  });

  it('anche il «no» resta, e la proposta non riaccende la registrazione', () => {
    render();
    scegli(g.rec.no);
    scegli(g.people.grande);
    expect(registraScelta()).toBe('no');
    expect(anteprima()).toContain(g.rec.noDesc);
  });

  it('confermare la proposta la ferma', () => {
    render();
    scegli(g.rec.public);
    scegli(g.voice.all);
    scegli(g.people.piccolo);
    expect(registraScelta()).toBe('pubblica');
  });

  it('sul sito solo su invito parte riservata', () => {
    render(vi.fn(), true, { accessoPredefinito: 'invitati' });
    expect(registraScelta()).toBe('riservata');
  });

  it('le risposte gia date restano: tornando dal wizard non si ricalcola nulla', () => {
    render(vi.fn(), true, {
      initial: { persone: 'medio', voce: 'tutti', registra: 'pubblica', accesso: 'tutti' },
    });
    scegli(g.people.piccolo);
    expect(registraScelta()).toBe('pubblica');
  });

  it('passando agli inviti un video pubblico solo ripreso torna alla proposta', () => {
    const onContinue = render(vi.fn(), true, {
      initial: { persone: 'medio', voce: 'tutti', registra: 'pubblica', accesso: 'tutti' },
    });
    scegli(g.access.invitation);
    expect(registraScelta()).toBe('riservata');
    continua();
    expect(onContinue).toHaveBeenCalledWith(
      expect.objectContaining({ registra: 'riservata', accesso: 'invitati' }),
    );
  });

  it('un video pubblico scelto in questa schermata resta anche su invito', () => {
    render(vi.fn(), true, {
      initial: { persone: 'piccolo', voce: 'tutti', registra: 'riservata', accesso: 'tutti' },
    });
    scegli(g.rec.public);
    scegli(g.access.invitation);
    expect(registraScelta()).toBe('pubblica');
  });

  it('il no ripreso resta no passando agli inviti', () => {
    render(vi.fn(), true, {
      initial: { persone: 'medio', voce: 'tutti', registra: 'no', accesso: 'tutti' },
    });
    scegli(g.access.invitation);
    expect(registraScelta()).toBe('no');
  });
});

describe('la griglia a tre colonne', () => {
  it('non scende sotto una larghezza che tiene icona e titolo', () => {
    const regola = /\.formato__scelte--tre \{([\s\S]*?)\n\}/.exec(
      readFileSync(resolve(__dirname, '../../styles/globals.scss'), 'utf8'),
    )?.[1];
    expect(regola).toMatch(/repeat\(auto-fit, minmax\(min\(100%, \d+rem\), 1fr\)\)/);
    expect(regola).not.toContain('repeat(3');
  });
});

describe('l anteprima dice solo cio che si sceglie qui', () => {
  it('una riunione: persone, chi parla, registrazione riservata, iscrizione', () => {
    render();
    scegli(g.people.piccolo);
    expect(anteprima()).toContain(f.recordingDestinationReserved);
    expect(anteprima()).toContain(f.consentsHostsAlways);
    expect(anteprima()).toContain(f.voiceAll);
    expect(anteprima()).toContain(f.accessOpen);
  });

  it('niente di cio che non si sceglie qui: funzioni, nomi, domande, rubrica', () => {
    render();
    scegli(g.voice.speakers);
    scegli(g.people.grande);
    const testo = anteprima();
    expect(testo).toContain(f.voiceSpeakers);
    expect(testo).toContain(f.recordingDestinationPublic);
    for (const assente of [
      f.postEventQaTextOnly,
      f.postEventQaHidden,
      f.addressBookNotOffered,
      messages.admin.wizard.step2.feature.chat.label,
    ]) {
      expect(testo).not.toContain(assente);
    }
    expect(anteprima()).toContain(f.liveToggleNote);
  });

  it('senza registrazione niente destinazione, ne chi conduce', () => {
    render();
    scegli(g.rec.no);
    expect(anteprima()).not.toContain(f.recordingDestinationPublic);
    expect(anteprima()).not.toContain(f.recordingDestinationReserved);
    expect(anteprima()).not.toContain(f.consentsHostsAlways);
    expect(anteprima()).not.toContain(f.recordingManual);
  });

  it('con la pipeline AI spenta non promette la trascrizione', () => {
    render(vi.fn(), true, { aiPipelineEnabled: false });
    expect(anteprima()).not.toContain(g.rec.yesDesc);
    expect(anteprima()).toContain(f.recordingDestinationPublic);
  });

  it('con la pipeline AI accesa la promette', () => {
    render();
    expect(anteprima()).toContain(g.rec.yesDesc);
  });

});
