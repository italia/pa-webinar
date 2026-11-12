// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

/**
 * I link personali di co-moderatori e relatori sono indirizzi da copiare:
 * non passano dal router, quindi i segmenti si traducono dalla mappa degli
 * indirizzi (`/it/eventi/…`, `/en/events/…`) invece di scriverli a mano.
 */
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock('@/components/ui/confirm-dialog', () => ({
  useConfirm: () => vi.fn(async () => true),
}));

import EventModeratorsPanel from './event-moderators-panel';

const BASE = 'https://webinar.example.gov.it';
const fetchMock = vi.fn();

let container: HTMLDivElement;
let root: Root;

async function disegna(locale: string, canResend = true, onChange?: () => void) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <EventModeratorsPanel
          eventId="evento-1"
          eventSlug="evento-di-prova"
          moderatorToken="TOKEN_MODERATORE"
          eventTitle="Evento di prova"
          baseUrl={BASE}
          locale={locale}
          canResend={canResend}
          onChange={onChange}
        />
      </NextIntlClientProvider>,
    );
  });
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fetchMock.mockReset();
  // Una risposta nuova a ogni lettura: dopo una revoca l'elenco si rilegge.
  fetchMock.mockImplementation(async () =>
    new Response(
      JSON.stringify({
        rows: [
          {
            id: 'g1',
            name: 'Relatore 1',
            email: null,
            role: 'SPEAKER',
            token: 'TOKEN_RELATORE',
            createdAt: '2026-09-25T10:00:00.000Z',
            revokedAt: null,
          },
          {
            id: 'g2',
            name: 'Moderatrice 2',
            email: 'moderatrice2@example.org',
            role: 'MODERATOR',
            token: 'TOKEN_MODERATRICE',
            createdAt: '2026-09-25T10:05:00.000Z',
            revokedAt: null,
          },
        ],
      }),
      { status: 200 },
    ),
  );
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

describe('EventModeratorsPanel — link personali', () => {
  it('in italiano il link usa i segmenti italiani', async () => {
    await disegna('it');
    expect(container.querySelector('code')?.textContent).toBe(
      `${BASE}/it/eventi/evento-di-prova/live?token=TOKEN_RELATORE`,
    );
  });

  it('in inglese il link usa i segmenti inglesi', async () => {
    await disegna('en');
    expect(container.querySelector('code')?.textContent).toBe(
      `${BASE}/en/events/evento-di-prova/live?token=TOKEN_RELATORE`,
    );
  });
});

describe('EventModeratorsPanel — «Prepara email»', () => {
  const mailto = (nome: string) =>
    container.querySelector<HTMLAnchorElement>(
      `a[aria-label="${messages.admin.coModerators.prepareEmailFor.replace('{name}', nome)}"]`,
    )!;

  it('apre un\'email con il solo link di quella persona', async () => {
    await disegna('it');
    const href = mailto('Moderatrice 2').getAttribute('href') ?? '';
    expect(href.startsWith('mailto:moderatrice2@example.org?')).toBe(true);
    const parametri = new URLSearchParams(href.slice(href.indexOf('?') + 1));
    expect(parametri.get('subject')).toBe('Il tuo link per «Evento di prova»');
    const corpo = parametri.get('body') ?? '';
    expect(corpo).toContain(`${BASE}/it/eventi/evento-di-prova/live?token=TOKEN_MODERATRICE`);
    // Un solo token, e non quello degli altri.
    expect(corpo.match(/token=/g)).toHaveLength(1);
    expect(corpo).not.toContain('TOKEN_RELATORE');
    expect(corpo).not.toContain('TOKEN_MODERATORE');
  });

  it('senza indirizzo apre comunque l\'email da completare', async () => {
    await disegna('it');
    const href = mailto('Relatore 1').getAttribute('href') ?? '';
    expect(href.startsWith('mailto:?subject=')).toBe(true);
    expect(decodeURIComponent(href)).toContain('token=TOKEN_RELATORE');
  });
});

describe('EventModeratorsPanel — «Reinvia link»', () => {
  // Il nome accessibile comincia con il testo visibile, poi il nome.
  const reinvia = (nome: string) =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent === `${messages.admin.coModerators.resend}: ${nome}`,
    ) ?? null;

  it('rimette in coda il link di quella persona, con il link principale', async () => {
    await disegna('it');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ queued: true }), { status: 200 }));
    await act(async () => {
      reinvia('Moderatrice 2')!.click();
    });
    expect(fetchMock).toHaveBeenLastCalledWith('/api/events/evento-1/moderators/g2', {
      method: 'POST',
      headers: { Authorization: 'Bearer TOKEN_MODERATORE' },
    });
  });

  it('non c\'e\' per chi non ha un indirizzo, ne\' quando il portale non manda i link', async () => {
    await disegna('it');
    expect(reinvia('Relatore 1')).toBeNull();
    await disegna('it', false);
    expect(reinvia('Moderatrice 2')).toBeNull();
  });
});

describe('EventModeratorsPanel — chi mostra le persone altrove si rilegge', () => {
  // La panoramica dell'evento elenca moderatori e relatori: dopo una revoca
  // fatta qui non deve continuare a mostrare chi non c'e' piu'.
  const revoca = () =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
      b.textContent?.startsWith(messages.admin.coModerators.revoke),
    )!;

  it('dopo una revoca riuscita', async () => {
    const onChange = vi.fn();
    await disegna('it', true, onChange);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await act(async () => {
      revoca().click();
    });
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
    expect(fetchMock).toHaveBeenCalledWith('/api/events/evento-1/moderators/g1', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer TOKEN_MODERATORE' },
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('non se la revoca non riesce', async () => {
    const onChange = vi.fn();
    await disegna('it', true, onChange);
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    await act(async () => {
      revoca().click();
    });
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
    expect(onChange).not.toHaveBeenCalled();
  });
});
