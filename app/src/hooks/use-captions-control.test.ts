// @vitest-environment jsdom
/**
 * La sala di chi modera manda a Jitsi la scelta dei sottotitoli all'ingresso e
 * a ogni cambio dell'interruttore o della lingua. Chi avvia o ferma la
 * registrazione la rimanda subito con la funzione restituita: il comando
 * riscrive nei metadati della stanza che la trascrizione è spenta.
 */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JitsiMeetExternalAPI } from '@/types/jitsi';

import { useCaptionsControl } from './use-captions-control';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function finteApi() {
  const ascoltatori: Record<string, Array<(e?: unknown) => void>> = {};
  const executeCommand = vi.fn();
  const api = {
    executeCommand,
    addListener: (nome: string, f: (e?: unknown) => void) => {
      (ascoltatori[nome] ??= []).push(f);
    },
    removeListener: (nome: string, f: (e?: unknown) => void) => {
      ascoltatori[nome] = (ascoltatori[nome] ?? []).filter((x) => x !== f);
    },
  } as unknown as JitsiMeetExternalAPI;
  const emetti = (nome: string, e?: unknown) =>
    act(() => (ascoltatori[nome] ?? []).forEach((f) => f(e)));
  const sottotitoli = () =>
    executeCommand.mock.calls.filter((c) => c[0] === 'setSubtitles');
  return { api, emetti, sottotitoli };
}

let container: HTMLDivElement;
let root: Root;

let riafferma: () => void = () => {};

function Sala(props: { api: JitsiMeetExternalAPI; accesi: boolean; lingua: string }) {
  riafferma = useCaptionsControl({
    api: props.api,
    attivo: true,
    accesi: props.accesi,
    lingua: props.lingua,
  });
  return null;
}

function disegna(api: JitsiMeetExternalAPI, accesi: boolean, lingua = 'it') {
  act(() => root.render(createElement(Sala, { api, accesi, lingua })));
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('useCaptionsControl', () => {
  it("manda la scelta all'ingresso nella conferenza, non prima", () => {
    const { api, emetti, sottotitoli } = finteApi();
    disegna(api, true);
    expect(sottotitoli()).toHaveLength(0);
    emetti('videoConferenceJoined');
    expect(sottotitoli()).toEqual([['setSubtitles', true, false, 'it']]);
  });

  it('dopo un comando di registrazione la rimanda, a sottotitoli accesi', () => {
    const { api, emetti, sottotitoli } = finteApi();
    disegna(api, true);
    emetti('videoConferenceJoined');
    act(() => riafferma());
    expect(sottotitoli()).toEqual([
      ['setSubtitles', true, false, 'it'],
      ['setSubtitles', true, false, 'it'],
    ]);
  });

  it('a sottotitoli spenti, o prima di entrare, non rimanda niente', () => {
    const { api, emetti, sottotitoli } = finteApi();
    disegna(api, true);
    act(() => riafferma());
    expect(sottotitoli()).toHaveLength(0);
    disegna(api, false);
    emetti('videoConferenceJoined');
    const prima = sottotitoli().length;
    act(() => riafferma());
    expect(sottotitoli()).toHaveLength(prima);
  });

  it('un evento di stato della registrazione da solo non manda niente', () => {
    const { api, emetti, sottotitoli } = finteApi();
    disegna(api, true);
    emetti('videoConferenceJoined');
    emetti('recordingStatusChanged', { on: true, mode: 'file', transcription: false });
    expect(sottotitoli()).toHaveLength(1);
  });

  it('un cambio della lingua manda di nuovo la scelta', () => {
    const { api, emetti, sottotitoli } = finteApi();
    disegna(api, true);
    emetti('videoConferenceJoined');
    disegna(api, true, 'en');
    expect(sottotitoli().map((c) => c[3])).toEqual(['it', 'en']);
  });

  it("un cambio dell'interruttore manda la nuova scelta una volta", () => {
    const { api, emetti, sottotitoli } = finteApi();
    disegna(api, true);
    emetti('videoConferenceJoined');
    disegna(api, false);
    disegna(api, false);
    expect(sottotitoli().map((c) => c[1])).toEqual([true, false]);
  });
});
