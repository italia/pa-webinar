// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

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
  const assente = { voceNelVideo: 'assente' } as const;
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
    expect(anteprima()).toContain(f.postEventQaHidden);
    expect(anteprima()).not.toContain(f.recordingDestinationPublic);
  });

  it('una risposta pubblica rimasta nell indirizzo non si promette', () => {
    const onContinue = render(vi.fn(), true, {
      ...assente,
      initial: { persone: 'medio', voce: 'tutti', registra: 'pubblica', accesso: 'tutti' },
    });
    expect(registraScelta()).toBe('riservata');
    expect(anteprima()).toContain(f.postEventQaHidden);
    continua();
    expect(onContinue).toHaveBeenCalledWith(expect.objectContaining({ registra: 'riservata' }));
  });

  it('il no resta no, e le domande restano sulla pagina', () => {
    const onContinue = render(vi.fn(), true, assente);
    scegli(g.rec.no);
    expect(registraScelta()).toBe('no');
    expect(anteprima()).toContain(f.postEventQaTextOnly);
    continua();
    expect(onContinue).toHaveBeenCalledWith(expect.objectContaining({ registra: 'no' }));
  });

  it('con il video le tre risposte restano', () => {
    render(vi.fn(), true, { voceNelVideo: 'fissa' });
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
    expect(container.textContent).not.toContain(f.consentsHosts);
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
});

describe('l anteprima dice cosa viene dal formato', () => {
  it('una riunione: riservata, nomi reali, domande e rubrica fuori', () => {
    render();
    scegli(g.people.piccolo);
    expect(anteprima()).toContain(f.recordingDestinationReserved);
    expect(anteprima()).toContain(f.consentsHosts);
    expect(anteprima()).toContain(g.previewRealNames);
    expect(anteprima()).toContain(f.postEventQaHidden);
    expect(anteprima()).toContain(f.addressBookNotOffered);
  });

  it('un evento partecipativo: pubblica, nomi reali, testo delle domande, rubrica', () => {
    render();
    expect(anteprima()).toContain(f.recordingDestinationPublic);
    expect(anteprima()).toContain(g.previewRealNames);
    expect(anteprima()).toContain(f.postEventQaTextOnly);
    expect(anteprima()).toContain(f.addressBookOffered);
  });

  it('un webinar: pseudonimi', () => {
    render();
    scegli(g.voice.speakers);
    scegli(g.people.grande);
    expect(anteprima()).toContain(f.recordingDestinationPublic);
    expect(anteprima()).toContain(g.previewPseudonyms);
    expect(anteprima()).not.toContain(g.previewRealNames);
    expect(anteprima()).toContain(f.postEventQaTextOnly);
    expect(anteprima()).toContain(f.addressBookOffered);
  });

  it('con il video riservato le domande non restano, anche dove la famiglia le terrebbe', () => {
    render();
    scegli(g.rec.reserved);
    expect(anteprima()).toContain(f.postEventQaHidden);
    expect(anteprima()).not.toContain(f.postEventQaTextOnly);
  });

  it('senza registrazione su invito la pagina resta privata: le domande non si pubblicano', () => {
    render(vi.fn(), true, {
      initial: { persone: 'medio', voce: 'tutti', registra: 'no', accesso: 'invitati' },
    });
    expect(anteprima()).toContain(f.postEventQaHidden);
    expect(anteprima()).not.toContain(f.postEventQaTextOnly);
  });

  it('senza registrazione su un evento aperto la pagina resta, e con lei le domande', () => {
    render(vi.fn(), true, {
      initial: { persone: 'medio', voce: 'tutti', registra: 'no', accesso: 'tutti' },
    });
    expect(anteprima()).toContain(f.postEventQaTextOnly);
  });

  it('senza registrazione niente destinazione, ne chi conduce', () => {
    render();
    scegli(g.rec.no);
    expect(anteprima()).not.toContain(f.recordingDestinationPublic);
    expect(anteprima()).not.toContain(f.recordingDestinationReserved);
    expect(anteprima()).not.toContain(f.consentsHosts);
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

  it('con la rubrica spenta nell installazione non la promette', () => {
    render(vi.fn(), true, { addressBookAvailable: false });
    expect(anteprima()).toContain(f.addressBookNotOffered);
    expect(anteprima()).not.toContain(f.addressBookOffered);
  });
});
