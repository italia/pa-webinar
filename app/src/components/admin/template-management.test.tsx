// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

import TemplateManagement from './template-management';

/**
 * L'interruttore della lavagna nel modulo dei modelli: la sala mostra la
 * lavagna solo se l'installazione ne ha il servizio, quindi il modello non
 * deve prometterla quando manca.
 */

vi.mock('@/components/ui/confirm-dialog', () => ({
  useConfirm: () => async () => true,
}));

const t = messages.admin.templates;

let container: HTMLDivElement;
let root: Root;

function render(whiteboardInfraReady: boolean, liveCaptionsAvailable = true) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <TemplateManagement
          templates={[]}
          whiteboardInfraReady={whiteboardInfraReady}
          liveCaptionsAvailable={liveCaptionsAvailable}
        />
      </NextIntlClientProvider>,
    );
  });
  const nuovo = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === t.create,
  );
  if (!nuovo) throw new Error('pulsante «Nuovo template» non trovato');
  act(() => {
    nuovo.click();
  });
}

function interruttoreLavagna(): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>(
    `input[aria-label="${t.whiteboardLabel}"]`,
  );
  if (!el) throw new Error('interruttore della lavagna non trovato');
  return el;
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
});

describe('TemplateManagement — lavagna', () => {
  it('senza il servizio lavagna non si accende e dice perche', () => {
    render(false);
    expect(interruttoreLavagna()).toBeDisabled();
    expect(container.textContent).toContain(messages.admin.form.whiteboardUnavailable);
  });

  it('con il servizio lavagna si accende come prima', () => {
    render(true);
    expect(interruttoreLavagna()).toBeEnabled();
    expect(container.textContent).not.toContain(messages.admin.form.whiteboardUnavailable);
    act(() => {
      interruttoreLavagna().click();
    });
    expect(interruttoreLavagna()).toBeChecked();
  });
});

describe('TemplateManagement — sottotitoli', () => {
  const interruttore = () =>
    container.querySelector<HTMLInputElement>(
      `input[aria-label="${messages.admin.form.liveCaptionsEnabled}"]`,
    );

  it('un modello nuovo li ha accesi, come un evento', () => {
    render(true);
    expect(interruttore()).toBeChecked();
    act(() => {
      interruttore()?.click();
    });
    expect(interruttore()).not.toBeChecked();
  });

  it('senza il servizio non li propone', () => {
    render(true, false);
    expect(interruttore()).toBeNull();
  });
});

describe('TemplateManagement — i valori del formato', () => {
  const salvato = {
    id: 'tpl-1',
    name: 'Webinar',
    description: null,
    icon: 'it-video',
    qaEnabled: false,
    chatEnabled: true,
    agendaEnabled: false,
    wordCloudEnabled: false,
    whiteboardEnabled: false,
    liveCaptionsEnabled: true,
    postEventPublic: true,
    postEventShowQA: false,
    offerAddressBook: false,
    audienceAnonymous: true,
    nicknamesEnabled: true,
    hostsAlwaysRecorded: true,
    recordingDestination: 'PUBLIC' as const,
    waitingRoomEngine: null,
    recordingEnabled: true,
    participantsCanUnmute: false,
    participantsCanStartVideo: false,
    participantsCanShareScreen: false,
    maxParticipants: 300,
    defaultDurationMinutes: 60,
    aiTranscriptEnabled: false,
    aiSummaryEnabled: false,
    aiTranslationEnabled: false,
    aiDubbingEnabled: false,
    multitrackRecordingEnabled: false,
    retainParticipantTracks: false,
    descriptionTemplate: null,
    defaultRetentionDays: null,
    recordingDeleteAfterDays: 90 as number | null,
    defaultExpectedSpeakers: null,
    isSystem: true,
    sortOrder: 1,
    createdAt: '2030-01-01T00:00:00.000Z',
    updatedAt: '2030-01-01T00:00:00.000Z',
  };
  const w = messages.admin.wizard.step2;
  const interruttori = {
    postEventShowQA: messages.postEvent.showQA,
    offerAddressBook: t.offerAddressBook,
    audienceAnonymous: w.audienceAnonymous,
  };
  const interruttore = (nome: string) =>
    container.querySelector<HTMLInputElement>(`input[aria-label="${nome}"]`)!;
  const destinazione = () =>
    container.querySelector<HTMLSelectElement>('#tpl-recording-destination')!;
  const durata = () =>
    container.querySelector<HTMLSelectElement>('#tpl-recording-retention')!;
  const fetchMock = vi.fn();

  function apri() {
    act(() => {
      root.render(
        <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
          <TemplateManagement
            templates={[salvato]}
            whiteboardInfraReady
            liveCaptionsAvailable
          />
        </NextIntlClientProvider>,
      );
    });
    const modifica = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === messages.common.edit,
    );
    act(() => modifica?.click());
  }

  async function salva() {
    const pulsante = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === messages.common.save,
    );
    await act(async () => {
      pulsante?.click();
    });
    return JSON.parse(String(fetchMock.mock.calls[0]![1].body)) as Record<string, unknown>;
  }

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(salvato), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('un modello nuovo parte dai valori delle colonne', () => {
    render(true);
    expect(interruttore(interruttori.postEventShowQA)).toBeChecked();
    expect(interruttore(interruttori.offerAddressBook)).toBeChecked();
    expect(interruttore(interruttori.audienceAnonymous)).not.toBeChecked();
    // Chi conduce e' sempre nel video: non e' una scelta del modello.
    expect(interruttore(w.hostsAlwaysRecorded)).toBeNull();
    expect(destinazione().value).toBe('');
    expect(destinazione().textContent).toContain(t.recordingDestinationNone);
  });

  it('un modello salvato mostra i suoi valori', () => {
    apri();
    expect(interruttore(interruttori.postEventShowQA)).not.toBeChecked();
    expect(interruttore(interruttori.offerAddressBook)).not.toBeChecked();
    expect(interruttore(interruttori.audienceAnonymous)).toBeChecked();
    expect(interruttore(w.hostsAlwaysRecorded)).toBeNull();
    expect(destinazione().value).toBe('PUBLIC');
  });

  it('i valori non toccati ripartono com erano', async () => {
    apri();
    expect(await salva()).toMatchObject({
      id: 'tpl-1',
      postEventShowQA: false,
      offerAddressBook: false,
      audienceAnonymous: true,
      hostsAlwaysRecorded: true,
      recordingDestination: 'PUBLIC',
    });
  });

  it('i valori cambiati partono nel salvataggio', async () => {
    apri();
    for (const nome of Object.values(interruttori)) {
      act(() => interruttore(nome).click());
    }
    act(() => {
      destinazione().value = 'REGISTRANTS';
      destinazione().dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(await salva()).toMatchObject({
      postEventShowQA: true,
      offerAddressBook: true,
      audienceAnonymous: false,
      recordingDestination: 'REGISTRANTS',
    });
  });

  it('la durata della registrazione: nessuna in un modello nuovo, la sua in uno salvato', async () => {
    render(true);
    expect(durata().value).toBe('-1');
    expect(durata().textContent).toContain(messages.recording.retention.forever);
    act(() => root.unmount());
    root = createRoot(container);
    apri();
    expect(durata().value).toBe('90');
    act(() => {
      durata().value = '-1';
      durata().dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect((await salva()).recordingDeleteAfterDays).toBeNull();
  });

  it('la destinazione si puo lasciare a chi crea l evento', async () => {
    apri();
    act(() => {
      destinazione().value = '';
      destinazione().dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect((await salva()).recordingDestination).toBeNull();
  });
});
