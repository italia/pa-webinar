// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { act, type ComponentProps, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RenderedQuestionnaire } from '@/components/questionnaires/questionnaire-form';
import messages from '@/i18n/messages/it.json';
import type { SchedaPrivacy } from '@/lib/events/privacy-sheet';

/**
 * Il questionario dell'iscrizione sta nel modulo e le risposte partono con
 * l'iscrizione. La pagina lo legge dal database e lo passa al modulo: il
 * browser non lo chiede al server.
 */
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
  percorso: (p: string) => p,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import RegistrationFormClient from './registration-form-client';

const SLUG = 'evento-di-prova';
const DOMANDA = '22222222-2222-4222-8222-222222222222';
const fetchMock = vi.fn();
/** La risposta all'iscrizione. */
let rispostaIscrizione: () => Response = () =>
  new Response(JSON.stringify({ accessToken: 'TOKEN_ISCRITTO' }), { status: 201 });

let container: HTMLDivElement;
let root: Root;

const questionario = (required: boolean): RenderedQuestionnaire => ({
  id: 'q1',
  placement: 'PRE_REGISTRATION',
  title: { it: 'Due domande' },
  description: { it: '' },
  required,
  items: [
    {
      id: DOMANDA,
      prompt: { it: 'Da quale ufficio?' },
      type: 'OPEN_TEXT',
      options: null,
      scaleMin: null,
      scaleMax: null,
      required: true,
    },
  ],
});

function disegna(preRegistrationQuestionnaire: RenderedQuestionnaire | null) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <RegistrationFormClient
          eventSlug={SLUG}
          privacyPolicyUrl="/privacy"
          preRegistrationQuestionnaire={preRegistrationQuestionnaire}
          // Lontano dall'inizio: nessun rimando automatico alla sala.
          startsAt={new Date(Date.now() + 7 * 24 * 3600_000).toISOString()}
          waitingRoomLeadMinutes={15}
        />
      </NextIntlClientProvider>,
    );
  });
}

function scrivi(id: string, valore: string) {
  const el = container.querySelector<HTMLInputElement>(`#${id}`);
  if (!el) throw new Error(`campo ${id} non trovato`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(el, valore);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function iscriviti() {
  scrivi('displayName', 'Mario Rossi');
  scrivi('email', 'mario.rossi@example.org');
  const consenso = container.querySelector<HTMLInputElement>('#consentGiven');
  if (!consenso) throw new Error('consenso non trovato');
  act(() => consenso.click());
  const invio = container.querySelector<HTMLButtonElement>('form button[type="submit"]');
  if (!invio) throw new Error('pulsante di invio non trovato');
  await act(async () => {
    invio.click();
  });
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function richiesteQuestionario(): unknown[][] {
  return fetchMock.mock.calls.filter(([url]) =>
    String(url).includes('/questionnaires/PRE_REGISTRATION'),
  );
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  rispostaIscrizione = () =>
    new Response(JSON.stringify({ accessToken: 'TOKEN_ISCRITTO' }), { status: 201 });
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).endsWith(`/api/events/${SLUG}/registrations`)) {
      return rispostaIscrizione();
    }
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

/** Il corpo dell'iscrizione inviata, o null se il modulo non l'ha inviata. */
function iscrizioneInviata(): Record<string, unknown> | null {
  const chiamata = fetchMock.mock.calls.find(([url]) =>
    String(url).endsWith(`/api/events/${SLUG}/registrations`),
  );
  return chiamata ? (JSON.parse(String(chiamata[1]?.body)) as Record<string, unknown>) : null;
}

async function attendi() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function rispondi(testo: string) {
  const campo = container.querySelector<HTMLTextAreaElement>(`#q-${DOMANDA}`);
  if (!campo) throw new Error('domanda non trovata');
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(campo, testo);
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('RegistrationFormClient — consensi', () => {
  it('togliendo la registrazione, la trascrizione non ricompare gia\' spuntata', () => {
    act(() => {
      root.render(
        <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
          <RegistrationFormClient
            eventSlug={SLUG}
            privacyPolicyUrl="/privacy"
            preRegistrationQuestionnaire={null}
            startsAt={new Date(Date.now() + 7 * 24 * 3600_000).toISOString()}
            waitingRoomLeadMinutes={15}
            recordingEnabled
            multitrackRecordingEnabled
            participantsCanUnmute
            partecipanti="solo-voce"
          />
        </NextIntlClientProvider>,
      );
    });
    const casella = (id: string) => {
      const el = container.querySelector<HTMLInputElement>(`#${id}`);
      if (!el) throw new Error(`casella ${id} non trovata`);
      return el;
    };
    act(() => casella('consentRecording').click());
    act(() => casella('consentMultitrack').click());
    expect(casella('consentMultitrack').checked).toBe(true);

    act(() => casella('consentRecording').click());
    expect(casella('consentMultitrack').disabled).toBe(true);

    act(() => casella('consentRecording').click());
    expect(casella('consentMultitrack').checked).toBe(false);
  });
});

type Props = Partial<ComponentProps<typeof RegistrationFormClient>>;

function disegnaCon(props: Props) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <RegistrationFormClient
          eventSlug={SLUG}
          privacyPolicyUrl="/privacy"
          startsAt={new Date(Date.now() + 7 * 24 * 3600_000).toISOString()}
          waitingRoomLeadMinutes={15}
          {...props}
        />
      </NextIntlClientProvider>,
    );
  });
}

