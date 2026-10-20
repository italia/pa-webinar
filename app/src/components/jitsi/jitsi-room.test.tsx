import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

import JitsiRoom from './jitsi-room';

/**
 * Quello che la sala ascolta dalla videochiamata per il rientro dopo una
 * caduta: la conferenza persa e lo stato di microfono e videocamera.
 */

type Listener = (...args: unknown[]) => void;

interface FakeApi {
  listeners: Map<string, Set<Listener>>;
  emit: (event: string, payload?: unknown) => void;
  dispose: ReturnType<typeof vi.fn>;
}

let istanze: FakeApi[] = [];

class FakeExternalApi {
  listeners = new Map<string, Set<Listener>>();
  dispose = vi.fn();
  constructor() {
    istanze.push(this as unknown as FakeApi);
  }
  addListener(event: string, fn: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)?.add(fn);
  }
  removeListener(event: string, fn: Listener) {
    this.listeners.get(event)?.delete(fn);
  }
  emit(event: string, payload?: unknown) {
    for (const fn of this.listeners.get(event) ?? []) fn(payload);
  }
  executeCommand = vi.fn();
  isAudioMuted = vi.fn(async () => true);
  isVideoMuted = vi.fn(async () => true);
  getParticipantsInfo = vi.fn(() => []);
  getNumberOfParticipants = vi.fn(() => 1);
  getDisplayName = vi.fn(() => undefined);
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  istanze = [];
  (window as unknown as { JitsiMeetExternalAPI: unknown }).JitsiMeetExternalAPI =
    FakeExternalApi;
  // Schermo largo: la barra completa, come da computer.
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (window as unknown as { JitsiMeetExternalAPI?: unknown }).JitsiMeetExternalAPI;
  vi.unstubAllGlobals();
});

function monta(props: Partial<React.ComponentProps<typeof JitsiRoom>> = {}) {
  act(() =>
    root.render(
      <NextIntlClientProvider locale="it" messages={messages}>
        <JitsiRoom
          domain="conferenza.example.org"
          roomName="stanza"
          jwt="token"
          displayName="Ospite di prova"
          locale="it"
          role="participant"
          {...props}
        />
      </NextIntlClientProvider>
    )
  );
  const api = istanze.at(-1);
  if (!api) throw new Error('chiamata non creata');
  return api;
}

describe('JitsiRoom, conferenza persa', () => {
  it('un errore fatale della connessione, dopo essere entrati, lo riferisce alla sala', () => {
    const onConnectionLost = vi.fn();
    const api = monta({ onConnectionLost });
    act(() => api.emit('videoConferenceJoined', { id: 'abc' }));
    act(() =>
      api.emit('errorOccurred', {
        error: {
          name: 'connection.otherError',
          message: 'item-not-found',
          type: 'CONNECTION',
          isFatal: true,
        },
      })
    );
    expect(onConnectionLost).toHaveBeenCalledTimes(1);
  });

  it('un errore fatale all’ingresso (il bridge che si accende) resta a Jitsi', () => {
    const onConnectionLost = vi.fn();
    const api = monta({ onConnectionLost });
    act(() =>
      api.emit('errorOccurred', {
        error: {
          name: 'conference.videobridgeNotAvailable',
          type: 'CONFERENCE',
          isFatal: true,
        },
      })
    );
    expect(onConnectionLost).not.toHaveBeenCalled();
  });

  it('un errore che Jitsi supera da solo non tocca la chiamata', () => {
    const onConnectionLost = vi.fn();
    const api = monta({ onConnectionLost });
    act(() => api.emit('videoConferenceJoined', { id: 'abc' }));
    act(() =>
      api.emit('errorOccurred', {
        error: {
          name: 'connection.passwordRequired',
          type: 'CONNECTION',
          isFatal: false,
        },
      })
    );
    act(() => api.emit('errorOccurred', undefined));
    expect(onConnectionLost).not.toHaveBeenCalled();
  });

  it('dopo lo smontaggio la chiamata vecchia non riferisce più niente', () => {
    const onConnectionLost = vi.fn();
    const onMediaChanged = vi.fn();
    const api = monta({ onConnectionLost, onMediaChanged });
    act(() => root.render(<div />));
    expect(api.dispose).toHaveBeenCalled();
    api.emit('errorOccurred', { error: { type: 'CONNECTION', isFatal: true } });
    api.emit('audioMuteStatusChanged', { muted: true });
    expect(onConnectionLost).not.toHaveBeenCalled();
    expect(onMediaChanged).not.toHaveBeenCalled();
  });
});

describe('JitsiRoom, microfono e videocamera', () => {
  it('riferisce ogni cambio, per rientrare come si era', () => {
    const onMediaChanged = vi.fn();
    const api = monta({ onMediaChanged });
    act(() => api.emit('audioMuteStatusChanged', { muted: false }));
    act(() => api.emit('videoMuteStatusChanged', { muted: false }));
    act(() => api.emit('videoMuteStatusChanged', { muted: true }));
    act(() => api.emit('audioMuteStatusChanged', {}));
    expect(onMediaChanged.mock.calls).toEqual([
      ['audio', false],
      ['video', false],
      ['video', true],
    ]);
  });

  it('non quelli di una conferenza già persa: smontandosi, Jitsi spegne tutto', () => {
    const onMediaChanged = vi.fn();
    const api = monta({ onMediaChanged });
    act(() => api.emit('videoConferenceJoined', { id: 'abc' }));
    act(() => api.emit('audioMuteStatusChanged', { muted: false }));
    act(() =>
      api.emit('errorOccurred', { error: { type: 'CONNECTION', isFatal: true } })
    );
    act(() => api.emit('audioMuteStatusChanged', { muted: true }));
    act(() => api.emit('videoConferenceLeft', { roomName: 'stanza' }));
    act(() => api.emit('videoMuteStatusChanged', { muted: true }));
    expect(onMediaChanged.mock.calls).toEqual([['audio', false]]);
    // Di nuovo dentro (Jitsi che ricarica da sé): si torna a riferire.
    act(() => api.emit('videoConferenceJoined', { id: 'def' }));
    act(() => api.emit('videoMuteStatusChanged', { muted: false }));
    expect(onMediaChanged.mock.calls).toEqual([
      ['audio', false],
      ['video', false],
    ]);
  });
});

describe('JitsiRoom, caricamento', () => {
  it('di norma mostra «Connessione in corso»', () => {
    monta();
    expect(container.textContent).toContain(messages.live.connecting);
  });

  it('durante un rientro lo stato lo dice la sala: niente spinner qui', () => {
    monta({ inRientro: true });
    expect(container.textContent).not.toContain(messages.live.connecting);
  });
});
