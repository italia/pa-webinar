// @vitest-environment jsdom
/**
 * La sala di chi modera manda a Jitsi la scelta dei sottotitoli all'ingresso e
 * a ogni cambio dell'interruttore, e la rimanda a ogni cambio della
 * registrazione: avviarla o fermarla riscrive nei metadati della stanza che la
 * trascrizione è spenta.
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

function Sala(props: { api: JitsiMeetExternalAPI; accesi: boolean }) {
  useCaptionsControl({
    api: props.api,
    attivo: true,
    accesi: props.accesi,
    lingua: 'it',
  });
  return null;
}

function disegna(api: JitsiMeetExternalAPI, accesi: boolean) {
  act(() => root.render(createElement(Sala, { api, accesi })));
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

  it('a sottotitoli accesi la rimanda a ogni cambio della registrazione', () => {
    const { api, emetti, sottotitoli } = finteApi();
    disegna(api, true);
    emetti('videoConferenceJoined');
    emetti('recordingStatusChanged', { on: true, mode: 'file' });
    emetti('recordingStatusChanged', { on: false, mode: 'file' });
    expect(sottotitoli()).toHaveLength(3);
    expect(sottotitoli().every((c) => c[1] === true)).toBe(true);
  });

  it('a sottotitoli spenti un cambio della registrazione non manda niente', () => {
    const { api, emetti, sottotitoli } = finteApi();
    disegna(api, false);
    emetti('videoConferenceJoined');
    const prima = sottotitoli().length;
    emetti('recordingStatusChanged', { on: true, mode: 'file' });
    expect(sottotitoli()).toHaveLength(prima);
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
