// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

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

import { SezioneDati } from './advanced-settings';
import StepPermissions, { type StepPermissionsValue } from './step-3-permissions';
import Step4Content, { type Step4Value } from './step-4-content';
import Step5Review from './step-5-review';
import type { WizardForm } from './wizard-shell';

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
  recordingDestination: null,
  hostsAlwaysRecorded: false,
  audienceAnonymous: false,
  participantListVisible: false,
  nicknamesEnabled: false,
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

const modulo = (patch: Partial<WizardForm> = {}) =>
  ({
    ...permessi(),
    title: { it: 'Evento di prova' },
    description: { it: 'Una descrizione.' },
    startsAt: '2030-01-10T10:00',
    endsAt: '2030-01-10T12:00',
    timezone: 'Europe/Rome',
    maxParticipants: 100,
    moderators: [],
    speakers: [],
    organizers: [],
    invitations: [],
    gdprTemplateId: null,
    privacyPolicyText: '',
    privacyPolicyUrl: null,
    dataRetentionDays: 30,
    postEventPublic: true,
    postEventShowQA: true,
    offerAddressBook: true,
    requireOrganization: false,
    requireOrganizationRole: false,
    requireOrganizationType: false,
    ...patch,
  }) as WizardForm;

describe('Dati e pagina dopo l evento — le domande', () => {
  const tp = messages.postEvent;
  const interruttore = () =>
    Array.from(container.querySelectorAll('label'))
      .find((l) => l.textContent === tp.showQA)
      ?.querySelector('input');
  const mostra = (
    form: WizardForm,
    onChange = vi.fn(),
    domandeDopoEvento?: boolean,
    destinazioneSenzaScelta?: 'PUBLIC' | 'REGISTRANTS' | null,
    pubblicoDopo?: 'PUBLIC' | 'REGISTRANTS',
  ) =>
    mount(
      <SezioneDati
        form={form}
        onChange={onChange}
        gdprTemplates={[]}
        domandeDopoEvento={domandeDopoEvento}
        destinazioneSenzaScelta={destinazioneSenzaScelta}
        pubblicoDopo={pubblicoDopo}
      />,
    );

  it('si cambiano qui', () => {
    const onChange = vi.fn();
    mostra(modulo({ recordingDestination: 'PUBLIC' }), onChange);
    expect(interruttore()).toBeChecked();
    act(() => interruttore()?.click());
    expect(onChange).toHaveBeenCalledWith({ postEventShowQA: false });
  });

  it('con la registrazione riservata non si pubblicano, e lo dice', () => {
    mostra(modulo({ recordingEnabled: true, recordingDestination: 'REGISTRANTS' }));
    expect(interruttore()).toBeDisabled();
    expect(interruttore()).not.toBeChecked();
    expect(container.textContent).toContain(tp.qaReservedNote);
  });

  it('con il video reso riservato dal pubblico vale lo stesso', () => {
    mostra(
      modulo({ recordingEnabled: true, recordingDestination: 'PUBLIC' }),
      vi.fn(),
      undefined,
      undefined,
      'REGISTRANTS',
    );
    expect(interruttore()).toBeDisabled();
    expect(container.textContent).toContain(tp.qaReservedNote);
  });

  it('una riservata rimasta nel modulo a registrazione spenta non le toglie', () => {
    const onChange = vi.fn();
    mostra(modulo({ recordingEnabled: false, recordingDestination: 'REGISTRANTS' }), onChange);
    expect(interruttore()).toBeEnabled();
    expect(interruttore()).toBeChecked();
    expect(container.textContent).not.toContain(tp.qaReservedNote);
    act(() => interruttore()?.click());
    expect(onChange).toHaveBeenCalledWith({ postEventShowQA: false });
  });

  it('su un evento gia riservato la regola vale anche a registrazione spenta', () => {
    mostra(
      modulo({ recordingEnabled: false, recordingDestination: 'REGISTRANTS' }),
      vi.fn(),
      undefined,
      'REGISTRANTS',
    );
    expect(interruttore()).toBeDisabled();
    expect(container.textContent).toContain(tp.qaReservedNote);
  });

  it('con un link di conduzione non si propongono', () => {
    mostra(modulo(), vi.fn(), false);
    expect(interruttore()).toBeUndefined();
  });
});

