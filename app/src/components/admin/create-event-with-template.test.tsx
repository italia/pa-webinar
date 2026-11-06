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
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  percorso: (p: string) => p,
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }),
}));

const w = messages.admin.wizard;

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

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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

  it('senza modello ne formato propone le domande', () => {
    mostra({});
    expect(container.querySelector(`nav[aria-label="${w.stepsAriaLabel}"]`)).toBeNull();
  });
});
