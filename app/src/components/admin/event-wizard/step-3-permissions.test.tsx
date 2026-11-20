// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import en from '@/i18n/messages/en.json';
import messages from '@/i18n/messages/it.json';
import type { PartecipantiNelVideo } from '@/lib/live/consent-rule';

import StepPermissions, { type StepPermissionsValue } from './step-3-permissions';

/**
 * La parte «registrazione» delle impostazioni avanzate, su un'installazione
 * che non puo' registrare: non propone niente, ma un evento che ha gia' la
 * registrazione accesa la mostra, per poterla spegnere.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  percorso: (p: string) => p,
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/',
}));

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

function render(
  recordingEnabled: boolean,
  recordingAvailable: boolean,
  partecipantiNelVideo?: PartecipantiNelVideo,
  istantanea = false,
) {
  const value = {
    recordingEnabled,
    permissionMatrix: {},
  } as unknown as StepPermissionsValue;
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <StepPermissions
          parte="registrazione"
          value={value}
          onChange={vi.fn()}
          whiteboardInfraReady={false}
          recordingAvailable={recordingAvailable}
          partecipantiNelVideo={partecipantiNelVideo}
          istantanea={istantanea}
        />
      </NextIntlClientProvider>
    );
  });
}

describe('i consensi nelle impostazioni avanzate', () => {
  const avviso = () =>
    (container.textContent ?? '').includes(messages.admin.wizard.step2.hostsAlwaysRecordedDesc);
  const interruttore = () =>
    container.querySelector(`[aria-label="${messages.admin.wizard.step2.hostsAlwaysRecorded}"]`);
  const diagramma = () => container.querySelector('.mappa-consensi');

  it('chi conduce e\' sempre nel video: un avviso fisso, mai un interruttore', () => {
    const testi = messages.admin.wizard.step2;
    for (const [voce, testo] of [
      ['solo-voce', testi.hostsAlwaysRecordedDesc],
      ['esclusi', testi.hostsAlwaysRecordedDescHostsOnly],
      ['visibili', testi.hostsAlwaysRecordedDescVisible],
    ] as const) {
      render(true, true, voce);
      // Di chi partecipa dice cio' che l'installazione garantisce davvero.
      expect(container.textContent).toContain(testo);
      expect(interruttore()).toBeNull();
      expect(diagramma()).not.toBeNull();
    }
  });

  it('senza un video della sala chi conduce segue le tracce: niente avviso', () => {
    render(true, true, 'assente');
    expect(avviso()).toBe(false);
  });

  it('una chiamata rapida chiede in sala: avviso dove si registra, niente diagramma', () => {
    render(true, true, 'solo-voce', true);
    expect(avviso()).toBe(true);
    expect(diagramma()).toBeNull();
    render(true, true, 'visibili', true);
    expect(avviso()).toBe(false);
  });

  it('senza registrazione non propone niente', () => {
    render(false, true, 'solo-voce');
    expect(avviso()).toBe(false);
    expect(interruttore()).toBeNull();
    expect(diagramma()).toBeNull();
  });
});

describe('registrazione nelle impostazioni avanzate', () => {
  const interruttore = () =>
    container.querySelector(`[aria-label="${messages.admin.form.recordingEnabled}"]`);

  it('dove si puo registrare propone l interruttore', () => {
    render(false, true);
    expect(interruttore()).not.toBeNull();
  });

  it('dove non si puo registrare dice perche e non propone niente', () => {
    render(false, false);
    expect(interruttore()).toBeNull();
    expect(container.textContent).toBe(messages.admin.recording.notConfigured);
  });

  it('un evento che ha gia la registrazione accesa la puo spegnere', () => {
    render(true, false);
    expect(interruttore()).not.toBeNull();
  });
});

describe('la destinazione della registrazione', () => {
  const s2 = messages.admin.wizard.step2;
  const onChange = vi.fn();
  const scelta = (valore: string) =>
    container.querySelector<HTMLInputElement>(`#wiz-destinazione-${valore}`);
  const interruttore = () =>
    container.querySelector<HTMLInputElement>(`[aria-label="${messages.admin.form.recordingEnabled}"]`)!;

  function mostra(
    value: Partial<StepPermissionsValue>,
    destinazione?: {
      iniziale: 'PUBLIC' | 'REGISTRANTS' | null;
      salaGiaAperta: boolean;
      chiesta: boolean;
      nota?: 'recordingDestinationPublicOnInvitation' | null;
    },
    extra: {
      editing?: boolean;
      soloAscoltoBloccato?: boolean;
      errore?: boolean;
      partecipantiNelVideo?: 'visibili' | 'solo-voce' | 'assente';
      puoDichiarareChiConduce?: boolean;
    } = {},
  ) {
    onChange.mockReset();
    act(() => {
      root.render(
        <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
          <StepPermissions
            parte="registrazione"
            value={{ permissionMatrix: {}, ...value } as unknown as StepPermissionsValue}
            onChange={onChange}
            whiteboardInfraReady={false}
            destinazione={destinazione}
            editing={extra.editing}
            soloAscoltoBloccato={extra.soloAscoltoBloccato}
            partecipantiNelVideo={extra.partecipantiNelVideo}
            puoDichiarareChiConduce={extra.puoDichiarareChiConduce}
            fieldErrors={extra.errore ? { recordingDestination: 'required' } : {}}
          />
        </NextIntlClientProvider>,
      );
    });
  }
  const libera = { iniziale: null, salaGiaAperta: false, chiesta: true };

  it('si propone sotto la registrazione, con il testo di ogni scelta', () => {
    mostra({ recordingEnabled: true, recordingDestination: 'REGISTRANTS' }, libera);
    expect(scelta('REGISTRANTS')).toBeChecked();
    expect(scelta('PUBLIC')).not.toBeChecked();
    expect(container.textContent).toContain(s2.recordingDestinationReservedDesc);
    expect(container.textContent).toContain(s2.recordingDestinationPublicDesc);
  });

  it('il testo di Riservata non nega un passaggio che si puo\' ancora fare', () => {
    mostra({ recordingEnabled: true, recordingDestination: 'REGISTRANTS' }, libera);
    expect(scelta('PUBLIC')).toBeEnabled();
    expect(s2.recordingDestinationReservedDesc).toContain(
      "Dopo l'apertura della sala non si può più rendere pubblica.",
    );
    expect(en.admin.wizard.step2.recordingDestinationReservedDesc).toContain(
      'Once the room has opened it can no longer be made public.',
    );
  });

  it('su un evento su invito dice cosa diventa la registrazione', () => {
    mostra(
      { recordingEnabled: true, recordingDestination: 'PUBLIC' },
      { ...libera, nota: 'recordingDestinationPublicOnInvitation' },
    );
    expect(container.textContent).toContain(s2.recordingDestinationPublicOnInvitation);
  });

  it('non si propone senza registrazione, ne dove la decide altri', () => {
    mostra({ recordingEnabled: false, recordingDestination: null }, libera);
    expect(scelta('REGISTRANTS')).toBeNull();
    mostra({ recordingEnabled: true, recordingDestination: 'PUBLIC' });
    expect(scelta('REGISTRANTS')).toBeNull();
  });

  it('non si propone dove un video non c e', () => {
    mostra({ recordingEnabled: true, recordingDestination: null }, libera, {
      partecipantiNelVideo: 'assente',
    });
    expect(scelta('REGISTRANTS')).toBeNull();
    expect(container.textContent).not.toContain(s2.recordingDestination);
  });

  it('dove un video non c e accendere la registrazione non parte da riservata', () => {
    mostra({ recordingEnabled: false, recordingDestination: null }, libera, {
      partecipantiNelVideo: 'assente',
    });
    act(() => interruttore().click());
    expect(onChange.mock.calls[0]![0]).not.toHaveProperty('recordingDestination');
  });

  it('con un link di conduzione dice che manca e che la sceglie lo staff', () => {
    const conLink = { puoDichiarareChiConduce: false };
    mostra({ recordingEnabled: true, recordingDestination: null }, undefined, conLink);
    expect(scelta('REGISTRANTS')).toBeNull();
    expect(container.textContent).toContain(s2.recordingDestinationStaffOnly);
    expect(container.textContent).not.toContain(s2.recordingDestinationNotSet);

    mostra({ recordingEnabled: true, recordingDestination: 'PUBLIC' }, undefined, conLink);
    expect(container.textContent).not.toContain(s2.recordingDestinationStaffOnly);
    mostra({ recordingEnabled: false, recordingDestination: null }, undefined, conLink);
    expect(container.textContent).not.toContain(s2.recordingDestinationStaffOnly);
    mostra({ recordingEnabled: true, recordingDestination: null }, undefined, {
      ...conLink,
      partecipantiNelVideo: 'assente',
    });
    expect(container.textContent).not.toContain(s2.recordingDestinationStaffOnly);
  });

  it('lo staff non legge quella nota', () => {
    mostra({ recordingEnabled: true, recordingDestination: null }, libera);
    expect(container.textContent).not.toContain(s2.recordingDestinationStaffOnly);
  });

  it('la scelta passa al modulo', () => {
    mostra({ recordingEnabled: true, recordingDestination: 'REGISTRANTS' }, libera);
    act(() => scelta('PUBLIC')!.click());
    expect(onChange).toHaveBeenCalledWith({ recordingDestination: 'PUBLIC' });
  });

  it('in creazione chi accende la registrazione parte da riservata', () => {
    mostra({ recordingEnabled: false, recordingDestination: null }, libera);
    act(() => interruttore().click());
    expect(onChange.mock.calls[0]![0]).toMatchObject({ recordingDestination: 'REGISTRANTS' });
  });

  it('in creazione una destinazione del modello non si tocca', () => {
    mostra({ recordingEnabled: false, recordingDestination: 'PUBLIC' }, libera);
    act(() => interruttore().click());
    expect(onChange.mock.calls[0]![0]).not.toHaveProperty('recordingDestination');
  });

  it('in modifica accendere la registrazione non sceglie al posto di chi organizza', () => {
    mostra({ recordingEnabled: false, recordingDestination: null }, libera, { editing: true });
    act(() => interruttore().click());
    expect(onChange.mock.calls[0]![0]).not.toHaveProperty('recordingDestination');
  });

  it('spegnere la registrazione non tocca la destinazione', () => {
    mostra({ recordingEnabled: true, recordingDestination: 'PUBLIC' }, libera);
    act(() => interruttore().click());
    expect(onChange.mock.calls[0]![0]).not.toHaveProperty('recordingDestination');
  });

  it('su un evento che non la chiede dice che non e indicata', () => {
    mostra(
      { recordingEnabled: true, recordingDestination: null },
      { iniziale: null, salaGiaAperta: false, chiesta: false },
    );
    expect(container.textContent).toContain(s2.recordingDestinationNotSet);
    expect(scelta('PUBLIC')).toBeEnabled();
  });

  it('dopo l apertura della sala si puo solo restringere, anche senza destinazione', () => {
    mostra(
      { recordingEnabled: true, recordingDestination: null },
      { iniziale: null, salaGiaAperta: true, chiesta: false },
    );
    expect(scelta('PUBLIC')).toBeDisabled();
    expect(scelta('REGISTRANTS')).toBeEnabled();
    expect(container.textContent).toContain(s2.recordingDestinationLocked);
  });

  it('a sala aperta non si cambia', () => {
    mostra(
      { recordingEnabled: true, recordingDestination: 'PUBLIC' },
      { iniziale: 'PUBLIC', salaGiaAperta: true, chiesta: false },
      { soloAscoltoBloccato: true },
    );
    expect(scelta('PUBLIC')).toBeDisabled();
    expect(scelta('REGISTRANTS')).toBeDisabled();
  });

  it('l errore segna il primo campo e dice cosa fare', () => {
    mostra({ recordingEnabled: true, recordingDestination: null }, libera, { errore: true });
    expect(scelta('REGISTRANTS')).toHaveClass('is-invalid');
    expect(scelta('PUBLIC')).not.toHaveClass('is-invalid');
    expect(scelta('REGISTRANTS')?.getAttribute('aria-describedby')).toContain(
      'wiz-destinazione-errore',
    );
    expect(container.querySelector('#wiz-destinazione-errore')?.textContent).toBe(
      s2.recordingDestinationRequired,
    );
  });
});

describe('la trascrizione del video nel diagramma', () => {
  function apri(aiPipelineEnabled: boolean) {
    act(() => {
      root.render(
        <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
          <StepPermissions
            parte="registrazione"
            value={
              {
                recordingEnabled: true,
                aiTranscriptEnabled: true,
                multitrackRecordingEnabled: false,
                permissionMatrix: { mic: ['GUEST', 'SPEAKER', 'MODERATOR'] },
              } as unknown as StepPermissionsValue
            }
            onChange={vi.fn()}
            whiteboardInfraReady={false}
            aiPipelineEnabled={aiPipelineEnabled}
          />
        </NextIntlClientProvider>,
      );
    });
    return container.querySelector('.mappa-consensi')?.textContent ?? '';
  }

  it('con la pipeline accesa il consenso alla trascrizione si chiede anche senza tracce', () => {
    expect(apri(true)).toContain(messages.admin.wizard.consentMap.transcription);
  });

  it('con la pipeline spenta no', () => {
    expect(apri(false)).not.toContain(messages.admin.wizard.consentMap.transcription);
  });
});

describe('la nota sulla camera, con l elenco nascosto', () => {
  const nota = messages.admin.wizard.step2.participantListCameraNote;
  function mostra(audienceAnonymous: boolean) {
    act(() => {
      root.render(
        <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
          <StepPermissions
            parte="partecipazione"
            value={
              {
                audienceAnonymous,
                participantListVisible: false,
                permissionMatrix: { video: ['GUEST', 'SPEAKER', 'MODERATOR'] },
              } as unknown as StepPermissionsValue
            }
            onChange={vi.fn()}
            whiteboardInfraReady={false}
          />
        </NextIntlClientProvider>,
      );
    });
    return container.textContent ?? '';
  }

  it('invita a mostrare l elenco', () => {
    expect(mostra(false)).toContain(nota);
  });

  it('con gli pseudonimi l elenco non si puo mostrare: niente nota', () => {
    expect(mostra(true)).not.toContain(nota);
  });
});

describe('come compare chi partecipa: una scelta a tre', () => {
  const s2 = messages.admin.wizard.step2;
  function mostra(
    valori: { audienceAnonymous: boolean; participantListVisible: boolean },
    soloAscoltoBloccato = false,
  ) {
    const onChange = vi.fn();
    act(() => {
      root.render(
        <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
          <StepPermissions
            parte="partecipazione"
            value={{ ...valori, permissionMatrix: {} } as unknown as StepPermissionsValue}
            onChange={onChange}
            whiteboardInfraReady={false}
            soloAscoltoBloccato={soloAscoltoBloccato}
          />
        </NextIntlClientProvider>,
      );
    });
    const opzione = (k: 'tutti' | 'conduce' | 'anonimo') =>
      container.querySelector<HTMLInputElement>(`#wiz-pubblico-${k}`)!;
    return { onChange, opzione };
  }

  it('una sola opzione scelta, quella dei valori del modulo', () => {
    const { opzione } = mostra({ audienceAnonymous: false, participantListVisible: false });
    expect(container.querySelector('legend')?.textContent).toBe(s2.audienceHeading);
    expect(opzione('tutti').checked).toBe(false);
    expect(opzione('conduce').checked).toBe(true);
    expect(opzione('anonimo').checked).toBe(false);
  });

  it('con gli pseudonimi e scelto l anonimo, qualunque sia l elenco', () => {
    const { opzione } = mostra({ audienceAnonymous: true, participantListVisible: true });
    expect(opzione('anonimo').checked).toBe(true);
    expect(opzione('tutti').checked).toBe(false);
  });

  it('ogni scelta manda i valori che la fanno', () => {
    const { onChange, opzione } = mostra({ audienceAnonymous: true, participantListVisible: false });
    act(() => opzione('tutti').click());
    expect(onChange).toHaveBeenLastCalledWith({ audienceAnonymous: false, participantListVisible: true });
    act(() => opzione('conduce').click());
    expect(onChange).toHaveBeenLastCalledWith({ audienceAnonymous: false, participantListVisible: false });
  });

  it('a sala aperta non si cambia, e lo dice', () => {
    const { opzione } = mostra({ audienceAnonymous: false, participantListVisible: true }, true);
    expect(opzione('tutti').disabled).toBe(true);
    expect(opzione('anonimo').disabled).toBe(true);
    expect(container.textContent).toContain(s2.audienceLocked);
  });
});
