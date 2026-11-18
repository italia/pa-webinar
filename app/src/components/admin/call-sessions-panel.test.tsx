// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirm: () => vi.fn() }));
vi.mock('./video-player', () => ({ default: () => null }));

import CallSessionsPanel from './call-sessions-panel';

let container: HTMLDivElement;
let root: Root;

const sessione = (peakParticipants: number) => ({
  id: `s-${peakParticipants}`,
  startedAt: '2026-11-05T10:00:00.000Z',
  endedAt: '2026-11-05T11:00:00.000Z',
  peakParticipants,
  participants: [],
  recordingUrl: null,
});

async function disegna(sessions: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ sessions }), { status: 200 }))
  );
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <CallSessionsPanel eventId="e1" eventSlug="evento" moderatorToken="tok" />
      </NextIntlClientProvider>
    );
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('le persone di una sessione', () => {
  it('al singolare con una, al plurale con di piu', async () => {
    await disegna([sessione(1), sessione(4)]);
    expect(container.textContent).toContain('1 partecipante');
    expect(container.textContent).not.toContain('1 partecipanti');
    expect(container.textContent).toContain('4 partecipanti');
  });
});
