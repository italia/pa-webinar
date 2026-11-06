// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';
import { ISTANZA_PREDEFINITA } from '@/lib/capacity/model';

import CreateEventWithTemplate from './create-event-with-template';

/**
 * Il modello scelto arriva al wizard intero: l'interfaccia del modello e' quella
 * del wizard, e un campo nuovo non resta per strada.
 */
const push = vi.fn();
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push }),
  percorso: (p: string) => p,
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }),
}));

const w = messages.admin.wizard;
const g = messages.admin.guided;

const base: ComponentProps<typeof CreateEventWithTemplate> = {
  templates: [],
  selectedTemplate: null,
  siteTimezone: 'Europe/Rome',
  enabledLocales: ['it', 'en'],
  defaultLocale: 'it',
  defaultRetentionDays: 30,
  canUseRubrica: false,
  capacita: { ...ISTANZA_PREDEFINITA, instanceBridges: 1 },
  availableTags: [],
  gdprTemplates: [],
  siteDefaultParseTitleKicker: false,
  siteDefaultVideoQuality: 'HIGH',
  whiteboardInfraReady: true,
};

const modello: NonNullable<
  ComponentProps<typeof CreateEventWithTemplate>['selectedTemplate']
> = {
  id: 'tpl-1',
  name: 'Riunione',
  qaEnabled: true,
  chatEnabled: true,
  recordingEnabled: true,
  autoStartRecording: false,
  participantsCanUnmute: true,
  participantsCanStartVideo: true,
  participantsCanShareScreen: true,
  maxParticipants: 30,
  recordingDestination: 'REGISTRANTS',
  offerAddressBook: false,
  audienceAnonymous: true,
  postEventShowQA: false,
};

let container: HTMLDivElement;
let root: Root;

function mostra(props: Partial<ComponentProps<typeof CreateEventWithTemplate>>) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <CreateEventWithTemplate {...base} {...props} />
      </NextIntlClientProvider>
    );
  });
}

function vaiAlRiepilogo() {
  const nav = container.querySelector<HTMLElement>(
    `nav[aria-label="${w.stepsAriaLabel}"]`
  )!;
  const passo = Array.from(nav.querySelectorAll('button')).find((b) =>
    b.textContent?.includes(w.flow.steps.review)
  );
  act(() => passo?.click());
}

function clicca(testo: string) {
  const b = Array.from(container.querySelectorAll('button')).find((el) =>
    el.textContent?.includes(testo)
  );
  if (!b) throw new Error(`nessun pulsante «${testo}»`);
  act(() => b.click());
}

function scrivi(el: HTMLInputElement | HTMLTextAreaElement, valore: string) {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, valore);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const passo = (etichetta: string) => {
  const nav = container.querySelector<HTMLElement>(`nav[aria-label="${w.stepsAriaLabel}"]`)!;
  const b = Array.from(nav.querySelectorAll('button')).find((el) =>
    el.textContent?.includes(etichetta)
  );
  act(() => b?.click());
};

/** Il corpo del POST dell'evento, dopo aver compilato il modulo aperto da un
 *  indirizzo. */
