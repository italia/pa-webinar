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
  it('senza ruoli noti nessuna sezione', async () => {
    await render(fakeApi(undefined));
    expect(container.textContent).not.toContain(tp.hosts);
    expect(container.textContent).not.toContain(tp.audience);
  });

  it('tutti moderatori in Jitsi: nessuna etichetta', async () => {
    await render(
      fakeApi({
        rooms: [
          { isMainRoom: true, participants: [{ id: 'io', role: 'moderator' }, { id: 'p2', role: 'moderator' }] },
        ],
      }),
    );
    expect(container.textContent).not.toContain(tp.hosts);
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
    // Le sezioni dicono chi conduce e chi ascolta, e chi conduce sta in cima.
    const testo = container.textContent ?? '';
    expect(testo).toContain(tp.hosts);
    expect(testo).toContain(tp.audience);
    expect(testo.indexOf(tp.hosts)).toBeLessThan(testo.indexOf(tp.audience));
    expect(testo.indexOf('Ospite')).toBeLessThan(testo.indexOf('Relatore 1'));
  });
});

describe('ParticipantPanel — espellere con conferma', () => {
  it('il primo clic chiede conferma, il secondo espelle', async () => {
    const api = fakeApi(undefined);
    const executeCommand = vi.fn();
    (api as unknown as { executeCommand: typeof executeCommand }).executeCommand = executeCommand;
    await render(api);
    await act(async () => kickButtons()[0]!.click());
    expect(executeCommand).not.toHaveBeenCalled();
    await act(async () => kickButtons()[0]!.click());
    expect(executeCommand).toHaveBeenCalledWith('kickParticipant', 'p2');
  });
});

describe('ParticipantPanel — mani alzate e chi parla', () => {
  /** Un'API finta che ricorda gli ascoltatori, per far arrivare gli eventi. */
  function apiConEventi() {
    const ascolto = new Map<string, Array<(e: unknown) => void>>();
    const api = fakeApi(undefined) as unknown as Record<string, unknown>;
    api.addListener = (nome: string, fn: (e: unknown) => void) =>
      ascolto.set(nome, [...(ascolto.get(nome) ?? []), fn]);
    const emetti = (nome: string, e: unknown) => ascolto.get(nome)?.forEach((fn) => fn(e));
    return { api: api as unknown as JitsiMeetExternalAPI, emetti };
  }

  it('chi alza la mano va in cima, con il suo turno; chi parla si vede', async () => {
    const { api, emetti } = apiConEventi();
    await render(api);
    await act(async () => emetti('raiseHandUpdated', { id: 'io', handRaised: 1000 }));
    await act(async () => emetti('dominantSpeakerChanged', { id: 'p2' }));
    const righe = Array.from(container.querySelectorAll('.people-row'));
    expect(righe[0]?.textContent).toContain('Relatore 1');
    expect(righe[0]?.textContent).toContain(tp.raisedHand.replace('{position}', '1'));
    expect(container.querySelector('.people-row.is-speaking')?.textContent).toContain('Ospite');

    await act(async () => emetti('raiseHandUpdated', { id: 'io', handRaised: 0 }));
    expect(container.textContent).not.toContain('✋');
  });

  it('la propria riga dice «tu» e non offre il volume', async () => {
    await render(fakeApi(undefined));
    const mia = Array.from(container.querySelectorAll('.people-row')).find((r) =>
      r.textContent?.includes('Relatore 1'),
    );
    expect(mia?.textContent).toContain(tp.you);
    expect(mia?.querySelector(`button[title="${tp.volume}"]`)).toBeNull();
  });
});

describe('ParticipantPanel — chi c’e’ dietro i riquadri', () => {
  function apiCon(persone: Array<{ participantId: string; displayName: string }>) {
    return {
      getParticipantsInfo: () => persone.map((p) => ({ ...p, formattedDisplayName: p.displayName })),
      getNumberOfParticipants: () => persone.length,
      getRoomsInfo: () => Promise.resolve(undefined),
      getConnectionQuality: () => Promise.resolve({}),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    } as unknown as JitsiMeetExternalAPI;
  }

  async function renderCon(api: JitsiMeetExternalAPI, props: { isModerator: boolean; visible?: boolean }) {
    const onCount = vi.fn();
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
          <ParticipantPanel
            api={api}
            isModerator={props.isModerator}
            localParticipantId="io"
            visible={props.visible ?? true}
            eventSlug="evento"
            token="tok-mod"
            onCountChange={onCount}
          />
        </NextIntlClientProvider>,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    return onCount;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('chi modera vede l’email dell’iscrizione, il nome diverso e il link inoltrato', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          seats: {
            p2: { kind: 'registration', name: 'Laura Verdi', email: 'laura@ente.it' },
            p3: { kind: 'registration', name: 'Mario Rossi', email: 'mario@ente.it' },
            p4: { kind: 'forwardedLink', name: 'Anna Neri', email: 'anna@ente.it' },
          },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    await renderCon(
      apiCon([
        { participantId: 'io', displayName: 'Moderatore' },
        { participantId: 'p2', displayName: 'Laura Verdi' },
        { participantId: 'p3', displayName: 'Pippo' },
        { participantId: 'p4', displayName: 'Collega' },
      ]),
      { isModerator: true },
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/events/evento/seats', {
      headers: { Authorization: 'Bearer tok-mod' },
    });
    const testo = container.textContent ?? '';
    expect(testo).toContain('laura@ente.it');
    // Stesso nome: nessun avviso.
    expect(testo).not.toContain(tp.registeredAs.replace('{name}', 'Laura Verdi'));
    expect(testo).toContain(tp.registeredAs.replace('{name}', 'Mario Rossi'));
    expect(testo).toContain(tp.forwardedLink.replace('{email}', 'anna@ente.it'));
  });

  it('chi non modera non chiede ne’ vede le email', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await renderCon(apiCon([{ participantId: 'p2', displayName: 'Laura Verdi' }]), { isModerator: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a scheda chiusa non disegna l’elenco ma tiene il conteggio', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const onCount = await renderCon(
      apiCon([
        { participantId: 'io', displayName: 'Moderatore' },
        { participantId: 'p2', displayName: 'Laura Verdi' },
      ]),
      { isModerator: true, visible: false },
    );
    expect(container.querySelector('.people')).toBeNull();
    expect(onCount).toHaveBeenLastCalledWith(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('la ricerca smette di filtrare quando il campo sparisce', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ seats: {} }))));
    const persone = Array.from({ length: 10 }, (_, i) => ({ participantId: `p${i}`, displayName: `Persona ${i}` }));
    let elenco = persone;
    const ascoltatori = new Map<string, (evt: unknown) => void>();
    const api = {
      ...apiCon(persone),
      getParticipantsInfo: () => elenco.map((p) => ({ ...p, formattedDisplayName: p.displayName })),
      getNumberOfParticipants: () => elenco.length,
      addListener: (nome: string, fn: (evt: unknown) => void) => ascoltatori.set(nome, fn),
    } as unknown as JitsiMeetExternalAPI;
    await renderCon(api, { isModerator: true });
    const campo = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(campo, 'Persona 1');
      campo.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.querySelectorAll('.people-row')).toHaveLength(1);

    // Escono in cinque: sotto la soglia il campo sparisce, e il filtro con lui.
    elenco = persone.slice(2, 7);
    await act(async () => {
      ascoltatori.get('participantJoined')?.({ id: 'x' });
      await new Promise((r) => setTimeout(r, 350));
    });
    expect(container.querySelector('input[type="search"]')).toBeNull();
    expect(container.querySelectorAll('.people-row')).toHaveLength(5);
  });
});