const testoDi = (selettore: string) => container.querySelector(selettore)?.textContent ?? '';
const SPUNTA_REGISTRAZIONE = { recordingEnabled: true, participantsCanUnmute: true };

function spunta(id: string) {
  const el = container.querySelector<HTMLInputElement>(`#${id}`);
  if (!el) throw new Error(`casella ${id} non trovata`);
  act(() => el.click());
}

describe('RegistrationFormClient — presa visione dell\'informativa', () => {
  it('l\'etichetta dice che si e\' letta l\'informativa, e resta obbligatoria', async () => {
    disegnaCon({});
    expect(testoDi('label[for="consentGiven"]')).toContain(messages.registration.gdprConsent);
    expect(testoDi('legend')).toBe(messages.registration.consentsLegend);

    scrivi('displayName', 'Mario Rossi');
    scrivi('email', 'mario.rossi@example.org');
    const invio = container.querySelector<HTMLButtonElement>('form button[type="submit"]');
    await act(async () => invio?.click());
    await attendi();
    expect(iscrizioneInviata()).toBeNull();
    expect(testoDi('#consentGivenError')).toBe(messages.registration.errors.consentRequired);
  });
});

describe('RegistrationFormClient — il testo della casella segue la destinazione', () => {
  const consenso = messages.gdpr.consent;

  it.each([
    ['REGISTRANTS', 'solo-voce', consenso.recordingReserved, 'REGISTRANTS'],
    ['PUBLIC', 'solo-voce', consenso.recordingPublic, 'PUBLIC'],
    [null, 'solo-voce', consenso.recording, null],
    // Dove chi partecipa puo' comparire, il testo non promette che volto e nome restano fuori.
    ['REGISTRANTS', 'visibili', consenso.recordingVisibleReserved, 'REGISTRANTS'],
    ['PUBLIC', 'visibili', consenso.recordingVisiblePublic, 'PUBLIC'],
    [null, 'visibili', consenso.recordingVisible, null],
    ['REGISTRANTS', 'assente', consenso.recordingNoVideo, null],
    ['PUBLIC', 'assente', consenso.recordingNoVideo, null],
    [null, 'assente', consenso.recordingNoVideo, null],
  ] as const)(
    'destinazione %s, voce %s: mostra il testo e manda quello che dichiara',
    async (recordingDestination, voce, testo, inviata) => {
      disegnaCon({ ...SPUNTA_REGISTRAZIONE, recordingDestination, partecipanti: voce });
      expect(testoDi('label[for="consentRecording"]')).toContain(testo);
      spunta('consentRecording');
      await iscriviti();
      const corpo = iscrizioneInviata();
      expect(corpo?.consentRecording).toBe(true);
      expect(corpo).toHaveProperty('consentRecordingDestination', inviata);
    },
  );

  it("il testo scelto dall'ente sta accanto alla casella, dove un video c'e'", () => {
    disegnaCon({
      ...SPUNTA_REGISTRAZIONE,
      recordingConsentText: 'Testo scelto per evento',
      partecipanti: 'visibili',
    });
    expect(container.textContent).toContain('Testo scelto per evento');
    expect(
      container.querySelector('#consentRecording')?.getAttribute('aria-describedby')
    ).toContain('consentRecordingEvento');

    disegnaCon({
      ...SPUNTA_REGISTRAZIONE,
      recordingConsentText: 'Testo scelto per evento',
      partecipanti: 'assente',
    });
    expect(container.textContent).not.toContain('Testo scelto per evento');
  });

  it('manda il testo mostrato anche senza la spunta', async () => {
    disegnaCon({ ...SPUNTA_REGISTRAZIONE, recordingDestination: 'PUBLIC', partecipanti: 'visibili' });
    await iscriviti();
    expect(iscrizioneInviata()).toMatchObject({
      consentRecording: false,
      consentRecordingDestination: 'PUBLIC',
    });
  });

  it('il rifiuto del server per il testo cambiato si mostra sulla casella', async () => {
    rispostaIscrizione = () =>
      new Response(
        JSON.stringify({
          code: 'VALIDATION_ERROR',
          details: [
            {
              path: ['consentRecording'],
              message: 'registration.errors.recordingDestinationChanged',
            },
          ],
        }),
        { status: 422 },
      );
    disegnaCon({ ...SPUNTA_REGISTRAZIONE, recordingDestination: 'PUBLIC', partecipanti: 'solo-voce' });
    spunta('consentRecording');
    await iscriviti();

    expect(testoDi('#consentRecordingError')).toBe(
      messages.registration.errors.recordingDestinationChanged,
    );
    expect(container.textContent).not.toContain(messages.registration.errors.generic);
    expect(container.querySelector('.alert-danger')).toBeNull();
    const casella = container.querySelector('#consentRecording');
    expect(casella?.getAttribute('aria-invalid')).toBe('true');
    expect(casella?.getAttribute('aria-describedby')).toBe(
      'consentRecordingOptional consentRecordingError',
    );
    expect(container.textContent).not.toContain(messages.registration.success);
  });

  it('con voce assente l\'errore resta collegato alla casella', async () => {
    rispostaIscrizione = () =>
      new Response(
        JSON.stringify({ details: [{ path: ['consentRecording'], message: 'altro' }] }),
        { status: 422 },
      );
    disegnaCon({ ...SPUNTA_REGISTRAZIONE, partecipanti: 'assente' });
    expect(container.querySelector('#consentRecording')?.getAttribute('aria-describedby')).toBeNull();
    spunta('consentRecording');
    await iscriviti();
    expect(container.querySelector('#consentRecording')?.getAttribute('aria-describedby')).toBe(
      'consentRecordingError',
    );
  });

  it('un altro 422 resta un errore generico', async () => {
    rispostaIscrizione = () =>
      new Response(JSON.stringify({ details: [{ path: ['email'], message: 'no' }] }), {
        status: 422,
      });
    disegnaCon(SPUNTA_REGISTRAZIONE);
    await iscriviti();
    expect(container.textContent).toContain(messages.registration.errors.generic);
    expect(container.querySelector('#consentRecordingError')).toBeNull();
  });
});

