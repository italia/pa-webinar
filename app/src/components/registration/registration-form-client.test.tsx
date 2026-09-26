import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

/**
 * Dopo l'iscrizione il questionario pre-iscrizione si chiede al server solo se
 * l'evento ne ha uno: la pagina lo sa gia' (lo legge dal database) e lo passa
 * al modulo. Senza, la richiesta finiva in un 404 a ogni iscrizione.
 */
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
  percorso: (p: string) => p,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import RegistrationFormClient from './registration-form-client';

const SLUG = 'evento-di-prova';
const fetchMock = vi.fn();

let container: HTMLDivElement;
let root: Root;

function disegna(hasPreRegistrationQuestionnaire: boolean) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <RegistrationFormClient
          eventSlug={SLUG}
          privacyPolicyUrl="/privacy"
          hasPreRegistrationQuestionnaire={hasPreRegistrationQuestionnaire}
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
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).endsWith(`/api/events/${SLUG}/registrations`)) {
      return new Response(JSON.stringify({ accessToken: 'TOKEN_ISCRITTO' }), { status: 201 });
    }
    if (String(url).includes('/questionnaires/PRE_REGISTRATION')) {
      return new Response(
        JSON.stringify({
          id: 'q1',
          placement: 'PRE_REGISTRATION',
          title: { it: 'Due domande' },
          description: { it: '' },
          items: [],
        }),
        { status: 200 },
      );
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

describe('RegistrationFormClient — questionario pre-iscrizione', () => {
  it('senza questionario non lo chiede al server', async () => {
    disegna(false);
    await iscriviti();
    expect(container.textContent).toContain(messages.registration.success);
    expect(richiesteQuestionario()).toHaveLength(0);
  });

  it('con il questionario lo carica dopo l’iscrizione', async () => {
    disegna(true);
    await iscriviti();
    expect(container.textContent).toContain(messages.registration.success);
    expect(richiesteQuestionario()).toHaveLength(1);
  });
});
