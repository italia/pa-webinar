// @vitest-environment jsdom
/**
 * La sala di chi modera manda a Jitsi la scelta dei sottotitoli all'ingresso, a
 * ogni cambio dell'interruttore o della lingua, e la rimanda a ogni cambio
 * della registrazione: avviarla o fermarla riscrive nei metadati della stanza
 * che la trascrizione è spenta.
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

function Sala(props: {
  api: JitsiMeetExternalAPI;
  accesi: boolean;
  registrazione: boolean;
  lingua: string;
}) {
  useCaptionsControl({
    api: props.api,
    attivo: true,
    accesi: props.accesi,
    lingua: props.lingua,
    registrazione: props.registrazione,
  });
  return null;
}

function disegna(
  api: JitsiMeetExternalAPI,
  accesi: boolean,
  {
    registrazione = false,
    lingua = 'it',
  }: { registrazione?: boolean; lingua?: string } = {}
) {
  act(() => root.render(createElement(Sala, { api, accesi, registrazione, lingua })));
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

  it('a sottotitoli accesi la rimanda quando la registrazione parte e quando si ferma', () => {
    const { api, emetti, sottotitoli } = finteApi();
    disegna(api, true);
    emetti('videoConferenceJoined');
    disegna(api, true, { registrazione: true });
    disegna(api, true, { registrazione: false });
    expect(sottotitoli()).toHaveLength(3);
    expect(sottotitoli().every((c) => c[1] === true)).toBe(true);
  });

  it('a sottotitoli spenti un cambio della registrazione non manda niente', () => {
    const { api, emetti, sottotitoli } = finteApi();
    disegna(api, false);
    emetti('videoConferenceJoined');
    const prima = sottotitoli().length;
    disegna(api, false, { registrazione: true });
    expect(sottotitoli()).toHaveLength(prima);
  });

  it('un evento di stato di Jitsi da solo non rimanda niente', () => {
    const { api, emetti, sottotitoli } = finteApi();
    disegna(api, true);
    emetti('videoConferenceJoined');
    // Lo manda anche la sola trascrizione: decide lo stato della registrazione.
    emetti('recordingStatusChanged', { on: false, mode: 'file', transcription: false });
    expect(sottotitoli()).toHaveLength(1);
  });

  it('un cambio della lingua manda di nuovo la scelta', () => {
    const { api, emetti, sottotitoli } = finteApi();
    disegna(api, true);
    emetti('videoConferenceJoined');
    disegna(api, true, { lingua: 'en' });
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