describe('RegistrationFormClient — casella della trascrizione', () => {
  const consenso = messages.gdpr.consent;

  it('compare con la trascrizione dal video calcolata dal server', async () => {
    disegnaCon({ recordingEnabled: true, trascrizioneVideo: true, partecipanti: 'visibili' });
    expect(testoDi('label[for="consentMultitrack"]')).toContain(consenso.multitrack);
    spunta('consentMultitrack');
    await iscriviti();
    expect(iscrizioneInviata()?.consentMultitrack).toBe(true);
  });

  it('senza niente da trascrivere non compare', () => {
    disegnaCon({ recordingEnabled: true });
    expect(container.querySelector('#consentMultitrack')).toBeNull();
  });

  it('con le tracce conservate non promette la cancellazione', () => {
    disegnaCon({ multitrackRecordingEnabled: true, tracceConservate: true });
    const etichetta = testoDi('label[for="consentMultitrack"]');
    expect(etichetta).toContain(consenso.multitrackRetained);
    expect(etichetta).not.toContain(consenso.multitrack);
  });

  it('con voce rimovibile e il solo avviso resta nascosta', () => {
    disegnaCon({ recordingEnabled: true, trascrizioneVideo: true, partecipanti: 'solo-voce' });
    expect(container.querySelector('#consentMultitrack')).toBeNull();
  });

  it('con voce fissa la nota dice che la voce resta nel video', () => {
    disegnaCon({ recordingEnabled: true, trascrizioneVideo: true, partecipanti: 'visibili' });
    expect(testoDi('#consentMultitrackNota')).toBe(consenso.multitrackOptional);
  });

  it.each([
    ['solo-voce', { ...SPUNTA_REGISTRAZIONE, trascrizioneVideo: true, partecipanti: 'solo-voce' }],
    ['assente', { ...SPUNTA_REGISTRAZIONE, multitrackRecordingEnabled: true, partecipanti: 'assente' }],
  ] as const)('con voce %s la nota non parla del video', (_nome, props) => {
    disegnaCon(props);
    expect(testoDi('#consentMultitrackNota')).toBe(consenso.multitrackOptionalShort);
    expect(consenso.multitrackOptional).toContain(consenso.multitrackOptionalShort);
    expect(consenso.multitrackOptionalShort).not.toContain('video');
  });
});

