import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';
import { useCaptionsControl } from '@/hooks/use-captions-control';
import type { JitsiMeetExternalAPI, JitsiTranscriptionChunk } from '@/types/jitsi';

import LiveCaptions from './live-captions';

/**
 * I sottotitoli live in sala: le frasi arrivano dall'IFrame API con l'endpoint
 * di chi parla, la sala ci mette il nome, chi guarda può nasconderli; chi
 * modera li accende e spegne nella stanza con `setSubtitles`.
 */

type Listener = (...args: unknown[]) => void;

function fakeApi(names: Record<string, string> = {}) {
  const listeners = new Map<string, Set<Listener>>();
  const api = {
    addListener: vi.fn((event: string, fn: Listener) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)?.add(fn);
    }),
    removeListener: vi.fn((event: string, fn: Listener) => listeners.get(event)?.delete(fn)),
    getDisplayName: vi.fn((id: string) => names[id]),
    executeCommand: vi.fn(),
  };
  const emit = (event: string, payload?: unknown) => {
    for (const fn of listeners.get(event) ?? []) fn(payload);
  };
  return { api: api as unknown as JitsiMeetExternalAPI, raw: api, emit };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  window.localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ state: 'operational' }))));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function render(node: React.ReactNode) {
  act(() => {
    root.render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <NextIntlClientProvider locale="it" messages={messages}>
          {node}
        </NextIntlClientProvider>
      </SWRConfig>,
    );
  });
}

// Come lo consegna l'IFrame API: il frammento dentro `data`.
const chunk = (c: JitsiTranscriptionChunk) => ({ data: c });

describe('LiveCaptions', () => {
  it('mostra la frase di chi parla con il suo nome, aggiornandola', () => {
    const { api, emit } = fakeApi({ ab12: 'Relatore 1' });
    render(<LiveCaptions api={api} active />);
    act(() => emit('transcriptionChunkReceived', chunk({ messageID: 'm1', participant: { id: 'ab12' }, stable: 'Buongiorno' })));
    act(() => emit('transcriptionChunkReceived', chunk({ messageID: 'm1', participant: { id: 'ab12' }, stable: 'Buongiorno a tutti' })));
    const box = container.querySelector('.live-captions__box');
    expect(box?.textContent).toBe('Relatore 1 Buongiorno a tutti');
    expect(box?.getAttribute('aria-hidden')).toBe('true');
  });

  it('non ripete il nome sulle righe consecutive della stessa persona', () => {
    const { api, emit } = fakeApi({ ab12: 'Relatore 1' });
    render(<LiveCaptions api={api} active />);
    act(() => emit('transcriptionChunkReceived', chunk({ messageID: 'm1', participant: { id: 'ab12' }, final: 'Prima parte.' })));
    act(() => emit('transcriptionChunkReceived', chunk({ messageID: 'm2', participant: { id: 'ab12' }, stable: 'Seconda' })));
    expect(container.querySelectorAll('.live-captions__speaker')).toHaveLength(1);
    expect(container.querySelector('.live-captions__box')?.textContent).toBe('Relatore 1 Prima parte.Seconda');
  });

  it('annuncia ai lettori di schermo solo le frasi concluse', () => {
    const { api, emit } = fakeApi({ ab12: 'Relatore 1' });
    render(<LiveCaptions api={api} active />);
    const live = () => container.querySelector('[aria-live="polite"]')?.textContent;
    act(() => emit('transcriptionChunkReceived', chunk({ messageID: 'm1', participant: { id: 'ab12' }, stable: 'Buongiorno' })));
    expect(live()).toBe('');
    act(() => emit('transcriptionChunkReceived', chunk({ messageID: 'm1', participant: { id: 'ab12' }, final: 'Buongiorno a tutti.' })));
    expect(live()).toBe('Relatore 1: Buongiorno a tutti.');
  });

  it('chi guarda li nasconde per sé dal pulsante nella barra di Jitsi, e la scelta resta nel browser', () => {
    const { api, raw, emit } = fakeApi();
    render(<LiveCaptions api={api} active />);
    act(() => emit('transcriptionChunkReceived', chunk({ messageID: 'm1', stable: 'Testo' })));
    const pulsante = () =>
      (raw.executeCommand.mock.calls.filter((c) => c[0] === 'overwriteConfig').at(-1)?.[1] as {
        customToolbarButtons: Array<{ id: string; text: string; icon: string }>;
      }).customToolbarButtons;
    expect(pulsante()).toEqual([expect.objectContaining({ id: 'pa-captions', text: 'Nascondi i sottotitoli' })]);

    // Il clic su un altro pulsante personalizzato non li tocca.
    act(() => emit('toolbarButtonClicked', { key: 'altro' }));
    expect(container.querySelector('.live-captions__box')).not.toBeNull();

    act(() => emit('toolbarButtonClicked', { key: 'pa-captions' }));
    expect(container.querySelector('.live-captions__box')).toBeNull();
    expect(window.localStorage.getItem('pawebinar.captions.visible')).toBe('0');
    expect(pulsante()).toEqual([expect.objectContaining({ id: 'pa-captions', text: 'Mostra i sottotitoli' })]);
    // Senza nome noto, un'etichetta generica.
    act(() => emit('toolbarButtonClicked', { key: 'pa-captions' }));
    expect(container.querySelector('.live-captions__speaker')?.textContent).toBe('Partecipante');
  });

  it('spenti per l’evento, il pulsante esce dalla barra', () => {
    const { api, raw } = fakeApi();
    render(<LiveCaptions api={api} active={false} />);
    expect(raw.executeCommand).toHaveBeenCalledWith('overwriteConfig', { customToolbarButtons: [] });
  });

  it('accetta anche il frammento senza involucro', () => {
    const { api, emit } = fakeApi({ ab12: 'Relatore 1' });
    render(<LiveCaptions api={api} active />);
    act(() => emit('transcriptionChunkReceived', { messageID: 'm1', participant: { id: 'ab12' }, final: 'Ciao.' }));
    expect(container.querySelector('.live-captions__box')?.textContent).toBe('Relatore 1 Ciao.');
  });

  it('spenti, non ascolta l’API e non disegna nulla', () => {
    const { api, raw } = fakeApi();
    render(<LiveCaptions api={api} active={false} />);
    expect(raw.addListener).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe('');
  });
});