describe('Riepilogo — cio che il formato ha scelto', () => {
  const f = messages.admin.wizard.flow;
  const tp = messages.admin.wizard.step2;
  const conQa = {
    ...defaultMatrix(),
    qa: ['GUEST', 'SPEAKER', 'MODERATOR'],
  } as StepPermissionsValue['permissionMatrix'];
  const mostra = (
    patch: Partial<WizardForm>,
    props: Partial<React.ComponentProps<typeof Step5Review>> = {},
  ) => {
    mount(
      <Step5Review
        form={modulo(patch)}
        onChange={vi.fn()}
        defaultLocale="it"
        gdprTemplates={[]}
        iscrizioneAperta
        {...props}
      />,
    );
    return container.textContent ?? '';
  };

  it('dove va la registrazione', () => {
    expect(mostra({ recordingEnabled: true, recordingDestination: 'PUBLIC' })).toContain(
      f.recordingDestinationPublic,
    );
    expect(mostra({ recordingEnabled: true, recordingDestination: 'REGISTRANTS' })).toContain(
      f.recordingDestinationReserved,
    );
    expect(mostra({ recordingEnabled: true }, { onCambiaDestinazione: vi.fn() })).toContain(
      tp.recordingDestinationNotSet,
    );
  });

  it('con un link di conduzione dice che la sceglie lo staff', () => {
    const testo = mostra({ recordingEnabled: true });
    expect(testo).toContain(tp.recordingDestinationStaffOnly);
    expect(testo).not.toContain(tp.recordingDestinationNotSet);
  });

  it('dove il video della sala non c e dice quella che l evento avra, senza farla cambiare', () => {
    const testo = mostra(
      {
        recordingEnabled: true,
        recordingDestination: null,
        aiTranscriptEnabled: true,
        multitrackRecordingEnabled: true,
      },
      {
        voceNelVideo: 'assente',
        destinazioneSenzaScelta: 'REGISTRANTS',
        onCambiaDestinazione: vi.fn(),
      },
    );
    expect(testo).toContain(f.recordingDestinationReserved);
    expect(testo).not.toContain(f.change);
    expect(testo).not.toContain(tp.recordingDestinationNotSet);
  });

  it('dove il video della sala non c e, su un evento vecchio senza, non ne parla', () => {
    const testo = mostra(
      { recordingEnabled: true, aiTranscriptEnabled: true, multitrackRecordingEnabled: true },
      { voceNelVideo: 'assente' },
    );
    expect(testo).not.toContain(tp.recordingDestinationStaffOnly);
    expect(testo).not.toContain(f.recordingDestinationReserved);
  });

  it('senza registrazione, o dove manca e va scelta, non ne parla', () => {
    expect(mostra({ recordingEnabled: false, recordingDestination: 'PUBLIC' })).not.toContain(
      f.recordingDestinationPublic,
    );
    const daScegliere = mostra({ recordingEnabled: true }, { chiedeDestinazione: true });
    expect(daScegliere).not.toContain(tp.recordingDestinationNotSet);
    expect(daScegliere).not.toContain(tp.recordingDestinationStaffOnly);
    expect(
      mostra({ recordingEnabled: true, recordingDestination: 'PUBLIC' }, { istantanea: true }),
    ).not.toContain(f.recordingDestinationPublic);
  });

  it('«Cambia» porta alla sezione della registrazione', () => {
    const onCambiaDestinazione = vi.fn();
    mostra({ recordingEnabled: true, recordingDestination: 'PUBLIC' }, { onCambiaDestinazione });
    const riga = Array.from(container.querySelectorAll('span.d-block')).find((s) =>
      s.textContent?.includes(f.recordingDestinationPublic),
    );
    act(() => riga?.querySelector('button')?.click());
    expect(onCambiaDestinazione).toHaveBeenCalledTimes(1);
  });

  it('i nomi del pubblico', () => {
    expect(mostra({ audienceAnonymous: true })).toContain(f.audiencePseudonyms);
    expect(mostra({ audienceAnonymous: false })).toContain(f.audienceRealNames);
    expect(mostra({ audienceAnonymous: true }, { istantanea: true })).not.toContain(
      f.audiencePseudonyms,
    );
  });

  it('con la pagina dopo l evento privata le domande non si pubblicano', () => {
    const privata = mostra({
      permissionMatrix: conQa,
      postEventShowQA: true,
      postEventPublic: false,
      recordingEnabled: false,
      recordingDestination: null,
    });
    expect(privata).toContain(f.postEventQaHidden);
    expect(privata).not.toContain(f.postEventQaTextOnly);
  });

  it('un evento su invito con il video pubblico lo dice accanto alla destinazione', () => {
    expect(
      mostra(
        { recordingEnabled: true, recordingDestination: 'PUBLIC' },
        { notaDestinazione: 'recordingDestinationPublicOnInvitation' },
      ),
    ).toContain(tp.recordingDestinationPublicOnInvitation);
  });

  it('le domande dopo l evento seguono la regola della pagina', () => {
    expect(
      mostra({ permissionMatrix: conQa, postEventShowQA: true, recordingDestination: 'PUBLIC' }),
    ).toContain(f.postEventQaTextOnly);
    expect(
      mostra({ permissionMatrix: conQa, postEventShowQA: false, recordingDestination: 'PUBLIC' }),
    ).toContain(f.postEventQaHidden);
    expect(
      mostra({
        permissionMatrix: conQa,
        postEventShowQA: true,
        recordingEnabled: true,
        recordingDestination: 'REGISTRANTS',
      }),
    ).toContain(f.postEventQaHidden);
    // Rimasta nel modulo a registrazione spenta: l'evento non la dichiara.
    expect(
      mostra({
        permissionMatrix: conQa,
        postEventShowQA: true,
        recordingEnabled: false,
        recordingDestination: 'REGISTRANTS',
      }),
    ).toContain(f.postEventQaTextOnly);
    expect(
      mostra(
        {
          permissionMatrix: conQa,
          postEventShowQA: true,
          recordingEnabled: false,
          recordingDestination: 'REGISTRANTS',
        },
        { destinazioneSenzaScelta: 'REGISTRANTS' },
      ),
    ).toContain(f.postEventQaHidden);
    expect(
      mostra(
        { permissionMatrix: conQa, postEventShowQA: true, recordingDestination: 'PUBLIC' },
        { pubblicoDopo: 'REGISTRANTS' },
      ),
    ).toContain(f.postEventQaHidden);
    const senzaDomande = mostra({ postEventShowQA: true });
    expect(senzaDomande).not.toContain(f.postEventQaTextOnly);
    expect(senzaDomande).not.toContain(f.postEventQaHidden);
  });

  it('la rubrica', () => {
    const proposta = mostra({ offerAddressBook: true });
    expect(proposta).toContain(f.askAddressBook);
    expect(proposta).not.toContain(f.addressBookNotOffered);
    expect(mostra({ offerAddressBook: false })).toContain(f.addressBookNotOffered);
  });

  it('con la rubrica spenta sull installazione non ne parla', () => {
    const testo = mostra({ offerAddressBook: true }, { addressBookEnabled: false });
    expect(testo).not.toContain(f.askAddressBook);
    expect(mostra({ offerAddressBook: false }, { addressBookEnabled: false })).not.toContain(
      f.addressBookNotOffered,
    );
  });

  it('il video trascritto senza tracce chiede conferma, e il consenso alla trascrizione', () => {
    const testo = mostra({
      recordingEnabled: true,
      recordingDestination: 'PUBLIC',
      aiTranscriptEnabled: true,
      multitrackRecordingEnabled: false,
    });
    expect(testo).toContain(f.aiConfirmVideo);
    expect(testo).toContain(f.consentTranscription);
  });

  it('con le tracce per persona la conferma non serve', () => {
    expect(
      mostra({
        recordingEnabled: true,
        aiTranscriptEnabled: true,
        multitrackRecordingEnabled: true,
      }),
    ).not.toContain(f.aiConfirmVideo);
  });

  it('con la pipeline spenta il video non si trascrive', () => {
    const testo = mostra(
      { recordingEnabled: true, aiTranscriptEnabled: true, multitrackRecordingEnabled: false },
      { aiPipelineEnabled: false },
    );
    expect(testo).not.toContain(f.aiConfirmVideo);
    expect(testo).not.toContain(f.consentTranscription);
  });

  it('con gli pseudonimi la nota sulla camera non invita a mostrare l elenco', () => {
    const conCamera = {
      ...defaultMatrix(),
      video: ['GUEST', 'SPEAKER', 'MODERATOR'],
    } as StepPermissionsValue['permissionMatrix'];
    expect(mostra({ permissionMatrix: conCamera })).toContain(tp.participantListCameraNote);
    expect(mostra({ permissionMatrix: conCamera, audienceAnonymous: true })).not.toContain(
      tp.participantListCameraNote,
    );
  });
});