describe('RegistrationFormClient — la scheda privacy', () => {
  const sheet = messages.gdpr.sheet;
  const SCHEDA: SchedaPrivacy = {
    registrazione: {
      modo: 'manuale',
      destinazione: 'REGISTRANTS',
      chiNonAcconsente: 'restaFuori',
      conduceSempre: false,
      partecipanti: null,
    },
    trascrizione: { chiesta: false, sottotitoli: false, tracce: null, dalVideo: false },
    sottotitoli: { attivi: false, testoConservato: false },
    ia: { sintesi: true, traduzione: false, doppiaggio: false, elaborabileDopo: false },
    chat: { attiva: true, domandeAttive: true, esitoDomande: 'nonPubblicate' },
    elencoVisibile: true,
    pseudonimi: false,
    nickname: false,
    conservazione: { giorniDati: 30, registrazione: { giorni: null, video: true } },
    rubrica: null,
  };

  describe('la nota sotto il nome', () => {
    const nota = () => container.querySelector('#displayNameHelp')?.textContent;

    it('dove il pubblico e\' anonimo dice lo stesso della sala d\'attesa', () => {
      conScheda({ schedaPrivacy: { ...SCHEDA, pseudonimi: true } });
      expect(nota()).toBe(messages.waiting.anonymousNameHelp);
      expect(nota()).not.toBe(messages.registration.namePlaceholder);
    });

    it('altrimenti il nome si vede in sala', () => {
      conScheda({ schedaPrivacy: SCHEDA });
      expect(nota()).toBe(messages.registration.namePlaceholder);
    });
  });

  function conScheda(props: Partial<ComponentProps<typeof RegistrationFormClient>> = {}) {
    act(() => {
      root.render(
        <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
          <RegistrationFormClient
            eventSlug={SLUG}
            privacyPolicyUrl="/privacy"
            startsAt={new Date(Date.now() + 7 * 24 * 3600_000).toISOString()}
            waitingRoomLeadMinutes={15}
            schedaPrivacy={SCHEDA}
            {...props}
          />
        </NextIntlClientProvider>,
      );
    });
  }
  const segue = (prima: Node, dopo: Node) =>
    (prima.compareDocumentPosition(dopo) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  const titoloScheda = () =>
    Array.from(container.querySelectorAll('h2')).find((h) => h.textContent === sheet.title);

  it('senza scheda il modulo resta quello di sempre', () => {
    conScheda({ schedaPrivacy: null });
    expect(titoloScheda()).toBeUndefined();
  });

  it('mostra i fatti della scheda, aperta', () => {
    conScheda();
    expect(container.textContent).toContain(sheet.recording.manual);
    expect(container.textContent).toContain(sheet.recording.destinationReserved);
    expect(container.textContent).toContain(sheet.chat.questionsNone);
  });

  it('sta sopra il link all\'informativa', () => {
    conScheda();
    const link = Array.from(container.querySelectorAll('a')).find(
      (a) => a.textContent === messages.registration.gdprLink,
    );
    expect(link?.getAttribute('href')).toBe('/privacy');
    expect(segue(titoloScheda() as Node, link as Node)).toBe(true);
  });

  it('sta sopra il testo dell\'informativa da aprire, e sopra i consensi', () => {
    conScheda({ privacyPolicyText: 'Informativa dell\'evento.' });
    const apri = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes(messages.registration.gdprLink),
    );
    expect(segue(titoloScheda() as Node, apri as Node)).toBe(true);
    expect(
      segue(titoloScheda() as Node, container.querySelector('#consentGiven') as Node),
    ).toBe(true);
  });

  it('il testo dell\'amministrazione arriva alla scheda', () => {
    conScheda({ testoIa: 'Testo scritto dall\'ente.' });
    expect(container.textContent).toContain('Testo scritto dall\'ente.');
    expect(container.textContent).not.toContain(sheet.ai.summary);
  });

  describe("l'avviso al pubblico senza microfono", () => {
    const { recordingNotice, recordingNoticeVoice } = messages.gdpr.consent;
    const senzaPresenza = {
      recordingEnabled: true,
      participantsCanUnmute: false,
      participantsCanStartVideo: false,
      participantsCanShareScreen: false,
    };
    const conModo = (modo: SchedaPrivacy['registrazione']['modo']): SchedaPrivacy => ({
      ...SCHEDA,
      registrazione: { ...SCHEDA.registrazione, modo },
    });

    it('dove la pagina dice che non si registra niente, non si annuncia', () => {
      conScheda({
        ...senzaPresenza,
        recordingEnabled: false,
        partecipanti: 'assente',
        schedaPrivacy: conModo('nessuna'),
      });
      expect(container.textContent).toContain(sheet.recording.none);
      expect(container.textContent).not.toContain(recordingNoticeVoice);
      expect(container.textContent).not.toContain(recordingNotice);
    });

    it('con le sole tracce resta', () => {
      conScheda({ ...senzaPresenza, partecipanti: 'assente', schedaPrivacy: conModo('soloTracce') });
      expect(container.textContent).toContain(recordingNoticeVoice);
    });

    it('con un video resta', () => {
      conScheda({ ...senzaPresenza, partecipanti: 'visibili', schedaPrivacy: conModo('manuale') });
      expect(container.textContent).toContain(recordingNotice);
    });

    it('senza scheda resta', () => {
      conScheda({ ...senzaPresenza, partecipanti: 'solo-voce', schedaPrivacy: null });
      expect(container.textContent).toContain(recordingNoticeVoice);
    });

    it("dove chi partecipa puo' comparire dice che il nome puo' finire nel video", () => {
      conScheda({ ...senzaPresenza, partecipanti: 'visibili', schedaPrivacy: null });
      expect(container.textContent).toContain(recordingNotice);
      expect(container.textContent).toContain(messages.gdpr.consent.namesMayAppear);
      expect(recordingNotice).not.toMatch(/volto/i);
    });
  });

  describe("dove chi partecipa non entra mai nel video ('esclusi')", () => {
    const { recordingHostsOnly } = messages.gdpr.consent;

    it("niente casella: l'informativa dice che nel video c'e' solo chi conduce", () => {
      conScheda({ ...SPUNTA_REGISTRAZIONE, partecipanti: 'esclusi', schedaPrivacy: null });
      expect(container.querySelector('#consentRecording')).toBeNull();
      expect(container.textContent).toContain(recordingHostsOnly);
      expect(container.textContent).not.toContain(messages.gdpr.consent.namesMayAppear);
    });

    it("anche dove il pubblico non parla, e il testo dell'ente non ha una casella a cui stare", () => {
      conScheda({
        recordingEnabled: true,
        participantsCanUnmute: false,
        partecipanti: 'esclusi',
        recordingConsentText: 'Testo scelto per evento',
        schedaPrivacy: null,
      });
      expect(container.textContent).toContain(recordingHostsOnly);
      expect(container.textContent).not.toContain('Testo scelto per evento');
    });

    it('la trascrizione si chiede da sola, senza aspettare la registrazione', async () => {
      conScheda({
        ...SPUNTA_REGISTRAZIONE,
        multitrackRecordingEnabled: true,
        partecipanti: 'esclusi',
        schedaPrivacy: null,
      });
      const casella = container.querySelector<HTMLInputElement>('#consentMultitrack');
      expect(casella?.disabled).toBe(false);
      spunta('consentMultitrack');
      await iscriviti();
      expect(iscrizioneInviata()?.consentMultitrack).toBe(true);
      expect(iscrizioneInviata()).not.toHaveProperty('consentRecording');
    });
  });

  it('non cambia il corpo della richiesta', async () => {
    conScheda();
    await iscriviti();
    const chiamata = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith(`/api/events/${SLUG}/registrations`),
    );
    const corpo = JSON.parse(String(chiamata?.[1]?.body)) as Record<string, unknown>;
    expect(Object.keys(corpo).filter((k) => /scheda|testoIa/i.test(k))).toEqual([]);
  });
});