function Moderatore(props: { api: JitsiMeetExternalAPI | null; attivo: boolean; accesi: boolean }) {
  useCaptionsControl({ ...props, lingua: 'it' });
  return null;
}

describe('useCaptionsControl', () => {
  it("accende la trascrizione solo dopo l'ingresso nella conferenza, e la spegne con l'interruttore", () => {
    const { api, raw, emit } = fakeApi();
    render(<Moderatore api={api} attivo accesi />);
    expect(raw.executeCommand).not.toHaveBeenCalled();
    act(() => emit('videoConferenceJoined', { roomName: 'r', id: 'x', displayName: 'M' }));
    expect(raw.executeCommand).toHaveBeenCalledWith('setSubtitles', true, false, 'it');
    render(<Moderatore api={api} attivo accesi={false} />);
    expect(raw.executeCommand).toHaveBeenLastCalledWith('setSubtitles', false, false, 'it');
    expect(raw.executeCommand).toHaveBeenCalledTimes(2);
  });

  it('chi non modera, o senza servizio, non manda nulla', () => {
    const { api, raw, emit } = fakeApi();
    render(<Moderatore api={api} attivo={false} accesi />);
    act(() => emit('videoConferenceJoined', { roomName: 'r', id: 'x', displayName: 'P' }));
    expect(raw.executeCommand).not.toHaveBeenCalled();
  });

  it("entrato con i sottotitoli spenti non manda uno spegnimento inutile, e li riaccende a un nuovo ingresso", () => {
    const { api, raw, emit } = fakeApi();
    render(<Moderatore api={api} attivo accesi={false} />);
    act(() => emit('videoConferenceJoined', {}));
    expect(raw.executeCommand).not.toHaveBeenCalled();
    render(<Moderatore api={api} attivo accesi />);
    expect(raw.executeCommand).toHaveBeenCalledTimes(1);
    act(() => emit('videoConferenceJoined', {}));
    expect(raw.executeCommand).toHaveBeenCalledTimes(2);
  });
});