async function corpoPubblicato(): Promise<Record<string, unknown>> {
  const fetchFinto = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) =>
    String(input) === '/api/events' && init.method === 'POST'
      ? new Response(JSON.stringify({ id: 'evt', slug: 'evt', moderatorToken: 'token' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
      : new Response(JSON.stringify({ items: [] }))
  );
  vi.stubGlobal('fetch', fetchFinto);
  scrivi(container.querySelector<HTMLInputElement>('#ev-title')!, 'Evento di prova');
  scrivi(
    container.querySelector<HTMLTextAreaElement>('#ev-description-it')!,
    'Una descrizione valida per il wizard.'
  );
  passo(w.flow.steps.invites);
  scrivi(container.querySelector<HTMLInputElement>('#wiz-primary-name')!, 'Moderatore 1');
  scrivi(container.querySelector<HTMLInputElement>('#wiz-primary-email')!, 'moderatore@example.org');
  passo(w.flow.steps.review);
  await act(async () => clicca(w.publish));
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
  const post = fetchFinto.mock.calls.find(
    ([url, init]) => String(url) === '/api/events' && init?.method === 'POST'
  );
  if (!post) throw new Error('nessun POST dell evento');
  return JSON.parse(String(post[1]?.body)) as Record<string, unknown>;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  push.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ items: [] })))
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  Element.prototype.scrollIntoView = vi.fn();
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('CreateEventWithTemplate', () => {
  it('i valori del modello scelto arrivano al riepilogo del wizard', () => {
    mostra({ selectedTemplate: modello });
    vaiAlRiepilogo();
    const testo = container.textContent ?? '';
    expect(testo).toContain(w.flow.recordingDestinationReserved);
    expect(testo).toContain(w.flow.audiencePseudonyms);
    expect(testo).toContain(w.flow.postEventQaHidden);
    expect(testo).toContain(w.flow.addressBookNotOffered);
  });

  it('la rubrica spenta sull installazione arriva al wizard', () => {
    mostra({ selectedTemplate: modello, addressBookEnabled: false });
    vaiAlRiepilogo();
    expect(container.textContent).not.toContain(w.flow.addressBookNotOffered);
  });

  it('un vecchio indirizzo di formato apre il wizard con il formato', () => {
    mostra({ formatoParam: 'medio.tutti.si.tutti' });
    expect(container.querySelector('.wizard-modello')).not.toBeNull();
  });

  describe('dal formato al salvataggio', () => {
    const RIUNIONE = {
      recordingEnabled: true,
      recordingDestination: 'REGISTRANTS',
      audienceAnonymous: false,
      postEventShowQA: false,
      offerAddressBook: false,
      hostsAlwaysRecorded: false,
      postEventPublic: false,
    };
    const PARTECIPATIVO = {
      recordingEnabled: true,
      recordingDestination: 'PUBLIC',
      audienceAnonymous: false,
      postEventShowQA: true,
      offerAddressBook: true,
      hostsAlwaysRecorded: false,
      postEventPublic: true,
    };
    const PUBBLICO = { ...PARTECIPATIVO, audienceAnonymous: true };
    const INVITO = {
      ...PARTECIPATIVO,
      recordingDestination: 'REGISTRANTS',
      postEventPublic: false,
      accessMode: 'INVITATION',
    };

    it.each([
      ['riunione', 'piccolo.tutti.riservata.tutti', RIUNIONE],
      ['partecipativo', 'medio.tutti.pubblica.tutti', PARTECIPATIVO],
      ['pubblico', 'grande.relatori.pubblica.tutti', PUBBLICO],
      ['su invito', 'medio.tutti.riservata.invitati', INVITO],
      ['vecchio indirizzo, riunione', 'piccolo.tutti.si.tutti', RIUNIONE],
      ['vecchio indirizzo, partecipativo', 'medio.tutti.si.tutti', PARTECIPATIVO],
      ['vecchio indirizzo, su invito', 'medio.tutti.si.invitati', INVITO],
    ])('%s', async (_nome, formatoParam, atteso) => {
      mostra({ formatoParam });
      expect(await corpoPubblicato()).toMatchObject(atteso);
    });

    it('dove il video non c e una risposta pubblica nell indirizzo diventa riservata', async () => {
      mostra({ formatoParam: 'medio.tutti.pubblica.tutti', voceNelVideo: 'assente' });
      expect(container.textContent).toContain(g.summary.riservata);
      expect(container.textContent).not.toContain(g.summary.pubblica);
      const corpo = await corpoPubblicato();
      expect(corpo).toMatchObject({ recordingEnabled: true, postEventPublic: true });
      expect(corpo).not.toHaveProperty('recordingDestination');
    });

    it('senza registrazione non parte una destinazione', async () => {
      mostra({ formatoParam: 'medio.tutti.no.tutti' });
      const corpo = await corpoPubblicato();
      expect(corpo).toMatchObject({ recordingEnabled: false, postEventShowQA: true });
      expect(corpo).not.toHaveProperty('recordingDestination');
    });
  });

  describe('«Cambia formato»', () => {
    it('da un formato riporta alle domande con le risposte date', () => {
      mostra({ formatoParam: 'piccolo.tutti.riservata.tutti' });
      clicca(w.flow.changeFormat);
      expect(push).toHaveBeenCalledWith(
        '/admin/events/new?scegli=piccolo.tutti.riservata.tutti'
      );
    });

    it('passando agli inviti un video pubblico torna alla proposta riservata', () => {
      mostra({ formatoParam: 'medio.tutti.pubblica.tutti' });
      passo(w.flow.steps.invites);
      const invito = Array.from(
        container.querySelectorAll<HTMLElement>('.wizard-iscrizione label')
      ).find((l) => l.querySelector('.formato-scelta__titolo')?.textContent === g.access.invitation);
      act(() => invito?.click());
      clicca(w.flow.changeFormat);
      expect(push).toHaveBeenCalledWith(
        '/admin/events/new?scegli=medio.tutti.riservata.invitati'
      );
    });

    it('da un modello su invito le domande partono riservate', () => {
      mostra({ selectedTemplate: { ...modello, accessMode: 'INVITATION' } });
      clicca(w.flow.changeTemplate);
      expect(push).toHaveBeenCalledWith(
        '/admin/events/new?scegli=medio.tutti.riservata.invitati'
      );
    });

    it('da un modello aperto le domande ripartono da capo', () => {
      mostra({ selectedTemplate: { ...modello, accessMode: 'OPEN' } });
      clicca(w.flow.changeTemplate);
      expect(push).toHaveBeenCalledWith('/admin/events/new');
    });
  });

  it('dove il video non c e le domande non propongono un video pubblico', () => {
    mostra({ scegliParam: 'medio.tutti.pubblica.tutti', voceNelVideo: 'assente' });
    expect(container.textContent).not.toContain(g.rec.public);
    expect(container.textContent).toContain(w.flow.recordingDestinationReserved);
    expect(container.textContent).toContain(w.flow.postEventQaHidden);
  });

  it('le domande non promettono una rubrica spenta sull installazione', () => {
    mostra({ scegliParam: 'medio.tutti.pubblica.tutti', addressBookEnabled: false });
    expect(container.textContent).toContain(w.flow.addressBookNotOffered);
    expect(container.textContent).not.toContain(w.flow.addressBookOffered);
  });

  it('con la rubrica accesa le domande la promettono', () => {
    mostra({ scegliParam: 'medio.tutti.pubblica.tutti', addressBookEnabled: true });
    expect(container.textContent).toContain(w.flow.addressBookOffered);
  });

  it('il formato aperto nomina la risposta sulla registrazione, anche da un vecchio indirizzo', () => {
    mostra({ formatoParam: 'medio.tutti.si.tutti' });
    expect(container.textContent).toContain(g.summary.pubblica);
  });

  it('senza modello ne formato propone le domande', () => {
    mostra({});
    expect(container.querySelector(`nav[aria-label="${w.stepsAriaLabel}"]`)).toBeNull();
  });
});