describe('RegistrationFormClient — rubrica', () => {
  it('dice dove si trova davvero il link per uscire, senza promettere ogni email', () => {
    const { stayInTouchHelp } = messages.gdpr.consent;
    expect(stayInTouchHelp).not.toContain('nelle email che riceverai');
    for (const luogo of ['email di conferma', 'promemoria', 'inviti', messages.gdpr.export.title]) {
      expect(stayInTouchHelp).toContain(luogo);
    }
  });

  it('proposta: la casella dice per quanto si conservano i dati', () => {
    disegnaCon({});
    const aiuto = testoDi('#consentStayInTouchHelp');
    expect(aiuto).toContain(messages.gdpr.consent.stayInTouchHelp);
    expect(aiuto).toContain('24 mesi');
    expect(aiuto).toContain('riparte solo se spunti di nuovo la casella');
  });

  it('proposta e spuntata: manda i due consensi', async () => {
    disegnaCon({ rubricaProposta: true });
    spunta('consentStayInTouch');
    await iscriviti();
    expect(iscrizioneInviata()).toMatchObject({
      consentAddressBook: true,
      consentFutureCommunications: true,
    });
  });

  it('non proposta: nessuna casella, e i due consensi restano falsi', async () => {
    disegnaCon({ rubricaProposta: false });
    expect(container.querySelector('#consentStayInTouch')).toBeNull();
    await iscriviti();
    expect(iscrizioneInviata()).toMatchObject({
      consentAddressBook: false,
      consentFutureCommunications: false,
    });
  });
});

