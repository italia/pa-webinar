import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';
import { defaultMatrix } from '@/lib/utils/permission-matrix';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
  percorso: (p: string) => p,
}));

import StepPermissions, { type StepPermissionsValue } from './step-3-permissions';
import Step4Content, { type Step4Value } from './step-4-content';

/**
 * Due scelte del wizard dell'evento: i sottotitoli dell'evento, che si
 * offrono solo dove il servizio c'e', e i questionari con risposte, che il
 * wizard mostra senza poterli cambiare.
 */

let container: HTMLDivElement;
let root: Root;

function mount(node: ReactNode) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        {node}
      </NextIntlClientProvider>,
    );
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ rows: [] }))));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const permessi = (patch: Partial<StepPermissionsValue> = {}): StepPermissionsValue => ({
  permissionMatrix: defaultMatrix(),
  recordingEnabled: false,
  autoStartRecording: false,
  agendaEnabled: false,
  wordCloudEnabled: false,
  whiteboardEnabled: false,
  liveCaptionsEnabled: true,
  captionsTranscriptEnabled: false,
  aiTranscriptEnabled: false,
  aiSummaryEnabled: false,
  aiTranslationEnabled: false,
  aiDubbingEnabled: false,
  multitrackRecordingEnabled: false,
  retainParticipantTracks: false,
  aiTargetLocales: null,
  expectedSpeakers: null,
  ...patch,
});

describe('Impostazioni avanzate — sottotitoli', () => {
  const interruttore = () =>
    container.querySelector<HTMLInputElement>(
      `input[aria-label="${messages.admin.form.liveCaptionsEnabled}"]`,
    );

  it("con il servizio si spengono per l'evento", () => {
    const onChange = vi.fn();
    mount(
      <StepPermissions
        parte="partecipazione"
        value={permessi()}
        onChange={onChange}
        whiteboardInfraReady
        liveCaptionsAvailable
      />,
    );
    expect(interruttore()).toBeChecked();
    act(() => {
      interruttore()?.click();
    });
    expect(onChange).toHaveBeenCalledWith({ liveCaptionsEnabled: false });
  });

  it('senza il servizio non si propongono', () => {
    mount(
      <StepPermissions
        parte="partecipazione"
        value={permessi()}
        onChange={vi.fn()}
        whiteboardInfraReady
      />,
    );
    expect(interruttore()).toBeNull();
  });
});

describe('Contenuti — questionari con risposte', () => {
  const contenuti: Step4Value = {
    preEventQuestionnaire: { templateIds: [], adhocQuestions: [] },
    postEventQuestionnaire: { templateIds: ['tpl-1'], adhocQuestions: [] },
    materials: [],
  };
  const avviso = messages.admin.wizard.step4.lockedWithResponses.replace('{count}', '7');

  it('si leggono soltanto, con il numero di risposte e la strada per cambiarli', () => {
    mount(
      <Step4Content
        value={contenuti}
        onChange={vi.fn()}
        responseCounts={{ pre: 0, post: 7 }}
        eventId="evt-1"
      />,
    );
    expect(container.textContent).toContain(avviso);
    const link = container.querySelector<HTMLAnchorElement>('a[href="/admin/events/evt-1/questionnaires"]');
    expect(link?.textContent).toBe(messages.admin.wizard.step4.lockedGoToQuestionnaires);
    // Il questionario prima dell'iscrizione, senza risposte, resta modificabile.
    const aggiungi = Array.from(container.querySelectorAll('button')).filter(
      (b) => b.textContent === messages.admin.wizard.step4.addQuestion,
    );
    expect(aggiungi).toHaveLength(1);
  });

  it('senza risposte si modificano come prima', () => {
    mount(<Step4Content value={contenuti} onChange={vi.fn()} />);
    expect(container.textContent).not.toContain(avviso);
    const aggiungi = Array.from(container.querySelectorAll('button')).filter(
      (b) => b.textContent === messages.admin.wizard.step4.addQuestion,
    );
    expect(aggiungi).toHaveLength(2);
  });
});
