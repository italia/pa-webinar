// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import type { ComponentProps } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import messages from '@/i18n/messages/it.json';

import ConsentDiagram from './consent-diagram';

/**
 * Il diagramma dice a chi organizza cosa succedera': deve uscire dalla stessa
 * regola della sala, per ogni installazione e con le scelte fatte.
 */
const testi = messages.admin.wizard.consentMap;

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

function apri(patch: Partial<ComponentProps<typeof ConsentDiagram>> = {}) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <ConsentDiagram
          multitrackRecordingEnabled={false}
          captionsTranscript={false}
          participantsCanUnmute
          participantsCanStartVideo
          participantsCanShareScreen={false}
          voce="rimovibile"
          {...patch}
        />
      </NextIntlClientProvider>
    );
  });
  const pulsante = container.querySelector('button');
  if (pulsante?.getAttribute('aria-expanded') === 'false') act(() => pulsante.click());
  return container.textContent ?? '';
}

describe('ConsentDiagram', () => {
  it('si apre a richiesta', () => {
    apri();
    const pulsante = container.querySelector('button');
    const figura = container.querySelector('figure')?.parentElement;
    expect(pulsante?.getAttribute('aria-expanded')).toBe('true');
    expect(figura?.hidden).toBe(false);
    act(() => pulsante?.click());
    expect(pulsante?.getAttribute('aria-expanded')).toBe('false');
    expect(figura?.hidden).toBe(true);
  });

  it("un consenso negato tocca solo chi lo nega: in sala resta tutto com'e'", () => {
    const testo = apri();
    expect(container.querySelectorAll('.mappa-consensi__ramo')).toHaveLength(2);
    expect(testo.match(new RegExp(testi.roomSame, 'g'))).toHaveLength(2);
    expect(testo).toContain(testi.notRecorded);
    expect(testo).toContain(testi.othersSame);
    expect(testo).toContain(testi.trace);
    expect(testo).not.toContain(testi.roomListenOnly);
  });

  it('chi conduce e\' sempre nel video, dove c\'e\' un video: non e\' una scelta', () => {
    expect(apri()).toContain(testi.hostsAlways);
    expect(apri({ voce: 'fissa' })).toContain(testi.hostsAlways);
  });

  it('dove la voce resta nel video, senza consenso solo ascolto, e lo dichiara', () => {
    const testo = apri({ voce: 'fissa' });
    expect(testo).toContain(testi.fixedVoice);
    expect(testo).toContain(testi.roomListenOnly);
    expect(testo).not.toContain(testi.othersSame);
  });

  it("dove la voce resta nel video e l'evento avvisa soltanto, nessuno sceglie", () => {
    const testo = apri({
      voce: 'fissa',
      participantsCanUnmute: false,
      participantsCanStartVideo: false,
    });
    expect(container.querySelectorAll('.mappa-consensi__ramo')).toHaveLength(0);
    expect(testo).toContain(testi.fixedNotice);
  });

  it('dove la voce resta nel video non promette che il nome resti fuori', () => {
    const testo = apri({ voce: 'fissa' });
    expect(testo).toContain(testi.fixedNotRecorded);
    expect(testo).not.toContain(testi.notRecorded);
  });

  it('senza un video completo decide il consenso alla trascrizione', () => {
    const testo = apri({ voce: 'assente', multitrackRecordingEnabled: true });
    expect(testo).toContain(testi.questionTranscription);
    expect(testo).toContain(testi.recordedVoice);
    expect(testo).toContain(testi.notRecordedVoice);
    expect(testo).not.toContain(testi.trace);
    // Senza video chi conduce segue il consenso alla trascrizione come tutti.
    expect(testo).not.toContain(testi.hostsAlways);
  });

  it("senza video e senza tracce non c'e' niente da mostrare", () => {
    act(() => {
      root.render(
        <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
          <ConsentDiagram
            multitrackRecordingEnabled={false}
            captionsTranscript={false}
            participantsCanUnmute
            participantsCanStartVideo
            participantsCanShareScreen={false}
            voce="assente"
          />
        </NextIntlClientProvider>
      );
    });
    expect(container.querySelector('.mappa-consensi')).toBeNull();
  });

  it("chi non puo' parlare riceve solo un avviso", () => {
    const testo = apri({
      participantsCanUnmute: false,
      participantsCanStartVideo: false,
    });
    expect(testo).toContain(testi.audienceNotice);
  });

  it("la trascrizione compare solo se l'evento la chiede", () => {
    expect(apri()).not.toContain(testi.transcription);
    expect(apri({ captionsTranscript: true })).toContain(testi.transcription);
  });

  it('la trascrizione del video chiede il suo consenso, senza tracce per persona', () => {
    expect(apri()).not.toContain(testi.transcription);
    expect(apri({ trascrizioneVideo: true })).toContain(testi.transcription);
  });
});