describe('RegistrationFormClient — questionario dell\'iscrizione', () => {
  it('senza questionario il modulo non ne mostra', async () => {
    disegna(null);
    await iscriviti();
    expect(container.textContent).toContain(messages.registration.success);
    expect(container.querySelector('fieldset.registration-questionnaire')).toBeNull();
    expect(richiesteQuestionario()).toHaveLength(0);
  });

  it('lo mostra nel modulo, con la domanda collegata al suo nome', async () => {
    disegna(questionario(false));
    await attendi();
    // Lo passa la pagina: il browser non lo chiede.
    expect(richiesteQuestionario()).toHaveLength(0);
    const gruppo = container.querySelector('fieldset.registration-questionnaire');
    expect(gruppo?.querySelector('legend')?.textContent).toContain('Due domande');
    expect(container.querySelector(`label[for="q-${DOMANDA}"]`)?.textContent).toContain(
      'Da quale ufficio?',
    );
  });

  it('manda le risposte con l\'iscrizione', async () => {
    disegna(questionario(false));
    await attendi();
    rispondi('Ufficio stampa');
    await iscriviti();
    expect(iscrizioneInviata()?.questionnaireAnswers).toEqual([
      { itemId: DOMANDA, valueText: 'Ufficio stampa' },
    ]);
    expect(container.textContent).toContain(messages.registration.success);
    // Il questionario non si ripropone dopo: le risposte sono gia' partite.
    expect(container.querySelector('fieldset.registration-questionnaire')).toBeNull();
  });

  it('facoltativo e senza risposte: ci si iscrive senza', async () => {
    disegna(questionario(false));
    await attendi();
    await iscriviti();
    expect(iscrizioneInviata()).not.toBeNull();
    expect(iscrizioneInviata()?.questionnaireAnswers).toBeUndefined();
  });

  it('obbligatorio e senza risposte: non invia, e lo dice sul questionario', async () => {
    disegna(questionario(true));
    await attendi();
    await iscriviti();
    expect(iscrizioneInviata()).toBeNull();
    expect(container.textContent).toContain(messages.registration.errors.questionnaireRequired);
    const gruppo = container.querySelector('fieldset.registration-questionnaire');
    expect(gruppo?.getAttribute('aria-describedby')).toBe('questionnaireAnswersError');
  });

  it('il rifiuto del server sul questionario si mostra sul questionario', async () => {
    rispostaIscrizione = () =>
      new Response(
        JSON.stringify({
          code: 'VALIDATION_ERROR',
          details: [
            {
              path: ['questionnaireAnswers'],
              message: 'registration.errors.questionnaireIncomplete',
            },
          ],
        }),
        { status: 422 },
      );
    disegna(questionario(false));
    await attendi();
    rispondi('Ufficio stampa');
    await iscriviti();
    expect(container.textContent).toContain(messages.registration.errors.questionnaireIncomplete);
    expect(container.textContent).not.toContain(messages.registration.errors.generic);
  });

  it('un rifiuto sul questionario che il modulo non conosce chiede di ricaricare', async () => {
    rispostaIscrizione = () =>
      new Response(
        JSON.stringify({
          code: 'VALIDATION_ERROR',
          details: [{ path: ['questionnaireAnswers', 0, 'itemId'], message: 'Invalid uuid' }],
        }),
        { status: 422 },
      );
    disegna(questionario(false));
    await attendi();
    rispondi('Ufficio stampa');
    await iscriviti();
    expect(container.textContent).toContain(messages.registration.errors.questionnaireChanged);
  });
});
