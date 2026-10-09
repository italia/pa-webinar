import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JitsiMeetExternalAPI } from '@/types/jitsi';

import StageName from './stage-name';

/** Il nome di chi è sul palco, al posto dell'etichetta di Jitsi. */

type Listener = (...args: unknown[]) => void;

function fakeApi(names: Record<string, string>) {
  const listeners = new Map<string, Set<Listener>>();
  const api = {
    addListener: vi.fn((event: string, fn: Listener) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)?.add(fn);
    }),
    removeListener: vi.fn((event: string, fn: Listener) => listeners.get(event)?.delete(fn)),
    getDisplayName: vi.fn((id: string) => names[id]),
    stage: undefined as string | undefined,
    _getOnStageParticipant: vi.fn(() => api.stage),
  };
  const emit = (event: string, payload?: unknown) => {
    for (const fn of listeners.get(event) ?? []) fn(payload);
  };
  // Come l'IFrame API: l'id resta nell'API, l'evento arriva senza argomenti.
  const onStage = (id: string) => {
    api.stage = id;
    emit('largeVideoChanged');
  };
  return { api: api as unknown as JitsiMeetExternalAPI, raw: api, emit, onStage, listeners };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const nome = () => container.querySelector('.live-stage-name')?.textContent ?? null;

describe('StageName', () => {
  it('mostra il nome di chi è sul palco e lo segue quando cambia', () => {
    const names: Record<string, string> = { aa: 'Ospite di prova', bb: 'Relatore 1', me: 'Moderatore' };
    const { api, emit, onStage } = fakeApi(names);
    act(() => root.render(<StageName api={api} />));
    act(() => emit('videoConferenceJoined', { id: 'me' }));
    expect(nome()).toBeNull();
    act(() => onStage('aa'));
    expect(nome()).toBe('Ospite di prova');
    act(() => onStage('bb'));
    expect(nome()).toBe('Relatore 1');
    names.bb = 'Relatrice';
    act(() => emit('displayNameChange', { id: 'bb', displayname: 'Relatrice' }));
    expect(nome()).toBe('Relatrice');
  });

  it('non lo mostra per chi guarda, nella griglia, né dopo che è uscito', () => {
    const { api, emit, onStage } = fakeApi({ aa: 'Ospite di prova', me: 'Moderatore' });
    act(() => root.render(<StageName api={api} />));
    act(() => emit('videoConferenceJoined', { id: 'me' }));
    act(() => onStage('me'));
    expect(nome()).toBeNull();
    act(() => onStage('aa'));
    act(() => emit('tileViewChanged', { enabled: true }));
    expect(nome()).toBeNull();
    act(() => emit('tileViewChanged', { enabled: false }));
    expect(nome()).toBe('Ospite di prova');
    act(() => emit('participantLeft', { id: 'aa' }));
    expect(nome()).toBeNull();
  });

  it('toglie i propri ascoltatori', () => {
    const { api, listeners } = fakeApi({});
    act(() => root.render(<StageName api={api} />));
    act(() => root.render(<StageName api={null} />));
    expect([...listeners.values()].every((set) => set.size === 0)).toBe(true);
  });
});
