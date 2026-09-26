import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';
import type { JitsiMeetExternalAPI } from '@/types/jitsi';

import ParticipantPanel from './participant-panel';

/**
 * Il pannello «Partecipanti» di chi modera.
 *
 * Le righe di `getParticipantsInfo()` non portano il ruolo: il pulsante per
 * espellere lo decide il ruolo nel portale, mai sulla propria riga, e le
 * etichette compaiono solo quando i ruoli di Jitsi distinguono qualcuno.
 */
const tp = messages.live.participants;
const tr = messages.live.role;

let container: HTMLDivElement;
let root: Root;

function fakeApi(roomsInfo: unknown): JitsiMeetExternalAPI {
  return {
    getParticipantsInfo: () => [
      { participantId: 'io', displayName: 'Relatore 1', formattedDisplayName: 'Relatore 1' },
      { participantId: 'p2', displayName: 'Ospite', formattedDisplayName: 'Ospite' },
    ],
    getRoomsInfo: () => Promise.resolve(roomsInfo),
    getConnectionQuality: () => Promise.resolve({}),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  } as unknown as JitsiMeetExternalAPI;
}

async function render(api: JitsiMeetExternalAPI, isModerator = true) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <ParticipantPanel api={api} isModerator={isModerator} localParticipantId="io" />
      </NextIntlClientProvider>,
    );
  });
  // La richiesta dei ruoli è asincrona.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

const kickButtons = () =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('button')).filter(
    (b) => b.title === tp.kick,
  );

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

describe('ParticipantPanel — espellere', () => {
  it('chi modera nel portale può espellere gli altri, non se stesso', async () => {
    await render(fakeApi(undefined));
    const buttons = kickButtons();
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.getAttribute('aria-label')).toBe(
      tp.kickName.replace('{name}', 'Ospite'),
    );
  });

  it('anche se in Jitsi sono tutti moderatori (nessun ruolo dal token)', async () => {
    await render(
      fakeApi({
        rooms: [
          {
            isMainRoom: true,
            participants: [
              { id: 'io', role: 'moderator' },
              { id: 'p2', role: 'moderator' },
            ],
          },
        ],
      }),
    );
    expect(kickButtons()).toHaveLength(1);
  });

  it('chi non modera nel portale non vede il pulsante', async () => {
    await render(fakeApi(undefined), false);
    expect(kickButtons()).toHaveLength(0);
  });
});

describe('ParticipantPanel — etichette di ruolo', () => {
  it('senza ruoli noti nessuna etichetta', async () => {
    await render(fakeApi(undefined));
    expect(container.textContent).not.toContain(tr.participant);
    expect(container.textContent).not.toContain(tr.moderator);
  });

  it('tutti moderatori in Jitsi: nessuna etichetta', async () => {
    await render(
      fakeApi({
        rooms: [
          { isMainRoom: true, participants: [{ id: 'io', role: 'moderator' }, { id: 'p2', role: 'moderator' }] },
        ],
      }),
    );
    expect(container.textContent).not.toContain(tr.moderator);
  });

  it('ruoli che distinguono: etichette, e chi modera in cima', async () => {
    await render(
      fakeApi({
        rooms: [
          {
            isMainRoom: true,
            participants: [
              { id: 'io', role: 'participant' },
              { id: 'p2', role: 'moderator' },
            ],
          },
        ],
      }),
    );
    const testo = container.textContent ?? '';
    expect(testo).toContain(tr.moderator);
    expect(testo).toContain(tr.participant);
    expect(testo.indexOf('Ospite')).toBeLessThan(testo.indexOf('Relatore 1'));
  });
});
