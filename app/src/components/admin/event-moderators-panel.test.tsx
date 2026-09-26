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
vi.mock('@/components/ui/confirm-dialog', () => ({
  useConfirm: () => vi.fn(async () => true),
}));

import EventModeratorsPanel from './event-moderators-panel';

const BASE = 'https://webinar.example.gov.it';
const fetchMock = vi.fn();

let container: HTMLDivElement;
let root: Root;

async function disegna(locale: string) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <EventModeratorsPanel
          eventId="evento-1"
          eventSlug="evento-di-prova"
          moderatorToken="TOKEN_MODERATORE"
          baseUrl={BASE}
          locale={locale}
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
  fetchMock.mockResolvedValue(
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
